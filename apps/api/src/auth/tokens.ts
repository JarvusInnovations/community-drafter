import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { DEFAULT_SITE_SLUG, type OperatorKind } from "@signatories/shared";

/**
 * `specs/api/auth.md` § Token shape: "JWT, HS256 with `AUTH_SECRET`. Claims:
 * `sub` (operator email, lowercase), `kind`, `name`, `purpose`
 * (`session` | `cli` | `magic`), `site` (the slug of the site it was minted
 * on), `sid` or `jti`, `iat`, `exp`." One signer/
 * verifier for every operator token — sessions, CLI tokens and magic links
 * are all this same shape, differing only in `purpose` and lifetime.
 * `purpose` is enforced per use (`verifyOperatorToken`'s caller always names
 * the one purpose it accepts) so a magic token can never authenticate an
 * ordinary request and a session token can never be replayed as a device
 * approval.
 */
export type TokenPurpose = "session" | "cli" | "magic";

export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const CLI_TTL_SECONDS = 90 * 24 * 60 * 60;
export const MAGIC_TTL_SECONDS = 15 * 60;

function ttlFor(purpose: TokenPurpose): number {
  switch (purpose) {
    case "session":
      return SESSION_TTL_SECONDS;
    case "cli":
      return CLI_TTL_SECONDS;
    case "magic":
      return MAGIC_TTL_SECONDS;
  }
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface MintTokenInput {
  purpose: TokenPurpose;
  email: string;
  name: string;
  kind: OperatorKind;
  secret: string;
  /**
   * `specs/api/auth.md` § Token shape: the slug of the site this token was
   * minted on — "a credential belongs to one hostname". Defaults to the
   * deployment's own derived site, which is where every token minted before
   * sites existed belongs.
   */
  site?: string;
  /**
   * Carried only on a `magic` token, so `GET /auth/callback?token=` (whose
   * URL has room for nothing but `token`) still knows where to redirect —
   * `POST /auth/login`'s validated `return` path, or the device flow's fixed
   * `/auth/device?code=<user_code>`. Not part of `specs/api/auth.md`'s named
   * claim list, but additive: every other consumer of these tokens ignores
   * unknown claims.
   */
  returnPath?: string;
  /**
   * Test-only: overrides `iat` (and shifts `exp` by the same amount) so a
   * suite can mint a token that already looks old — e.g. `packages/cli`'s
   * e2e tests, which mint a `cli` token with `iat` 31 days in the past to
   * exercise the CLI's silent-refresh path without waiting 30 real days.
   */
  issuedAt?: Date;
}

export interface MintedToken {
  token: string;
  /** The `sid` (session/cli) or `jti` (magic) minted for this token. */
  id: string;
  expiresAt: Date;
}

/** Mints a token of the given `purpose`, its own random `sid`/`jti`, and the matching TTL. */
export async function mintOperatorToken(input: MintTokenInput): Promise<MintedToken> {
  const id = randomBytes(18).toString("base64url");
  const ttlSeconds = ttlFor(input.purpose);
  const issuedAtSeconds = Math.floor((input.issuedAt?.getTime() ?? Date.now()) / 1000);
  const exp = issuedAtSeconds + ttlSeconds;

  const idClaim = input.purpose === "magic" ? { jti: id } : { sid: id };
  const returnClaim =
    input.purpose === "magic" && input.returnPath ? { return: input.returnPath } : {};

  const token = await new SignJWT({
    kind: input.kind,
    name: input.name,
    purpose: input.purpose,
    site: input.site ?? DEFAULT_SITE_SLUG,
    ...idClaim,
    ...returnClaim,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.email.toLowerCase())
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(exp)
    .sign(secretKey(input.secret));

  return { token, id, expiresAt: new Date(exp * 1000) };
}

export interface VerifiedOperatorToken {
  sub: string;
  kind: OperatorKind;
  name: string;
  purpose: TokenPurpose;
  /** The site the token was minted on; a token minted before the claim existed reads as the default site. */
  site: string;
  sid?: string;
  jti?: string;
  returnPath?: string;
  iat: number;
  exp: number;
}

/**
 * Verifies signature + expiry (via `jose`) and that `purpose` matches
 * exactly what the caller names — a magic token presented where a session
 * is expected (or vice versa) fails here, before anything reads the
 * operator record. Returns `null` on any failure; callers never need to
 * distinguish *why* a token didn't verify.
 */
export async function verifyOperatorToken(
  token: string,
  secret: string,
  expectedPurpose: TokenPurpose,
): Promise<VerifiedOperatorToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (payload.purpose !== expectedPurpose) return null;
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;

    return {
      sub: payload.sub,
      kind: (payload.kind === "bot" ? "bot" : "person") as OperatorKind,
      name: typeof payload.name === "string" ? payload.name : payload.sub,
      purpose: expectedPurpose,
      site: typeof payload.site === "string" ? payload.site : DEFAULT_SITE_SLUG,
      sid: typeof payload.sid === "string" ? payload.sid : undefined,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
      returnPath: typeof payload.return === "string" ? payload.return : undefined,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies signature + expiry only, accepting **either** `session` or `cli`
 * purpose — the bearer transport (`specs/behaviors/operators.md`: "bearer
 * (`purpose: cli` or `session`)") is the one place both are valid. Never
 * accepts `magic` — a magic link's token is single-purpose by construction
 * (`verifyOperatorToken` with `expectedPurpose: "magic"` in the callback
 * route only).
 */
export async function verifyBearerOperatorToken(
  token: string,
  secret: string,
): Promise<VerifiedOperatorToken | null> {
  const session = await verifyOperatorToken(token, secret, "session");
  if (session) return session;
  return verifyOperatorToken(token, secret, "cli");
}
