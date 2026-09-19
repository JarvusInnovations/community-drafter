import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import {
  buildClearCookie,
  buildSetCookie,
  isSecureContext,
  parseCookies,
  sessionCookieName,
  sign,
  unsign,
} from "./cookie.ts";
import { createGoogleAuth, type GoogleAuth } from "./google.ts";
import { SESSION_TTL_MS, SessionStore, type Session } from "./session-store.ts";

export interface AuthPluginOptions {
  /**
   * Test-only substitute for the real Google verifier — lets
   * `/auth/callback` tests exercise allowlist accept/refuse without a
   * network call to Google (`plans/admin-dashboard.md` § Approach).
   */
  googleAuth?: GoogleAuth;
}

export interface AuthDecoration {
  sessions: SessionStore;
  /** `null` when Google isn't configured (`GOOGLE_CLIENT_ID`/`_SECRET` unset and no test override). */
  google: GoogleAuth | null;
  /** Whether the session cookie carries the `__Secure-` prefix (`PUBLIC_URL` is https). */
  secure: boolean;
  cookieName: string;
  /** Set only outside production (`env.ts`'s `DEV_ADMIN_EMAIL`, honored only when `NODE_ENV !== "production"`). */
  devAdminEmail: string | null;
  resolveSession(cookieHeader: string | undefined): Session | null;
  mintSession(email: string, name?: string): { session: Session; setCookieHeader: string };
  clearCookieHeader(): string;
}

declare module "fastify" {
  interface FastifyInstance {
    auth: AuthDecoration;
  }
}

/**
 * `specs/behaviors/access-and-identity.md` § Admin access + `jarvus-fastify`
 * authentication reference. Decorates `fastify.auth` with the session store
 * and cookie helpers the gateway's cookie-resolution branch
 * (`gateway.ts`'s `resolveAdmin`) and `auth/routes.ts` both read. Must
 * register after `envPlugin` (reads `fastify.config`) and before
 * `gatewayPlugin` (see `app.ts`'s numbered comments).
 */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const secure = isSecureContext(fastify.config.PUBLIC_URL);
  const cookieName = sessionCookieName(secure);
  const sessions = new SessionStore();

  const devAdminEmail =
    fastify.config.NODE_ENV !== "production" && fastify.config.DEV_ADMIN_EMAIL
      ? fastify.config.DEV_ADMIN_EMAIL
      : null;
  if (fastify.config.DEV_ADMIN_EMAIL && fastify.config.NODE_ENV === "production") {
    fastify.log.warn(
      "DEV_ADMIN_EMAIL is set but ignored in production (NODE_ENV=production); configure Google OAuth instead.",
    );
  }

  const google: GoogleAuth | null =
    opts.googleAuth ??
    (fastify.config.GOOGLE_CLIENT_ID && fastify.config.GOOGLE_CLIENT_SECRET
      ? createGoogleAuth(fastify.config.GOOGLE_CLIENT_ID, fastify.config.GOOGLE_CLIENT_SECRET)
      : null);

  function resolveSession(cookieHeader: string | undefined): Session | null {
    const secret = fastify.config.COOKIE_SECRET;
    if (!secret) return null;
    const cookies = parseCookies(cookieHeader);
    const raw = cookies[cookieName];
    if (!raw) return null;
    const sessionId = unsign(raw, secret);
    if (!sessionId) return null;
    return sessions.get(sessionId);
  }

  function mintSession(email: string, name?: string) {
    const secret = fastify.config.COOKIE_SECRET;
    if (!secret) {
      throw new Error("COOKIE_SECRET must be configured to mint an admin session.");
    }
    const session = sessions.create(email, name);
    const setCookieHeader = buildSetCookie(cookieName, sign(session.id, secret), {
      secure,
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    });
    return { session, setCookieHeader };
  }

  function clearCookieHeader(): string {
    return buildClearCookie(cookieName, secure);
  }

  fastify.decorate("auth", {
    sessions,
    google,
    secure,
    cookieName,
    devAdminEmail,
    resolveSession,
    mintSession,
    clearCookieHeader,
  });
};

export default fp(authPlugin, "5.x");
