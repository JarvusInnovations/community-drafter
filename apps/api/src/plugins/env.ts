import fp from "fastify-plugin";
import fastifyEnv from "@fastify/env";

// Every variable here mirrors specs/architecture.md → Deployment → Configuration
// and the repo-root .env.example. Keep the two in lockstep: a name added to one
// belongs in the other. Only the Fastify-basics (PORT/HOST/NODE_ENV/LOG_LEVEL)
// are required/defaulted at this stage — the product config below is declared
// so it type-checks and validates, but stays optional until the plans that
// consume it (auth gateway, storage, mailer) land.
const schema = {
  type: "object",
  required: [],
  properties: {
    // --- Fastify basics ---
    PORT: {
      type: "number",
      default: 3001,
    },
    HOST: {
      type: "string",
      default: "0.0.0.0",
    },
    NODE_ENV: {
      type: "string",
      enum: ["development", "production", "test"],
      default: "development",
    },
    LOG_LEVEL: {
      type: "string",
      enum: ["fatal", "error", "warn", "info", "debug", "trace"],
      default: "info",
    },

    // --- Data repository (specs/architecture.md § Storage) ---
    DATA_REPO_URL: { type: "string" },
    DATA_REPO_BRANCH: { type: "string" },
    // `behaviors/operators.md` § Data-repository refresh (webhook):
    // HMAC-SHA256 over the raw body, GitHub's `X-Hub-Signature-256` shape.
    DATA_REPO_WEBHOOK_SECRET: { type: "string" },

    // --- Public identity ---
    PUBLIC_URL: { type: "string" },

    // --- Operator auth (specs/architecture.md § Authentication) ---
    // Signs sessions, CLI tokens and magic links (`api/auth.md` § Token
    // shape). Required in production — checked by hand below (JSON Schema
    // can't express "required only when NODE_ENV=production").
    AUTH_SECRET: { type: "string" },
    // `behaviors/operators.md` § Bootstrap: the only way the first operator
    // comes into existence, when the `operators` sheet is empty at boot.
    BOOTSTRAP_OPERATOR_EMAIL: { type: "string" },
    // Local/test only: bypasses magic-link sign-in entirely, minting a
    // session directly for this email (`auth/routes.ts`'s `GET /auth/login`
    // dev shortcut). Ignored when NODE_ENV=production (`auth/plugin.ts`).
    DEV_ADMIN_EMAIL: { type: "string" },
    // `api/auth.md` § POST /auth/login: "5 per address and 5 per source IP
    // per 15 minutes by default". Configurable so a test run from one
    // machine can sign many operators in; production keeps the default.
    AUTH_LOGIN_RATE_LIMIT: { type: "integer", default: 5, minimum: 1 },

    // --- Outbound messaging (specs/architecture.md § Outbound messaging) ---
    MAILER: {
      type: "string",
      enum: ["postmark", "smtp", "export"],
      default: "export",
    },
    POSTMARK_API_KEY: { type: "string" },
    SMTP_HOST: { type: "string" },
    SMTP_PORT: { type: "number" },
    SMTP_USER: { type: "string" },
    SMTP_PASSWORD: { type: "string" },
    // `notifications` plan: where the `export` mailer appends its
    // `name,email,subject,link` CSV rows (`lib/mailer/export.ts`). Optional —
    // an unset path keeps rows in memory for the process lifetime only.
    EXPORT_CSV_PATH: { type: "string" },

    // --- Instance identity ---
    INSTANCE_NAME: { type: "string" },
    INSTANCE_FROM_EMAIL: { type: "string" },
    INSTANCE_TIMEZONE: { type: "string" },
    // `specs/behaviors/notifications.md` § Sending: "The digest job runs
    // once daily at a configured hour in the instance time zone." 0-23,
    // local to INSTANCE_TIMEZONE.
    INSTANCE_DIGEST_HOUR: { type: "number", default: 8 },

    // --- The deliverable (specs/screens/deliverable.md) ---
    // The system Chromium `puppeteer-core` drives to print the statement.
    // Optional: unset, the renderer probes the usual Debian locations, which
    // is what the image provides (`specs/architecture.md` § Deployment).
    CHROMIUM_PATH: { type: "string" },

    // --- The scheduler tick (specs/architecture.md § Deployment) ---
    // The audience and service-account email a tick's Google-signed OIDC
    // ID token must carry. Either unset: every tick is refused.
    TICK_AUDIENCE: { type: "string" },
    TICK_INVOKER_EMAIL: { type: "string" },
  },
};

// TypeScript declaration merging for type safety
declare module "fastify" {
  interface FastifyInstance {
    config: {
      PORT: number;
      HOST: string;
      NODE_ENV: "development" | "production" | "test";
      LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace";

      DATA_REPO_URL?: string;
      DATA_REPO_BRANCH?: string;
      DATA_REPO_WEBHOOK_SECRET?: string;

      PUBLIC_URL?: string;

      AUTH_SECRET?: string;
      BOOTSTRAP_OPERATOR_EMAIL?: string;
      DEV_ADMIN_EMAIL?: string;
      AUTH_LOGIN_RATE_LIMIT: number;

      MAILER: "postmark" | "smtp" | "export";
      POSTMARK_API_KEY?: string;
      SMTP_HOST?: string;
      SMTP_PORT?: number;
      SMTP_USER?: string;
      SMTP_PASSWORD?: string;
      EXPORT_CSV_PATH?: string;

      INSTANCE_NAME?: string;
      INSTANCE_FROM_EMAIL?: string;
      INSTANCE_TIMEZONE?: string;
      INSTANCE_DIGEST_HOUR: number;

      CHROMIUM_PATH?: string;

      TICK_AUDIENCE?: string;
      TICK_INVOKER_EMAIL?: string;
    };
  }
}

export default fp(async (fastify) => {
  await fastify.register(fastifyEnv, {
    schema,
    dotenv: true,
  });

  // `jarvus-fastify` authentication reference § Security Considerations:
  // "Strong signing keys — HS256 needs ≥32 bytes; validate the length at
  // boot." Also the cross-field contract JSON Schema can't express: required
  // in production, optional in dev/test (where `DEV_ADMIN_EMAIL` stands in).
  if (fastify.config.NODE_ENV === "production" && !fastify.config.AUTH_SECRET) {
    throw new Error("AUTH_SECRET must be set in production (signs operator sessions and tokens).");
  }
  if (fastify.config.AUTH_SECRET && Buffer.byteLength(fastify.config.AUTH_SECRET, "utf8") < 32) {
    throw new Error("AUTH_SECRET must be at least 32 bytes.");
  }
});
