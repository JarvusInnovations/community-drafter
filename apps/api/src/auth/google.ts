import { createRemoteJWKSet, jwtVerify } from "jose";

/** What a successful Google sign-in tells us — identity claims only, never roles. */
export interface GoogleIdentity {
  email: string;
  name?: string;
}

/**
 * The Google side of the OAuth code flow, behind an interface so tests can
 * substitute a fake verifier instead of hitting Google's token endpoint and
 * JWKS (`plans/admin-dashboard.md` § Risks: "use the dev-email bypass mode
 * for automated tests" — this is the other injection point, for exercising
 * `/auth/callback` itself without a real Google account).
 */
export interface GoogleAuth {
  /** Builds the `accounts.google.com/o/oauth2/v2/auth` redirect URL. */
  authUrl(redirectUri: string, state: string): string;
  /**
   * Exchanges an authorization `code` for tokens and verifies the returned
   * `id_token` (signature, issuer, audience, expiry). Returns `null` on any
   * failure — the caller renders one generic "OAuth failed" response
   * either way, per `specs/api/conventions.md`'s no-disclosure posture.
   */
  exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity | null>;
}

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function googleJwks() {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  return jwks;
}

/** The real implementation — used whenever `GOOGLE_CLIENT_ID`/`_SECRET` are configured. */
export function createGoogleAuth(clientId: string, clientSecret: string): GoogleAuth {
  return {
    authUrl(redirectUri, state) {
      const url = new URL(GOOGLE_AUTH_ENDPOINT);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },

    async exchangeCode(code, redirectUri) {
      const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { id_token?: string };
      if (!body.id_token) return null;

      try {
        const { payload } = await jwtVerify(body.id_token, googleJwks(), {
          issuer: GOOGLE_ISSUERS,
          audience: clientId,
        });
        const email = typeof payload.email === "string" ? payload.email : undefined;
        if (!email) return null;
        const name = typeof payload.name === "string" ? payload.name : undefined;
        return { email, name };
      } catch {
        return null;
      }
    },
  };
}
