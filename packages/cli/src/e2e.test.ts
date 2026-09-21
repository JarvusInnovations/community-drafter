import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// Cross-package relative import — this file boots the real admin API
// in-process (via `apps/api`'s own test harness) against a temp data repo.
// It's excluded from `tsc -b` (see packages/cli/tsconfig.json) because a
// composite project can't have a source file outside its own rootDir; bun
// test transpiles and runs it directly regardless, so it's still fully
// exercised in `bun test` / CI. `buildTestServer` (not a direct `fastify`
// import here) keeps every third-party module resolving from apps/api's
// own node_modules rather than this package's — including `mintOperatorToken`,
// which resolves its own `jose` dependency from `apps/api/node_modules`
// (not hoisted to a shared root, so importing `jose` straight from this
// file would fail to resolve).
import { mintOperatorToken } from "../../../apps/api/src/auth/tokens.ts";
import {
  buildTestServer,
  TEST_ACTOR,
  TEST_ADMIN_TOKEN,
  TEST_AUTH_SECRET,
} from "../../../apps/api/src/routes/test-support.ts";

import { main } from "./cli/cli.ts";
import { writeProfile } from "./cli/config.ts";

type Server = Awaited<ReturnType<typeof buildTestServer>>["server"];

interface Harness {
  url: string;
  dataDir: string;
  server: Server;
  cleanup: () => void;
}

async function bootServer(env: Record<string, string | undefined> = {}): Promise<Harness> {
  process.env.MAILER = "export";
  const {
    server,
    dataDir,
    cleanup: cleanupRepo,
  } = await buildTestServer({ env: { MAILER: "export", ...env } });

  await server.listen({ port: 0, host: "127.0.0.1" });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    dataDir,
    server,
    cleanup: () => {
      void server.close();
      cleanupRepo();
    },
  };
}

/** Sets DRAFTER_URL/DRAFTER_TOKEN so commands bypass the profile file entirely (the pre-`login` style). */
function withAdminEnv(harness: Harness): void {
  process.env.DRAFTER_URL = harness.url;
  process.env.DRAFTER_TOKEN = TEST_ADMIN_TOKEN;
}

/** Run one CLI invocation, capturing stdout and the exit code. */
async function run(args: string[]): Promise<{ output: string; exitCode: number }> {
  // A real CLI invocation is a fresh process each time, so `main()` only
  // ever needs to *set* `process.exitCode`. Reusing one process across many
  // calls (as this test harness does) means we must reset it ourselves
  // between calls — and reset with `0`, not `undefined`: once Node/Bun's
  // `process.exitCode` has been set to a number, reassigning `undefined`
  // is silently ignored and the stale value leaks into the next call.
  let output = "";
  process.exitCode = 0;
  await main({
    argv: args,
    stdout: {
      write: (chunk: string) => {
        output += chunk;
      },
    },
  });
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = 0;
  return { output, exitCode };
}

function commitSubjects(dataDir: string): string[] {
  const log = execSync("git log --format=%s", { cwd: dataDir, encoding: "utf8" });
  return log.trim().split("\n");
}

function trailersFor(dataDir: string, subjectContains: string): Record<string, string> {
  const hash = execSync(`git log --format=%H --grep=${JSON.stringify(subjectContains)} -n 1`, {
    cwd: dataDir,
    encoding: "utf8",
  }).trim();
  if (!hash) throw new Error(`no commit found with subject containing "${subjectContains}"`);
  const body = execSync(`git show -s --format=%B ${hash}`, { cwd: dataDir, encoding: "utf8" });
  const trailers: Record<string, string> = {};
  for (const line of body.trim().split("\n")) {
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match) trailers[match[1]!] = match[2]!;
  }
  return trailers;
}

function setCookieHeader(response: { headers: { "set-cookie"?: string | string[] } }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error("no Set-Cookie header on response");
  return value.split(";")[0] as string;
}

