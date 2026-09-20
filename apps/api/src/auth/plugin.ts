import type { OperatorKind } from "@community-drafter/shared";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { FixedWindowLimiter } from "../gateway/rate-limit.ts";
import {
  buildClearCookie,
  buildSetCookie,
  isSecureContext,
  parseCookies,
  sessionCookieName,
} from "./cookie.ts";
import { DeviceCodeStore } from "./device.ts";
import {
  CLI_TTL_SECONDS,
  mintOperatorToken,
  SESSION_TTL_SECONDS,
  verifyBearerOperatorToken,
  verifyOperatorToken,
  type MintedToken,
  type TokenPurpose,
  type VerifiedOperatorToken,
} from "./tokens.ts";
import { MagicCodeStore } from "./magic-code-store.ts";
import { UsedJtiStore } from "./used-jti-store.ts";

export interface OperatorIdentity {
  email: string;
  name: string;
  kind: OperatorKind;
}

export interface AuthDecoration {
  /** Whether the session cookie carries the `__Secure-` prefix (`PUBLIC_URL` is https). */
  secure: boolean;
  cookieName: string;
  /** Set only outside production (`env.ts`'s `DEV_ADMIN_EMAIL`) — the local-dev sign-in shortcut. */
  devEmail: string | null;
  deviceCodes: DeviceCodeStore;
  usedMagicJti: UsedJtiStore;
  /** Short emailed codes → signed magic tokens (`api/auth.md`). */
  magicCodes: MagicCodeStore;
  /** `specs/api/auth.md`: 5 per address and 5 per source IP per 15 minutes, on `/auth/login` and `/auth/device`. */
  loginRateLimiters: { perEmail: FixedWindowLimiter; perIp: FixedWindowLimiter };
  mint(
    purpose: TokenPurpose,
    operator: OperatorIdentity,
    opts?: { returnPath?: string },
  ): Promise<MintedToken>;
  verifyBearer(token: string): Promise<VerifiedOperatorToken | null>;
  verifyMagic(token: string): Promise<VerifiedOperatorToken | null>;
  /** Reads the session cookie off a `Cookie` header and verifies it (`purpose: session` only). */
  resolveCookie(cookieHeader: string | undefined): Promise<VerifiedOperatorToken | null>;
  sessionSetCookieHeader(token: string): string;
  clearCookieHeader(): string;
}

declare module "fastify" {
  interface FastifyInstance {
    auth: AuthDecoration;
  }
}

/**
 * `specs/behaviors/operators.md` + `specs/api/auth.md`. Decorates
 * `fastify.auth` with token mint/verify helpers, cookie plumbing, and the
 * in-memory device-code + used-magic-jti stores the auth routes and the
 * gateway's operator resolution both read. Must register after `envPlugin`
 * (reads `fastify.config`) and before `gatewayPlugin` (see `app.ts`'s
 * numbered comments).
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  const secure = isSecureContext(fastify.config.PUBLIC_URL);
  const cookieName = sessionCookieName(secure);

  const devEmail =
    fastify.config.NODE_ENV !== "production" && fastify.config.DEV_ADMIN_EMAIL
      ? fastify.config.DEV_ADMIN_EMAIL
      : null;
  if (fastify.config.DEV_ADMIN_EMAIL && fastify.config.NODE_ENV === "production") {
    fastify.log.warn(
      "DEV_ADMIN_EMAIL is set but ignored in production (NODE_ENV=production); use magic-link sign-in instead.",
    );
  }

  function requireSecret(): string {
    const secret = fastify.config.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET must be configured to mint or verify operator tokens.");
    }
    return secret;
  }

  async function mint(
    purpose: TokenPurpose,
    operator: OperatorIdentity,
    opts?: { returnPath?: string },
  ): Promise<MintedToken> {
    return mintOperatorToken({
      purpose,
      email: operator.email,
      name: operator.name,
      kind: operator.kind,
      secret: requireSecret(),
      returnPath: opts?.returnPath,
    });
  }

  async function verifyBearer(token: string): Promise<VerifiedOperatorToken | null> {
    return verifyBearerOperatorToken(token, requireSecret());
  }

  async function verifyMagic(token: string): Promise<VerifiedOperatorToken | null> {
    return verifyOperatorToken(token, requireSecret(), "magic");
  }

  async function resolveCookie(
    cookieHeader: string | undefined,
  ): Promise<VerifiedOperatorToken | null> {
    const cookies = parseCookies(cookieHeader);
    const raw = cookies[cookieName];
    if (!raw) return null;
    return verifyOperatorToken(raw, requireSecret(), "session");
  }

  function sessionSetCookieHeader(token: string): string {
    return buildSetCookie(cookieName, token, { secure, maxAgeSeconds: SESSION_TTL_SECONDS });
  }

  function clearCookieHeader(): string {
    return buildClearCookie(cookieName, secure);
  }

  fastify.decorate("auth", {
    secure,
    cookieName,
    devEmail,
    deviceCodes: new DeviceCodeStore(),
    usedMagicJti: new UsedJtiStore(),
    magicCodes: new MagicCodeStore(),
    loginRateLimiters: {
      // `specs/api/auth.md`: "5 per address and 5 per source IP per 15 minutes".
      perEmail: new FixedWindowLimiter(5, 15 * 60_000),
      perIp: new FixedWindowLimiter(5, 15 * 60_000),
    },
    mint,
    verifyBearer,
    verifyMagic,
    resolveCookie,
    sessionSetCookieHeader,
    clearCookieHeader,
  } satisfies AuthDecoration);
};

export { CLI_TTL_SECONDS, SESSION_TTL_SECONDS };
export default fp(authPlugin, "5.x");
