import { diffVersions, render } from "@signatories/shared";
import type {
  CitationsMode,
  ComparableVersion,
  DiffResult,
  RenderResult,
} from "@signatories/shared";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

/**
 * `specs/architecture.md`: "Rendered HTML per version is cached in memory.
 * Diffs between versions are computed server-side." Keyed by the version's
 * commit hash and the citation mode — git history is immutable, so once
 * rendered/diffed a pair never needs to be recomputed or invalidated for the
 * life of the process, and the mode is the only other thing that changes the
 * HTML (`specs/behaviors/versioning.md` § Citations).
 *
 * Diffs are not keyed by mode because they never see one: the comparison
 * view is always `links`, and the blocks and code blocks a diff runs on are
 * identical in every mode by construction.
 */
export class RenderCache {
  private readonly renders = new Map<string, RenderResult>();
  private readonly diffs = new Map<string, DiffResult>();

  render(commit: string, body: string, citations: CitationsMode = "links"): RenderResult {
    const key = `${commit}:${citations}`;
    const cached = this.renders.get(key);
    if (cached) return cached;
    const result = render(body, { citations });
    this.renders.set(key, result);
    return result;
  }

  /** Takes the render results whole so code blocks reach the comparison with the blocks. */
  diff(
    fromCommit: string,
    toCommit: string,
    from: ComparableVersion,
    to: ComparableVersion,
  ): DiffResult {
    const key = `${fromCommit}:${toCommit}`;
    const cached = this.diffs.get(key);
    if (cached) return cached;
    const result = diffVersions(from, to);
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
