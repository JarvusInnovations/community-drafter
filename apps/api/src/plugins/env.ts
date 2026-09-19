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

    // --- Public identity ---
    PUBLIC_URL: { type: "string" },

    // --- Admin auth (specs/architecture.md § Authentication) ---
    ADMIN_TOKEN: { type: "string" },
    GOOGLE_CLIENT_ID: { type: "string" },
    GOOGLE_CLIENT_SECRET: { type: "string" },
    COOKIE_SECRET: { type: "string" },
    OAUTH_ALLOWED_EMAILS: { type: "string" },
    OAUTH_ALLOWED_DOMAINS: { type: "string" },
    // `admin-dashboard`: bypasses Google entirely for local dev/tests. Only
    // honored when NODE_ENV !== "production" (`auth/plugin.ts`) — a value
    // left set in a deployed environment is ignored, not a foothold.
    DEV_ADMIN_EMAIL: { type: "string" },

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

      PUBLIC_URL?: string;

      ADMIN_TOKEN?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      COOKIE_SECRET?: string;
      OAUTH_ALLOWED_EMAILS?: string;
      OAUTH_ALLOWED_DOMAINS?: string;
      DEV_ADMIN_EMAIL?: string;

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
    };
  }
}

export default fp(async (fastify) => {
  await fastify.register(fastifyEnv, {
    schema,
    dotenv: true,
  });
});
