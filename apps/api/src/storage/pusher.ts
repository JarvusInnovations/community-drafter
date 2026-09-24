/**
 * `specs/architecture.md` § Storage, "Pushed before acknowledged": the
 * service's own push path to the data repo's remote. It replaces the
 * gitsheets push daemon, whose `stop()` only waits for an in-flight push and
 * never sends a commit still waiting behind it. A service that is stopped
 * whenever it is idle cannot shut down that way, so a shutdown here is a
 * push like any other.
 *
 * Pushes are serialized (one `git push` at a time) and each sends the whole
 * branch, so one successful push covers every commit made before it
 * started. Nothing here retries on a timer: a failed push is retried by the
 * next write, the next scheduler tick, and the shutdown sequence.
 */

export type PushFailureReason = "non-fast-forward" | "timeout" | "unknown";

export interface PushStatus {
  /** Commits made locally that no successful push has carried yet. */
  pendingCommits: number;
  lastPushAt: string | null;
  lastPushMs: number | null;
  lastError: { message: string; at: string; reason: PushFailureReason } | null;
}

export interface PushOutcome {
  ok: boolean;
  /** `true` when nothing was pending, so no `git push` ran. */
  skipped?: boolean;
  durationMs?: number;
  reason?: PushFailureReason;
}

export interface PusherOptions {
  dataDir: string;
  remote?: string;
  branch: string;
  /** How long one `git push` may run before it is killed. */
  attemptTimeoutMs?: number;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

function classify(stderr: string): PushFailureReason {
  if (/!\s*\[rejected\]/u.test(stderr) && /(non-fast-forward|fetch first)/iu.test(stderr)) {
    return "non-fast-forward";
  }
  return "unknown";
}

async function runGit(
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // Never wait on a credential prompt: the deploy key is the only way in.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

export class Pusher {
  private readonly dataDir: string;
  private readonly remote: string;
  private readonly branch: string;
  private readonly attemptTimeoutMs: number;
  private readonly log: NonNullable<PusherOptions["log"]>;

  /** Commits counted so far; `pushedUpTo` is its value when the last successful push started. */
  private committed = 0;
  private pushedUpTo = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private lastPushAt: string | null = null;
  private lastPushMs: number | null = null;
  private lastError: PushStatus["lastError"] = null;

  constructor(opts: PusherOptions) {
    this.dataDir = opts.dataDir;
    this.remote = opts.remote ?? "origin";
    this.branch = opts.branch;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? 8_000;
    this.log = opts.log ?? noopLog;
  }

  /**
   * Counts the commits already ahead of the remote-tracking ref (boot-time
   * commits: sheet-config syncs, migrations, a reused working copy in dev),
   * so the first push carries them. A missing tracking ref counts nothing.
   */
  async countBacklog(): Promise<number> {
    const range = `${this.remote}/${this.branch}..${this.branch}`;
    const result = await runGit(["rev-list", "--count", range], this.dataDir);
    if (result.code !== 0) return 0;
    const ahead = Number.parseInt(result.stdout.trim(), 10);
    if (Number.isFinite(ahead) && ahead > 0) this.committed += ahead;
    return Number.isFinite(ahead) ? ahead : 0;
  }

  /** Called after every local commit. */
  notifyCommit(): void {
    this.committed += 1;
  }

  status(): PushStatus {
    return {
      pendingCommits: Math.max(0, this.committed - this.pushedUpTo),
      lastPushAt: this.lastPushAt,
      lastPushMs: this.lastPushMs,
      lastError: this.lastError,
    };
  }

  /** Whether the remote has refused a fast-forward: retrying cannot fix that, a person has to. */
  diverged(): boolean {
    return this.lastError?.reason === "non-fast-forward";
  }

  /** Push everything pending, after any push already running. */
  push(): Promise<PushOutcome> {
    const next = this.chain.then(() => this.pushOnce());
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * `push()`, but give up *waiting* after `waitMs`. The push itself carries
   * on (or is killed by its own attempt timeout); a caller that stops
   * waiting still gets an honest answer about whether it landed in time.
   */
  async pushWithin(waitMs: number): Promise<PushOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<PushOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), waitMs);
    });
    try {
      return await Promise.race([this.push(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async pushOnce(): Promise<PushOutcome> {
    const target = this.committed;
    if (target <= this.pushedUpTo) return { ok: true, skipped: true };

    const started = Date.now();
    const result = await runGit(
      ["push", this.remote, `${this.branch}:${this.branch}`],
      this.dataDir,
      this.attemptTimeoutMs,
    );
    const durationMs = Date.now() - started;

    if (result.code === 0 && !result.timedOut) {
      this.pushedUpTo = Math.max(this.pushedUpTo, target);
      this.lastPushAt = new Date().toISOString();
      this.lastPushMs = durationMs;
      this.lastError = null;
      this.log.info({ durationMs, commits: target }, "storage: pushed");
      return { ok: true, durationMs };
    }

    const reason: PushFailureReason = result.timedOut ? "timeout" : classify(result.stderr);
    this.lastError = {
      message: (result.stderr || result.stdout || "git push failed").trim().slice(0, 500),
      at: new Date().toISOString(),
      reason,
    };
    const fields = { durationMs, reason, pending: target - this.pushedUpTo };
    if (reason === "non-fast-forward") {
      this.log.error(fields, "storage: push rejected, the data repo has diverged from its remote");
    } else {
      this.log.warn(fields, "storage: push failed; will retry on the next write, tick or shutdown");
    }
    return { ok: false, durationMs, reason };
  }
}
