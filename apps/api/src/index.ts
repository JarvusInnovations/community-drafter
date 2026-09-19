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
});

server.register(app);

const gracefulShutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await server.close();
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
