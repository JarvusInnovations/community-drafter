import type { OperatorRecord } from "@community-drafter/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../errors.ts";
import { OPERATOR_ROUTE, PUBLIC_ROUTE } from "../gateway/gateway.ts";
import { uniqueSlug } from "../lib/slug.ts";
import { isSafeReturnPath } from "./cookie.ts";
import { DEVICE_POLL_INTERVAL_SECONDS } from "./device.ts";

interface LoginBody {
  email?: string;
  return?: string;
}

interface CallbackQuery {
  token?: string;
}

interface DeviceBody {
  email?: string;
}

interface DeviceApproveBody {
  user_code?: string;
}

interface DeviceTokenBody {
  device_code?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
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

const invalidLinkPage = htmlPage(
  "This sign-in link isn't valid any more",
  `<p>It may have expired, already been used, or the account is no longer active.</p>
   <p><a href="/admin/login">Back to sign-in</a></p>`,
);

/**
 * `specs/api/auth.md` + `specs/behaviors/operators.md`. Every route here
 * declares `public` (or, for the routes that need a resolved operator —
 * `session`, `logout`, `refresh`, `device/approve` — `operator`), never
 * going through the admin document-scoping path, since none of these name a
 * document.
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  function instanceName(): string {
    return fastify.config.INSTANCE_NAME || "Community Drafter";
  }

  /**
   * `specs/behaviors/notifications.md` § Messages: `operator-magic-link`
   * is "not a participation message: no `notified` mark, no preference
   * link" — sent directly through `fastify.mailer`, bypassing the
   * participation-shaped dispatcher entirely.
   */
  async function sendMagicLink(
    operator: Pick<OperatorRecord, "email" | "name" | "kind">,
    request: FastifyRequest,
    returnPath: string,
  ): Promise<void> {
    const minted = await fastify.auth.mint(
      "magic",
      { email: operator.email, name: operator.name, kind: operator.kind },
      { returnPath },
    );
    const link = `${authBaseUrl(request, fastify.config.PUBLIC_URL)}/auth/callback?token=${encodeURIComponent(minted.token)}`;
    const name = instanceName();
    const fromEmail = fastify.config.INSTANCE_FROM_EMAIL ?? "no-reply@community-drafter.local";

    await fastify.mailer.send({
      to: { name: operator.name, email: operator.email },
      from: { name, email: fromEmail },
      subject: `Sign in to ${name}`,
      text: `Sign in to ${name}: ${link}\n\nThis link expires in 15 minutes and works once.`,
      html: `<p><a href="${link}">Sign in to ${escapeHtml(name)}</a></p><p>This link expires in 15 minutes and works once.</p>`,
      personalLink: link,
    });
  }

  /**
   * `specs/api/auth.md`: rate limits are "5 per address and 5 per source
   * IP per 15 minutes", shared by `/auth/login` and `/auth/device`.
   */
  function checkRateLimit(email: string, ip: string): void {
    const emailOk = fastify.auth.loginRateLimiters.perEmail.hit(email);
    const ipOk = fastify.auth.loginRateLimiters.perIp.hit(ip);
    if (!emailOk || !ipOk) {
      throw new ApiError("rate_limited", "Too many sign-in requests. Try again in 15 minutes.");
    }
  }

  // --- POST /auth/login ---
  fastify.post<{ Body: LoginBody }>(
    "/login",
    {
      config: PUBLIC_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" }, return: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email!.trim().toLowerCase();
      const returnPath = safeReturnPath(request.body.return);
      checkRateLimit(email, request.ip);

      const operator = fastify.storage.readModel.getOperatorByEmail(email);
      if (operator?.active) {
        await sendMagicLink(operator, request, returnPath);
      }

      reply.status(202);
      return { ok: true };
    },
  );

