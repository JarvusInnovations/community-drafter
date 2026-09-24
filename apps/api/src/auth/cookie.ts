/**
 * Cookie plumbing shared by the operator session transport
 * (`jarvus-fastify` authentication reference § Sessions). The session
 * cookie's *value* is the signed JWT itself (`auth/tokens.ts`) — there is no
 * separate HMAC-signed cookie wrapper the way the old Google-OAuth session
 * id was, so this module is just parsing/building `Cookie`/`Set-Cookie`
 * headers and the open-redirect guard on `return` paths.
 */

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
 * Open-redirect guard for `return`/callback paths (`specs/api/auth.md`:
 * "validated: must start with a single `/`"). `//evil.example` and
 * `https://evil.example` are both rejected; only a same-origin, single-slash
 * path is accepted.
 */
export function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}
