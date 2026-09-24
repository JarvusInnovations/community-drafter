import type { OperatorRecord } from "@signatories/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../errors.ts";
import { OPERATOR_ROUTE, PUBLIC_ROUTE } from "../gateway/gateway.ts";
import { firstName, renderEmail } from "../lib/mailer/shell.ts";
import { uniqueSlug } from "../lib/slug.ts";
import { isSiteOperator } from "../sites/site.ts";
import { resolveSender } from "../notifications/sender.ts";
import { isSafeReturnPath } from "./cookie.ts";
import { DEVICE_POLL_INTERVAL_SECONDS } from "./device.ts";
import { DEFAULT_RETURN_PATH, magicLinkUrl, signMagicCode, verifyMagicCode } from "./magic-link.ts";

interface LoginBody {
  email?: string;
  return?: string;
}

interface CallbackQuery {
  op?: string;
  code?: string;
  return?: string;
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

/**
 * The origin every link in this sign-in flow is built on: the **resolved
 * site's** own (`specs/behaviors/sites.md` — "a magic link is built on the
 * host the sign-in was requested on"), falling back to the request's own
 * scheme and host when the default site has no `PUBLIC_URL` (local dev).
 */
function authBaseUrl(request: FastifyRequest): string {
  if (request.site.baseUrl) return request.site.baseUrl.replace(/\/$/, "");
  const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? request.protocol;
  const host = request.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

function safeReturnPath(raw: string | undefined): string {
  return raw && isSafeReturnPath(raw) ? raw : DEFAULT_RETURN_PATH;
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
  /**
   * `specs/behaviors/notifications.md` § Messages: `operator-magic-link`
   * is "not a participation message: no `notified` mark, no preference
   * link" — sent directly through `fastify.mailer`, bypassing the
   * participation-shaped dispatcher entirely.
   */
  async function sendMagicLink(
    operator: Pick<OperatorRecord, "id" | "email" | "name" | "kind">,
    request: FastifyRequest,
    returnPath: string,
    trigger: { kind: "web" } | { kind: "device"; userCode: string },
  ): Promise<void> {
    // `specs/api/auth.md`: the link carries a short code that signs the
    // site, the operator, the expiry and the return path — nothing is kept
    // in memory, so the link still works after a scale-to-zero restart.
    const { code } = signMagicCode(fastify.auth.secret(), {
      site: request.site.slug,
      operatorId: operator.id,
      operatorEmail: operator.email,
      returnPath,
    });
    const base = authBaseUrl(request);
    const link = magicLinkUrl(base, operator.id, code, returnPath);
    // `specs/behaviors/notifications.md` § `operator-magic-link`: the one
    // message that belongs to the **resolved** site rather than to a
    // document's, because it is not about a document.
    const site = request.site;
    const name = site.name;
    const host = base.replace(/^https?:\/\//u, "") || (site.hostname ?? "");
    const sender = resolveSender(fastify, undefined, site);

    // `specs/behaviors/notifications.md` § `operator-magic-link`, rendered
    // through the same shell as every participant message (§ "Shape").
    const rendered = renderEmail({
      greeting: `Hi ${firstName(operator.name)},`,
      body: [
        trigger.kind === "web"
          ? `You asked to sign in to ${name} (${host}) on the web.`
          : `A command line asked to sign in to ${name} (${host}) with the code ${trigger.userCode}.`,
      ],
      button: { label: `Sign in to ${name}`, url: link },
      smallPrint: [
        "This link works once and expires in 15 minutes.",
        "If you didn't request this, you can ignore this email.",
      ],
    });

    await fastify.mailer.send({
      to: { name: operator.name, email: operator.email },
      from: sender.from,
      replyTo: sender.replyTo,
      tag: sender.tag,
      subject: `Sign in to ${name}`,
      text: rendered.text,
      html: rendered.html,
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

      // `specs/behaviors/operators.md` § Sign-in: the address is matched
      // within the **resolved site's** group — an operator of another site
      // gets the same "if that address belongs to an operator" response and
      // no mail, because on this hostname they are not one.
      const operator = fastify.storage.readModel.getOperatorByEmail(email);
      if (operator?.active && isSiteOperator(fastify, request.site.slug, operator.email)) {
        await sendMagicLink(operator, request, returnPath, { kind: "web" });
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

      const minted = await fastify.auth.mint(
        "session",
        { email: operator.email, name: operator.name, kind: operator.kind },
        { site: request.site.slug },
      );
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

      const { op, code } = request.query;
      if (typeof op !== "string" || typeof code !== "string" || !op || !code) return fail();
      // The return path is part of what the code signs; an unsafe one was
      // never signed, so it fails like any other tampering.
      const returnPath = request.query.return ?? DEFAULT_RETURN_PATH;
      if (typeof returnPath !== "string" || !isSafeReturnPath(returnPath)) return fail();

      const operator = fastify.storage.readModel.listOperators().find((o) => o.id === op);
      if (!operator || !operator.active) return fail();

      // The resolved site is inside the MAC, so a link is only good on the
      // host it was sent from (`specs/behaviors/sites.md`).
      const expiresAt = verifyMagicCode(fastify.auth.secret(), code, {
        site: request.site.slug,
        operatorId: operator.id,
        operatorEmail: operator.email,
        returnPath,
      });
      if (!expiresAt) return fail();
      if (fastify.auth.usedMagicCodes.isUsed(code)) return fail();
      fastify.auth.usedMagicCodes.markUsed(code, expiresAt.getTime());

      const minted = await fastify.auth.mint(
        "session",
        { email: operator.email, name: operator.name, kind: operator.kind },
        { site: request.site.slug },
      );
      reply.header("set-cookie", fastify.auth.sessionSetCookieHeader(minted.token));
      reply.redirect(returnPath, 302);
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
      superadmin: principal.superadmin,
      expires_at: new Date(principal.exp * 1000).toISOString(),
      transport: principal.transport,
      // `specs/api/auth.md`: the admin frame shows the resolved site on
      // every page and already resolves the session there, so the site
      // rides along rather than costing a second round trip. It replaces
      // the earlier `instance_name` string.
      site: {
        slug: request.site.slug,
        name: request.site.name,
        hostname: request.site.hostname,
        logo_url: request.site.logo_url,
        accent: request.site.accent,
      },
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
    const minted = await fastify.auth.mint(
      "cli",
      { email: principal.email, name: principal.name, kind: principal.operatorKind },
      { site: request.site.slug },
    );
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
      if (operator?.active && isSiteOperator(fastify, request.site.slug, operator.email)) {
        await sendMagicLink(operator, request, `/auth/device?code=${pending.userCode}`, {
          kind: "device",
          userCode: pending.userCode,
        });
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

      const minted = await fastify.auth.mint(
        "cli",
        { email: operator.email, name: operator.name, kind: operator.kind },
        { site: request.site.slug },
      );
      return {
        token: minted.token,
        expires_at: minted.expiresAt.toISOString(),
        email: operator.email,
      };
    },
  );
};

export default authRoutes;
