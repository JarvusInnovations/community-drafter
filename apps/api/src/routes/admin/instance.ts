import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { OPERATOR_ROUTE, WEBHOOK_ROUTE } from "../../gateway/gateway.ts";
import { initDataRepo } from "../../storage/init.ts";

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
  }
  return stdout;
}

/**
 * `git fetch` updates `refs/remotes/<remote>/<branch>` with a compare-and-
 * swap ref transaction — the push daemon's own startup backlog check
 * (gitsheets) can run its own concurrent fetch of the same ref, which loses
 * that race with a transient "incorrect old value provided" error. Retrying
 * a couple of times clears it without a caller-visible failure.
 */
async function fetchWithRetry(dataDir: string, branch: string, attempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await runGit(["fetch", "origin", branch], dataDir);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

const instanceRoute: FastifyPluginAsync = async (fastify) => {
  // Scoped to this plugin's own encapsulation context (registered as a
  // plain async function, not `fp`-wrapped, so this override doesn't leak
  // to other route files) — `webhook` capability's HMAC check
  // (`gateway.ts`'s `resolveWebhook`) needs the exact raw bytes
  // `X-Hub-Signature-256` was computed over, not a re-serialized parse.
  fastify.addContentTypeParser(
    ["application/json", "text/plain", "application/x-www-form-urlencoded"],
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch {
        // A non-JSON (or empty-ish) webhook body is fine here — the route
        // never reads `request.body`, only `request.rawBody`.
        done(null, {});
      }
    },
  );

  fastify.get("/whoami", { config: OPERATOR_ROUTE }, async (request) => {
    const principal = request.principal!;
    if (principal.kind !== "operator")
      throw new ApiError("unauthenticated", "No operator session.");
    return {
      email: principal.email,
      name: principal.name,
      kind: principal.operatorKind,
      expires_at: new Date(principal.exp * 1000).toISOString(),
      transport: principal.transport,
      // `specs/api/admin-cli.md`: `whoami` and the home view name the site
      // this credential belongs to — the same command against two profiles
      // is two different tenants (`specs/behaviors/sites.md`).
      site: {
        slug: request.site.slug,
        name: request.site.name,
        hostname: request.site.hostname,
      },
    };
  });

  fastify.post("/init-data-repo", { config: OPERATOR_ROUTE }, async () => {
    try {
      const result = await initDataRepo({ dataDir: fastify.storage.dataDir });
      return result;
    } catch (err) {
      throw new ApiError(
        "validation_failed",
        err instanceof Error ? err.message : "init-data-repo failed.",
      );
    }
  });

  /**
   * `specs/behaviors/operators.md` § Data-repository refresh (webhook) +
   * `specs/api/admin.md`: pulls a hand-edit (or any out-of-band push)
   * pushed to the data repo's remote into this running instance. The only
   * `webhook`-capability route — authenticated by HMAC signature, never an
   * operator token (`gateway.ts`'s `resolveWebhook`).
   */
  fastify.post("/refresh", { config: WEBHOOK_ROUTE }, async () => {
    const { repo, dataDir, readModel, pushDaemon } = fastify.storage;

    return repo.withLock(async () => {
      if (pushDaemon && pushDaemon.status().pendingCommits > 0) {
        throw new ApiError(
          "refresh_busy",
          "The push daemon has commits pending; try again shortly.",
        );
      }

      const branch = (await runGit(["symbolic-ref", "--short", "HEAD"], dataDir)).trim();
      const headBefore = await repo.resolveRef("HEAD");
      if (!headBefore) throw new Error("refresh: HEAD does not resolve to a commit");

      await fetchWithRetry(dataDir, branch);
      const remoteRef = `refs/remotes/origin/${branch}`;
      const remoteHash = await repo.resolveRef(remoteRef);
      if (!remoteHash) {
        throw new Error(`refresh: ${remoteRef} does not resolve after fetch`);
      }

      if (remoteHash === headBefore) {
        return { head_before: headBefore, head_after: headBefore, rebuilt: false };
      }

      const ffProc = Bun.spawn(["git", "merge-base", "--is-ancestor", headBefore, remoteHash], {
        cwd: dataDir,
        stdout: "ignore",
        stderr: "ignore",
      });
      const isFastForward = (await ffProc.exited) === 0;
      if (!isFastForward) {
        fastify.log.error(
          { headBefore, remoteHash },
          "storage: refresh found the data repo diverged from its remote",
        );
        throw new ApiError(
          "refresh_diverged",
          "The local branch and the remote have diverged; this cannot be fast-forwarded.",
        );
      }

      await runGit(["update-ref", `refs/heads/${branch}`, remoteHash], dataDir);
      await repo.refresh();
      await readModel.build();

      return { head_before: headBefore, head_after: remoteHash, rebuilt: true };
    });
  });
};

export default instanceRoute;
