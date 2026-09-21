import { diffVersions, render } from "@signatories/shared";
import type { Block, DiffResult, RenderResult } from "@signatories/shared";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

/**
 * `specs/architecture.md`: "Rendered HTML per version is cached in memory.
 * Diffs between versions are computed server-side." Keyed by the version's
 * commit hash — git history is immutable, so once rendered/diffed a pair
 * never needs to be recomputed or invalidated for the life of the process.
 */
export class RenderCache {
  private readonly renders = new Map<string, RenderResult>();
  private readonly diffs = new Map<string, DiffResult>();

  render(commit: string, body: string): RenderResult {
    const cached = this.renders.get(commit);
    if (cached) return cached;
    const result = render(body);
    this.renders.set(commit, result);
    return result;
  }

  diff(fromCommit: string, toCommit: string, fromBlocks: Block[], toBlocks: Block[]): DiffResult {
    const key = `${fromCommit}:${toCommit}`;
    const cached = this.diffs.get(key);
    if (cached) return cached;
    const result = diffVersions(fromBlocks, toBlocks);
    this.diffs.set(key, result);
    return result;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    rendering: RenderCache;
  }
}

const renderingPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("rendering", new RenderCache());
};

export default fp(renderingPlugin, "5.x");
