import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed cookie/state helpers — pattern lifted from
 * `proposal-renderer/src/auth.ts` (per this plan's brief), reimplemented on
 * `node:crypto` (no new dependency for the signing itself; `jose` handles
 * the Google id_token verification instead, in `google.ts`).
 */

/** Sign a UTF-8 payload: `<base64url(payload)>.<base64url(hmac)>`. */
export function sign(payload: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/** Reverse of `sign`. Returns the raw payload on a valid signature, `null` otherwise. */
export function unsign(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

/** `Cookie: a=b; c=d` → `{ a: "b", c: "d" }`. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * `jarvus-fastify` authentication reference: "the `__Secure-` prefix
 * requires `Secure`, which requires HTTPS — fall back to an unprefixed,
 * non-Secure cookie name when the configured base URL is http." Decided
 * once, from `PUBLIC_URL`, not per-request.
 */
export function isSecureContext(publicUrl: string | undefined): boolean {
  return Boolean(publicUrl?.startsWith("https://"));
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Secure-drafter_session" : "drafter_session";
}

export function buildSetCookie(
  name: string,
  value: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * OAuth `state` — HMAC-signed so a callback can't be forged, carrying the
 * post-login return path. Open-redirect guard: only same-origin, single-
 * slash paths are accepted (`//evil.example` and `https://evil.example`
 * both rejected).
 */
export function encodeState(returnPath: string, secret: string): string {
  return sign(JSON.stringify({ returnPath }), secret);
}

export function decodeState(state: string, secret: string): { returnPath: string } | null {
  const payload = unsign(state, secret);
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as { returnPath?: string };
    if (!obj.returnPath || !isSafeReturnPath(obj.returnPath)) return null;
    return { returnPath: obj.returnPath };
  } catch {
    return null;
  }
}

export function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * `specs/behaviors/access-and-identity.md` § Admin access: "Google OAuth
 * with an allowlist of emails and/or domains." Ported from
 * `proposal-renderer/src/auth.ts`'s `emailAllowed`: exact matches,
 * `@domain`/`*@domain` wildcard entries in the emails list, and the
 * separate domains list. An unconfigured allowlist (both env vars empty)
 * admits NOBODY: the instance is internet-facing and the gateway is
 * deny-by-default (`specs/api/conventions.md`), so a missing allowlist
 * must fail closed. Boot logs a warning when OAuth is configured without
 * one (`plugin.ts`).
 */
export function emailAllowed(
  email: string,
  allowedEmailsCsv: string | undefined,
  allowedDomainsCsv: string | undefined,
): boolean {
  const lower = email.toLowerCase();
  const at = lower.indexOf("@");
  const senderDomain = at > 0 ? lower.slice(at + 1) : "";

  const allowedEmails = splitCsv(allowedEmailsCsv);
  const allowedDomains = splitCsv(allowedDomainsCsv);

  for (const raw of allowedEmails) {
    const entry = raw.toLowerCase();
    if (entry === lower) return true;
    if ((entry.startsWith("@") || entry.startsWith("*@")) && senderDomain) {
      const domain = entry.replace(/^\*?@/, "");
      if (senderDomain === domain) return true;
    }
  }
  if (senderDomain && allowedDomains.some((d) => d.toLowerCase() === senderDomain)) return true;

  return false;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
