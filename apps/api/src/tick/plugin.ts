import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { SCHEDULER_ROUTE } from "../gateway/capability.ts";
import { googleSchedulerKeys, type SchedulerKeys, verifySchedulerToken } from "./oidc.ts";

/**
 * `specs/architecture.md` § Deployment, "The scheduler". The service scales
 * to zero, so nothing scheduled may live on a timer inside the process.
 * Cloud Scheduler calls `POST /internal/tick` every 15 minutes instead, and
 * each tick runs every step below. Each step is idempotent, and a step's
 * error is logged without stopping the others or failing the tick, so the
 * scheduler never retries its way into a second digest.
 */
export type TickStep = "flush" | "push" | "phase" | "digest";

export interface TickResult {
  ok: true;
  /** The steps that completed; a step that threw is logged and left out. */
  ran: TickStep[];
}

export interface TickDecoration {
  /** Whether a bearer token is a valid Google OIDC token for the tick invoker. */
  verify(token: string): Promise<boolean>;
  /** One pass of every step. Overlapping calls share the pass in progress. */
  run(now?: Date): Promise<TickResult>;
}

declare module "fastify" {
  interface FastifyInstance {
    tick: TickDecoration;
  }
}

export interface TickPluginOptions {
  /** Test-only: the keys a tick's token must be signed by (default: Google's). */
  keys?: SchedulerKeys;
}

const tickPlugin: FastifyPluginAsync<TickPluginOptions> = async (fastify, opts) => {
  const audience = fastify.config.TICK_AUDIENCE;
  const email = fastify.config.TICK_INVOKER_EMAIL;
  if (!audience || !email) {
    fastify.log.warn(
      "tick: TICK_AUDIENCE or TICK_INVOKER_EMAIL is unset; every scheduler tick will be refused",
    );
  }

  async function verify(token: string): Promise<boolean> {
    if (!audience || !email) return false;
    return verifySchedulerToken(token, opts.keys ?? googleSchedulerKeys(), { audience, email });
  }

  async function runSteps(now: Date): Promise<TickResult> {
    const ran: TickStep[] = [];
    const step = async (name: TickStep, fn: () => Promise<unknown>) => {
      try {
        await fn();
        ran.push(name);
      } catch (err) {
        fastify.log.error({ step: name, err }, "tick: step failed");
      }
    };

    const { tracker, pusher } = fastify.storage;
    await step("flush", () => tracker.flush());
    // A non-fast-forward needs a person (`specs/architecture.md` § Storage);
    // retrying it every 15 minutes would only repeat the error.
    await step("push", async () => {
      if (pusher && !pusher.diverged()) await pusher.push();
    });
    await step("phase", () => fastify.phaseObserver.tick());
    await step("digest", () => fastify.operatorDigest.run(now));
    return { ok: true, ran };
  }

  let inProgress: Promise<TickResult> | null = null;
  function run(now: Date = new Date()): Promise<TickResult> {
    inProgress ??= runSteps(now).finally(() => {
      inProgress = null;
    });
    return inProgress;
  }

  fastify.decorate("tick", { verify, run } satisfies TickDecoration);
};

/** `POST /internal/tick`, behind the gateway's `scheduler` capability. */
export const tickRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/tick", { config: SCHEDULER_ROUTE }, async () => fastify.tick.run());
};

export default fp(tickPlugin, "5.x");
