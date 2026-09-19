import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

/**
 * `specs/api/conventions.md` § Idempotency + `plans/api-core.md` risk note:
 * "Idempotency cache in memory — lost on restart; acceptable because every
 * write is also naturally idempotent by record state." This is a courtesy
 * fast-path (skip re-committing on a network retry within 24h), not the
 * only safety net.
 */
export interface CachedResponse {
  status: number;
  body: unknown;
}

interface CacheEntry extends CachedResponse {
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  get(key: string): CachedResponse | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return { status: entry.status, body: entry.body };
  }

  set(key: string, status: number, body: unknown): void {
    this.store.set(key, { status, body, expiresAt: Date.now() + this.ttlMs });
  }

  /** Test-only. */
  clear(): void {
    this.store.clear();
  }
}

declare module "fastify" {
  interface FastifyInstance {
    idempotency: IdempotencyCache;
  }
}

const idempotencyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("idempotency", new IdempotencyCache());
};

export default fp(idempotencyPlugin, "5.x");

/**
 * Wrap a write handler with `Idempotency-Key` replay
 * (`specs/api/conventions.md` § Idempotency): a repeated key within 24h for
 * the same `scope` (route + principal) returns the first result verbatim
 * instead of re-running `fn`. Absent header → always runs `fn`.
 */
export async function withIdempotency<T>(
  fastify: { idempotency: IdempotencyCache },
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  fn: () => Promise<T>,
): Promise<T> {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return fn();

  const cacheKey = `${scope}:${key}`;
  const cached = fastify.idempotency.get(cacheKey);
  if (cached) {
    reply.status(cached.status);
    return cached.body as T;
  }

  const body = await fn();
  fastify.idempotency.set(cacheKey, reply.statusCode, body);
  return body;
}
