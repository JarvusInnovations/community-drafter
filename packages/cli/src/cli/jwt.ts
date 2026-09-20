/**
 * Decodes the `iat` claim off a JWT **without verifying it** — used only to
 * decide whether a stored CLI token is old enough to refresh
 * (`specs/behaviors/operators.md` § Sessions: "The CLI refreshes it
 * silently when it is older than 30 days"). The API is the one place that
 * verifies signatures; this is a client-side heuristic only, so a forged or
 * malformed token here just skips the refresh and lets the API's own 401
 * handling take over.
 */
export function decodeJwtIatSeconds(token: string): number | undefined {
  try {
    const parts = token.split(".");
    const payloadB64 = parts[1];
    if (!payloadB64) return undefined;
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { iat?: unknown };
    return typeof payload.iat === "number" ? payload.iat : undefined;
  } catch {
    return undefined;
  }
}
