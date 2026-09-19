import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../errors.ts";
import { PUBLIC_ROUTE } from "../gateway/gateway.ts";
import { decodeState, emailAllowed, encodeState, isSafeReturnPath } from "./cookie.ts";

interface LoginQuery {
  return?: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
}

/** `${PUBLIC_URL}/auth/callback`, or derived from the request when unset (local dev). */
function authBaseUrl(request: FastifyRequest, publicUrl: string | undefined): string {
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? request.protocol;
  const host = request.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

function safeReturnPath(raw: string | undefined): string {
  return raw && isSafeReturnPath(raw) ? raw : "/admin";
}

/**
 * `specs/behaviors/access-and-identity.md` § Admin access + `auth/plugin.ts`'s
 * decoration. Every route here declares `public` — each manages its own
 * (or no) authentication rather than going through the gateway's admin
 * transport, per `specs/api/conventions.md`'s `/auth/*` row ("none / cookie").
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: LoginQuery }>(
    "/login",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      const returnPath = safeReturnPath(request.query.return);
      const { devAdminEmail, google } = fastify.auth;
      const cookieSecret = fastify.config.COOKIE_SECRET;

      if (devAdminEmail) {
        const { setCookieHeader } = fastify.auth.mintSession(devAdminEmail, devAdminEmail);
        reply.header("set-cookie", setCookieHeader);
        reply.redirect(returnPath, 302);
        return;
      }

      if (!google || !cookieSecret) {
        reply.status(503).type("text/html; charset=utf-8");
        return htmlPage(
          "Google sign-in isn't configured",
          `<p>This instance has no <code>GOOGLE_CLIENT_ID</code>/<code>GOOGLE_CLIENT_SECRET</code>/<code>COOKIE_SECRET</code> configured, so admin sign-in is unavailable.</p>
         <p>Set those three in the environment (see <code>.env.example</code>) and restart, or set <code>DEV_ADMIN_EMAIL</code> for local development.</p>`,
        );
      }

      const redirectUri = `${authBaseUrl(request, fastify.config.PUBLIC_URL)}/auth/callback`;
      const state = encodeState(returnPath, cookieSecret);
      reply.redirect(fastify.auth.google!.authUrl(redirectUri, state), 302);
    },
  );

  fastify.get<{ Querystring: CallbackQuery }>(
    "/callback",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      const { google } = fastify.auth;
      const cookieSecret = fastify.config.COOKIE_SECRET;
      if (!google || !cookieSecret) {
        reply.status(503).type("text/html; charset=utf-8");
        return htmlPage(
          "Google sign-in isn't configured",
          "<p>OAuth is not configured on this instance.</p>",
        );
      }

      const { code, state: stateParam } = request.query;
      const state = stateParam ? decodeState(stateParam, cookieSecret) : null;
      if (!code || !state) {
        reply.status(400).type("text/html; charset=utf-8");
        return htmlPage(
          "Invalid OAuth callback",
          "<p>Missing or tampered state. Try signing in again.</p>",
        );
      }

      const redirectUri = `${authBaseUrl(request, fastify.config.PUBLIC_URL)}/auth/callback`;
      const identity = await google.exchangeCode(code, redirectUri);
      if (!identity) {
        reply.status(400).type("text/html; charset=utf-8");
        return htmlPage(
          "Sign-in failed",
          "<p>Google did not return a verifiable identity. Try again.</p>",
        );
      }

      if (
        !emailAllowed(
          identity.email,
          fastify.config.OAUTH_ALLOWED_EMAILS,
          fastify.config.OAUTH_ALLOWED_DOMAINS,
        )
      ) {
        reply.status(403).type("text/html; charset=utf-8");
        return htmlPage(
          "Not authorized",
          `<p>${escapeHtml(identity.email)} is not on the admin allowlist for this instance.</p>`,
        );
      }

      const { setCookieHeader } = fastify.auth.mintSession(identity.email, identity.name);
      reply.header("set-cookie", setCookieHeader);
      reply.redirect(state.returnPath, 302);
    },
  );

  fastify.get("/session", { config: PUBLIC_ROUTE }, async (request) => {
    const session = fastify.auth.resolveSession(request.headers.cookie);
    if (!session) {
      throw new ApiError("unauthenticated", "No admin session.");
    }
    return {
      email: session.email,
      name: session.name,
      expires_at: new Date(session.expiresAt).toISOString(),
    };
  });

  fastify.post("/logout", { config: PUBLIC_ROUTE }, async (request, reply) => {
    const session = fastify.auth.resolveSession(request.headers.cookie);
    if (session) {
      fastify.auth.sessions.revoke(session.id);
    }
    reply.header("set-cookie", fastify.auth.clearCookieHeader());
    return { ok: true };
  });
};

export default authRoutes;