  // --- GET /auth/login (dev-only shortcut; distinct method from the spec'd POST above) ---
  fastify.get<{ Querystring: { return?: string } }>(
    "/login",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      const devEmail = fastify.auth.devEmail;
      if (!devEmail) {
        reply.status(404).type("text/html; charset=utf-8");
        return htmlPage(
          "No dev sign-in configured",
          "<p>Set <code>DEV_ADMIN_EMAIL</code> (non-production only) to use this shortcut, or sign in with a magic link instead.</p>",
        );
      }

      let operator = fastify.storage.readModel.getOperatorByEmail(devEmail);
      if (!operator) {
        // Local-dev convenience: the shortcut creates its own operator record
        // on first use rather than requiring `BOOTSTRAP_OPERATOR_EMAIL` to
        // exactly match `DEV_ADMIN_EMAIL` in every test/dev environment.
        const existingIds = new Set(fastify.storage.readModel.listOperators().map((o) => o.id));
        const id = uniqueSlug(devEmail.split("@")[0] ?? "dev", (candidate) =>
          existingIds.has(candidate),
        );
        await fastify.storage.commit(
          "operator-add",
          { actor: { kind: "system" }, subject: `operator-add: ${devEmail} (dev shortcut)` },
          async (tx) => {
            await tx.operators.upsert({
              id,
              email: devEmail,
              name: devEmail,
              kind: "person",
              active: true,
            });
          },
        );
        operator = fastify.storage.readModel.getOperatorByEmail(devEmail);
      }
      if (!operator) {
        throw new Error("dev shortcut: operator record missing immediately after creation");
      }

      const minted = await fastify.auth.mint("session", {
        email: operator.email,
        name: operator.name,
        kind: operator.kind,
      });
      reply.header("set-cookie", fastify.auth.sessionSetCookieHeader(minted.token));
      reply.redirect(safeReturnPath(request.query.return), 302);
    },
  );

  // --- GET /auth/callback ---
  fastify.get<{ Querystring: CallbackQuery }>(
    "/callback",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      const fail = () => {
        reply.status(400).type("text/html; charset=utf-8");
        return invalidLinkPage;
      };

      const token = request.query.token;
      if (!token) return fail();

      const verified = await fastify.auth.verifyMagic(token);
      if (!verified || !verified.jti) return fail();
      if (fastify.auth.usedMagicJti.isUsed(verified.jti)) return fail();

      const operator = fastify.storage.readModel.getOperatorByEmail(verified.sub);
      if (!operator || !operator.active) return fail();

      fastify.auth.usedMagicJti.markUsed(verified.jti, verified.exp * 1000);

      const minted = await fastify.auth.mint("session", {
        email: operator.email,
        name: operator.name,
        kind: operator.kind,
      });
      reply.header("set-cookie", fastify.auth.sessionSetCookieHeader(minted.token));
      reply.redirect(safeReturnPath(verified.returnPath), 302);
    },
  );

  // --- GET /auth/session ---
  fastify.get("/session", { config: OPERATOR_ROUTE }, async (request) => {
    const principal = request.principal!;
    if (principal.kind !== "operator")
      throw new ApiError("unauthenticated", "No operator session.");
    return {
      email: principal.email,
      name: principal.name,
      kind: principal.operatorKind,
      expires_at: new Date(principal.exp * 1000).toISOString(),
      transport: principal.transport,
    };
  });

  // --- POST /auth/logout ---
  fastify.post("/logout", { config: OPERATOR_ROUTE }, async (_request, reply) => {
    reply.header("set-cookie", fastify.auth.clearCookieHeader());
    return { ok: true };
  });

  // --- POST /auth/refresh ---
  fastify.post("/refresh", { config: OPERATOR_ROUTE }, async (request) => {
    const principal = request.principal!;
    if (principal.kind !== "operator" || principal.transport !== "bearer") {
      throw new ApiError("unauthenticated", "POST /auth/refresh accepts a bearer token only.");
    }
    // The gateway already reloaded the live operator record to authenticate
    // this request (`operator_inactive` otherwise), so it's still active.
    const minted = await fastify.auth.mint("cli", {
      email: principal.email,
      name: principal.name,
      kind: principal.operatorKind,
    });
    return {
      token: minted.token,
      expires_at: minted.expiresAt.toISOString(),
      email: principal.email,
    };
  });

  // --- POST /auth/device ---
  fastify.post<{ Body: DeviceBody }>(
    "/device",
    {
      config: PUBLIC_ROUTE,
      schema: {
        body: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const email = request.body.email!.trim().toLowerCase();
      checkRateLimit(email, request.ip);

      const pending = fastify.auth.deviceCodes.create();

      const operator = fastify.storage.readModel.getOperatorByEmail(email);
      if (operator?.active) {
        await sendMagicLink(operator, request, `/auth/device?code=${pending.userCode}`);
      }

      reply.status(202);
      return {
        device_code: pending.deviceCode,
        user_code: pending.userCode,
        expires_in: 900,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      };
    },
  );

  // --- POST /auth/device/approve ---
  fastify.post<{ Body: DeviceApproveBody }>(
    "/device/approve",
    { config: OPERATOR_ROUTE },
    async (request) => {
      const principal = request.principal!;
      if (principal.kind !== "operator" || principal.transport !== "cookie") {
        throw new ApiError(
          "unauthenticated",
          "Approving a device code requires a signed-in session.",
        );
      }
      const userCode = request.body?.user_code;
      if (!userCode) throw new ApiError("invalid_request", "user_code is required.");

      const ok = fastify.auth.deviceCodes.approve(userCode, principal.email);
      if (!ok) throw new ApiError("not_found", "Unknown or expired code.");
      return { ok: true };
    },
  );

  // --- POST /auth/device/token ---
  fastify.post<{ Body: DeviceTokenBody }>(
    "/device/token",
    { config: PUBLIC_ROUTE },
    async (request) => {
      const deviceCode = request.body?.device_code;
      if (!deviceCode) throw new ApiError("invalid_request", "device_code is required.");

      const pending = fastify.auth.deviceCodes.get(deviceCode);
      if (!pending) throw new ApiError("not_found", "Unknown or expired device code.");
      if (!pending.approvedEmail) throw new ApiError("device_pending", "Not approved yet.");

      const operator = fastify.storage.readModel.getOperatorByEmail(pending.approvedEmail);
      if (!operator || !operator.active)
        throw new ApiError("not_found", "Unknown or expired device code.");

      const minted = await fastify.auth.mint("cli", {
        email: operator.email,
        name: operator.name,
        kind: operator.kind,
      });
      return {
        token: minted.token,
        expires_at: minted.expiresAt.toISOString(),
        email: operator.email,
      };
    },
  );
};

export default authRoutes;
