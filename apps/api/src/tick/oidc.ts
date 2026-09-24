import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * `specs/architecture.md` § Deployment, "The scheduler": the tick arrives
 * with an OIDC ID token Google signs for the tick invoker's service account.
 * Verified here against Google's published keys, so no shared secret exists
 * to leak or rotate.
 */
export type SchedulerKeys = Parameters<typeof jwtVerify>[1];

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let googleKeys: SchedulerKeys | undefined;

/** Google's signing keys, fetched on first use and cached by `jose`. */
export function googleSchedulerKeys(): SchedulerKeys {
  googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_CERTS_URL));
  return googleKeys;
}

export interface SchedulerExpectation {
  audience: string;
  email: string;
}

/**
 * `true` only for a token signed by `keys`, issued by Google, for
 * `audience`, whose `email` is the invoker's and verified. Every failure is
 * `false`; the caller never needs to know which check failed.
 */
export async function verifySchedulerToken(
  token: string,
  keys: SchedulerKeys,
  expected: SchedulerExpectation,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.audience,
      algorithms: ["RS256"],
    });
    return (
      typeof payload.email === "string" &&
      payload.email.toLowerCase() === expected.email.toLowerCase() &&
      payload.email_verified === true
    );
  } catch {
    return false;
  }
}
