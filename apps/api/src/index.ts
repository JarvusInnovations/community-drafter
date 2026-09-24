import Fastify, { LogController } from "fastify";

import { app } from "./app.ts";

const server = Fastify({
  logger: {
    level: "info", // updated after env config loads
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
  // `disableRequestLogging` is deprecated in Fastify 5.12 (removed in 6) in
  // favor of `logController` (`plans/api-core.md`, absorbed from
  // `workspace-bootstrap`).
  logController: new LogController({ disableRequestLogging: true }),
  // `specs/architecture.md` § Deployment, "Cold start": boot clones the data
  // repo from GitHub before the storage plugin resolves. Fastify's default
  // 10 s plugin timeout would turn a slow clone into a crashed cold start.
  pluginTimeout: 60_000,
});

server.register(app);

/**
 * `specs/architecture.md` § Deployment, "Shutdown": Cloud Run kills the
 * container 10 seconds after SIGTERM, and scale-to-zero means that happens
 * every time the service goes idle. `server.close()` stops taking requests
 * (503 for new ones), lets in-flight ones finish, then runs the storage
 * plugin's `onClose`: flush open counts, push every pending commit. The
 * deadline makes sure the process exits on its own terms, with its log
 * lines written, before the platform's SIGKILL.
 */
export const SHUTDOWN_DEADLINE_MS = 9_000;
let shuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.log.info(`Received ${signal}, shutting down gracefully`);
  const deadline = setTimeout(() => {
    const pending = server.storage?.pusher?.status().pendingCommits ?? 0;
    server.log.error({ pendingCommits: pending }, "shutdown: deadline reached, exiting");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  try {
    await server.close();
    clearTimeout(deadline);
    server.log.info("Server closed successfully");
    process.exit(0);
  } catch (error) {
    server.log.error(error, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

const start = async () => {
  try {
    await server.ready();

    const port = server.config.PORT;
    const host = server.config.HOST;

    await server.listen({ port, host });

    server.log.info(`API listening at http://${host}:${port}`);
    server.log.info(`Health check: http://localhost:${port}/_health`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

void start();