/** A `purpose: cli` token for `email` whose `iat` is `daysOld` days in the past — mints "silent refresh" scenarios without waiting 30 real days. */
async function mintStaleCliToken(email: string, daysOld: number): Promise<string> {
  const issuedAt = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const minted = await mintOperatorToken({
    purpose: "cli",
    email,
    name: email,
    kind: "person",
    secret: TEST_AUTH_SECRET,
    issuedAt,
  });
  return minted.token;
}

describe("drafter-axi end to end (real API, temp data repo)", () => {
  const cleanups: Array<() => void> = [];
  let originalHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    // Every test gets its own `$HOME`, so `login`/`whoami`/the silent
    // refresh — which all read and write the *real* `~/.config/drafter/`
    // path via `os.homedir()` — never touch this machine's actual profile.
    originalHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "drafter-axi-home-"));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.DRAFTER_URL;
    delete process.env.DRAFTER_TOKEN;
  });

  /**
   * `specs/data-model.md` § Audience + `specs/api/admin-cli.md`: the
   * audience is stored and orthogonal to `public_access`, and `docs show`
   * prints the two side by side so an operator can see they differ.
   */
  it("docs create --audience closed --addressed-to ... --public read, then docs update", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);

    const missing = await run([
      "docs",
      "create",
      "e2e-letter",
      "--title",
      "A letter",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
    ]);
    expect(missing.exitCode).toBe(2);
    expect(missing.output).toContain("--audience");

    const created = await run([
      "docs",
      "create",
      "e2e-letter",
      "--title",
      "A letter",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "closed",
      "--addressed-to",
      "St. Brigid Parish Council",
      "--public",
      "read",
    ]);
    expect(created.exitCode).toBe(0);
    expect(created.output).toContain("audience: closed");
    expect(created.output).toContain("St. Brigid Parish Council");
    expect(created.output).toContain("public_access: read");

    const shown = await run(["docs", "show", "e2e-letter"]);
    expect(shown.exitCode).toBe(0);
    expect(shown.output).toContain("audience: closed");
    expect(shown.output).toContain("public_access: read");
    expect(shown.output).toContain("St. Brigid Parish Council");

    const updated = await run(["docs", "update", "e2e-letter", "--audience", "public"]);
    expect(updated.exitCode).toBe(0);
    expect(updated.output).toContain("audience: public");
    // `--public` was never passed here, so the drafting-time setting stands.
    expect(updated.output).toContain("public_access: read");

    const unaddressed = await run([
      "docs",
      "create",
      "e2e-unaddressed",
      "--title",
      "Unaddressed",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "closed",
    ]);
    expect(unaddressed.exitCode).toBe(2);
    expect(unaddressed.output).toContain("addressed");
  }, 30_000);

  it("docs create -> versions publish -> docs open -> people import -> people links round-trips against a real API", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);

    const slug = "e2e-charter";

    // 1. docs create — the caller (TEST_ACTOR) becomes the first operator; no --owner any more.
    const create = await run([
      "docs",
      "create",
      slug,
      "--title",
      "E2E Charter",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "public",
    ]);
    expect(create.exitCode).toBe(0);
    expect(create.output).toContain(slug);
    expect(create.output).toContain("draft");

    // 2. versions publish
    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const bodyFile = join(scratch, "body.md");
    writeFileSync(bodyFile, "# E2E Charter\n\nWe hold these truths.\n", "utf8");

    const publish = await run([
      "versions",
      "publish",
      slug,
      "--file",
      bodyFile,
      "--summary",
      "Initial charter text",
    ]);
    expect(publish.exitCode).toBe(0);
    expect(publish.output).toContain("commit:");
    expect(publish.output).not.toContain("commit: null");

    // 3. docs open
    const commentsClose = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const signingCloses = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const open = await run([
      "docs",
      "open",
      slug,
      "--comments-close",
      commentsClose,
      "--signing-closes",
      signingCloses,
    ]);
    expect(open.exitCode).toBe(0);
    expect(open.output).toContain("commenting");

    // 4. people import
    const peopleFile = join(scratch, "people.ndjson");
    writeFileSync(
      peopleFile,
      [
        JSON.stringify({ name: "Ada Lovelace", email: "ada@example.org" }),
        JSON.stringify({ name: "Grace Hopper", email: "grace@example.org" }),
      ].join("\n"),
      "utf8",
    );
    const importResult = await run(["people", "import", slug, peopleFile]);
    expect(importResult.exitCode).toBe(0);
    expect(importResult.output).toContain("invitations_created: 2");

    // 4b. people send reports deliveries, and a reminder moments later is
    // refused by the interval rather than mailing everyone a second time
    // (`specs/behaviors/notifications.md` § Sending).
    const sendResult = await run(["people", "send", slug]);
    expect(sendResult.exitCode).toBe(0);
    expect(sendResult.output).toContain("sent: 2");
    expect(sendResult.output).toContain("failed: 0");

    const remindTooSoon = await run(["people", "remind", slug, "--target", "unopened"]);
    expect(remindTooSoon.exitCode).toBe(0);
    expect(remindTooSoon.output).toContain("sent: 0");
    expect(remindTooSoon.output).toContain("skipped_recent: 2");
    expect(remindTooSoon.output).toContain("min_age_hours: 48");
    expect(remindTooSoon.output).toContain("--min-age");

    const remindForced = await run([
      "people",
      "remind",
      slug,
      "--target",
      "unopened",
      "--min-age",
      "0",
    ]);
    expect(remindForced.exitCode).toBe(0);
    expect(remindForced.output).toContain("sent: 2");

    // 5. people links round trip — the one command allowed to print tokens
    const links = await run(["people", "links", slug]);
    expect(links.exitCode).toBe(0);
    expect(links.output).toContain("ada");
    expect(links.output).toContain("/i/");

    // Verify the data repo actually recorded one commit per admin action,
    // with the trailers the API's commit layer writes.
    const subjects = commitSubjects(harness.dataDir);
    expect(subjects.some((s) => s.includes(`create: ${slug}`))).toBe(true);
    expect(subjects.some((s) => s.includes(`publish: ${slug} v1`))).toBe(true);
    expect(subjects.some((s) => s.includes(`open: ${slug}`))).toBe(true);
    expect(subjects.some((s) => s.includes(`invite: 2 people on ${slug}`))).toBe(true);
    expect(subjects.some((s) => s.includes(`link-export: 2 tokens for ${slug}`))).toBe(true);

    const publishTrailers = trailersFor(harness.dataDir, `publish: ${slug} v1`);
    expect(publishTrailers.Actor).toBeTruthy();
    expect(publishTrailers.Document).toBe(slug);

    rmSync(scratch, { recursive: true, force: true });
  }, 30_000);

  it("versions publish --dispositions with an unknown submission:comment ref exits 2", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);
    const slug = "e2e-bad-dispositions";

    await run([
      "docs",
      "create",
      slug,
      "--title",
      "Bad Dispositions",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "public",
    ]);

    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const bodyFile = join(scratch, "body.md");
    writeFileSync(bodyFile, "# Bad Dispositions\n\nFirst text.\n", "utf8");
    await run(["versions", "publish", slug, "--file", bodyFile, "--summary", "v1"]);

    const bodyFile2 = join(scratch, "body2.md");
    writeFileSync(bodyFile2, "# Bad Dispositions\n\nSecond text.\n", "utf8");
    const dispositionsFile = join(scratch, "dispositions.json");
    writeFileSync(
      dispositionsFile,
      JSON.stringify([
        { submission: "no-such-submission", comment: "no-such-comment", outcome: "accepted" },
      ]),
      "utf8",
    );

    const result = await run([
      "versions",
      "publish",
      slug,
      "--file",
      bodyFile2,
      "--summary",
      "v2 with bad dispositions",
      "--dispositions",
      dispositionsFile,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("no-such-submission");

    rmSync(scratch, { recursive: true, force: true });
  }, 30_000);

  it("home identifies the signed-in operator, instance and profile before the documents", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);

    const home = await run([]);
    expect(home.exitCode).toBe(0);
    expect(home.output).toMatch(/signed_in: .*<[^>]+@[^>]+>/u);
    expect(home.output).toMatch(
      new RegExp(`instance: "?${harness.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?`, "u"),
    );
    expect(home.output).toContain("profile: (DRAFTER_TOKEN from the environment)");
    expect(home.output.indexOf("signed_in")).toBeLessThan(home.output.indexOf("documents"));
  });

  it("a leading --profile or --json with no command still opens the home view", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);

    const withProfile = await run(["--profile", "dinobot"]);
    expect(withProfile.exitCode).toBe(0);
    expect(withProfile.output).toMatch(/signed_in: /u);
    expect(withProfile.output).not.toContain("Flags must come after the command");

    const asJson = await run(["--json"]);
    expect(asJson.exitCode).toBe(0);
  });

  it("people list never prints a token or email unless --contacts", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);
    const slug = "e2e-privacy";

    await run([
      "docs",
      "create",
      slug,
      "--title",
      "Privacy Check",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "public",
    ]);

    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const peopleFile = join(scratch, "people.ndjson");
    const email = "secret-person@example.org";
    writeFileSync(peopleFile, JSON.stringify({ name: "Secret Person", email }), "utf8");
    await run(["people", "import", slug, peopleFile]);

    const linksJson = await run(["people", "links", slug, "--json"]);
    const tokenMatch = /\/i\/([^"'\s]+)/.exec(linksJson.output);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1]!;

    const withoutContacts = await run(["people", "list", slug]);
    expect(withoutContacts.exitCode).toBe(0);
    expect(withoutContacts.output).not.toContain(email);
    expect(withoutContacts.output).not.toContain(token);

    const withContacts = await run(["people", "list", slug, "--contacts"]);
    expect(withContacts.exitCode).toBe(0);
    expect(withContacts.output).toContain(email);
    expect(withContacts.output).not.toContain(token);

    rmSync(scratch, { recursive: true, force: true });
  }, 30_000);

  it("login --url completes the device flow, writes a 600-mode profile, and the next command needs no DRAFTER_URL", async () => {
    const harness = await bootServer({ DEV_ADMIN_EMAIL: TEST_ACTOR.email });
    cleanups.push(harness.cleanup);

    // A session cookie for the operator who will approve the device — the
    // dev-shortcut stand-in for "a human clicks the magic link".
    const loginResponse = await harness.server.inject({ method: "GET", url: "/auth/login" });
    const cookie = setCookieHeader(loginResponse);

    // The CLI has no way to hand the test its `user_code` mid-flow (the SDK
    // only writes a command's return value once, at the end) — so this
    // intercepts the outbound `POST /auth/device` call the CLI makes,
    // reads the `user_code` off its response, and approves it against the
    // harness directly, racing the CLI's own poll loop (which retries every
    // few seconds regardless).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const urlStr = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST" && urlStr.endsWith("/auth/device")) {
        void response
          .clone()
          .json()
          .then(async (body: { user_code: string }) => {
            await harness.server.inject({
              method: "POST",
              url: "/auth/device/approve",
              headers: { cookie, "x-requested-with": "drafter" },
              payload: { user_code: body.user_code },
            });
          });
      }
      return response;
    }) as typeof fetch;

    let result: { output: string; exitCode: number };
    try {
      result = await run(["login", TEST_ACTOR.email, "--url", harness.url]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(TEST_ACTOR.email);

    const profilePath = join(tempHome, ".config", "drafter", "default.toml");
    const stat = statSync(profilePath);
    expect(stat.mode & 0o777).toBe(0o600);
    const contents = readFileSync(profilePath, "utf8");
    expect(contents).toContain(`url = "${harness.url}"`);
    expect(contents).toContain(`email = "${TEST_ACTOR.email}"`);

    // The next command works from the profile alone — no DRAFTER_URL/DRAFTER_TOKEN in the environment.
    delete process.env.DRAFTER_URL;
    delete process.env.DRAFTER_TOKEN;
    const whoami = await run(["whoami"]);
    expect(whoami.exitCode).toBe(0);
    expect(whoami.output).toContain(TEST_ACTOR.email);
  }, 30_000);

  it("login without --url or DRAFTER_URL exits 2 with a hint", async () => {
    delete process.env.DRAFTER_URL;
    const result = await run(["login", "someone@example.org"]);
    expect(result.exitCode).toBe(2);
    expect(result.output.toLowerCase()).toContain("instance url");
  });

  it("a stale token (iat > 30 days) triggers a silent refresh before the command runs", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);

    const stale = await mintStaleCliToken(TEST_ACTOR.email, 31);
    writeProfile("default", {
      url: harness.url,
      email: TEST_ACTOR.email,
      token: stale,
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    delete process.env.DRAFTER_URL;
    delete process.env.DRAFTER_TOKEN;

    const result = await run(["whoami"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(TEST_ACTOR.email);

    const profilePath = join(tempHome, ".config", "drafter", "default.toml");
    const contents = readFileSync(profilePath, "utf8");
    expect(contents).not.toContain(stale);
  }, 30_000);

  it("a deactivated operator's refresh fails with the clear sign-in-expired message", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);

    await run([
      "operators",
      "add",
      "stale-bot@example.org",
      "--name",
      "Stale Bot",
      "--kind",
      "bot",
    ]);
    await run(["operators", "update", "stale-bot@example.org", "--active", "false"]);

    const stale = await mintStaleCliToken("stale-bot@example.org", 31);
    writeProfile("default", {
      url: harness.url,
      email: "stale-bot@example.org",
      token: stale,
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    delete process.env.DRAFTER_URL;
    delete process.env.DRAFTER_TOKEN;

    const result = await run(["whoami"]);
    expect(result.exitCode).toBe(5);
    expect(result.output).toContain("Sign-in expired or revoked; run login again");
  }, 30_000);

  it("operators and docs-operators round-trip, printing commit subjects; the last operator is refused", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    withAdminEnv(harness);
    const slug = "e2e-operators";

    const add = await run(["operators", "add", "new-op@example.org", "--name", "New Op"]);
    expect(add.exitCode).toBe(0);
    expect(add.output).toContain("commit:");

    const update = await run(["operators", "update", "new-op@example.org", "--title", "Ops Lead"]);
    expect(update.exitCode).toBe(0);
    expect(update.output).toContain("Ops Lead");
    expect(update.output).toContain("commit:");

    await run([
      "docs",
      "create",
      slug,
      "--title",
      "Operators E2E",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
      "--audience",
      "public",
    ]);

    const docAdd = await run(["docs", "operators", "add", slug, "new-op@example.org"]);
    expect(docAdd.exitCode).toBe(0);
    expect(docAdd.output).toContain("commit:");

    const list = await run(["docs", "operators", slug]);
    expect(list.exitCode).toBe(0);
    expect(list.output).toContain(TEST_ACTOR.email);
    expect(list.output).toContain("new-op@example.org");

    const docRemove = await run(["docs", "operators", "remove", slug, "new-op@example.org"]);
    expect(docRemove.exitCode).toBe(0);
    expect(docRemove.output).toContain("commit:");

    // Only TEST_ACTOR is left on the document — removing it must be refused.
    const lastOperator = await run(["docs", "operators", "remove", slug, TEST_ACTOR.email]);
    expect(lastOperator.exitCode).toBe(3);
    expect(lastOperator.output.toLowerCase()).toContain("operator");

    const remove = await run(["operators", "remove", "new-op@example.org"]);
    expect(remove.exitCode).toBe(0);
  }, 30_000);
});
