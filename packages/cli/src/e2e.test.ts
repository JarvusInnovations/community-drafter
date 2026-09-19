import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

// Cross-package relative import — this file boots the real admin API
// in-process (via `apps/api`'s own test harness) against a temp data repo.
// It's excluded from `tsc -b` (see packages/cli/tsconfig.json) because a
// composite project can't have a source file outside its own rootDir; bun
// test transpiles and runs it directly regardless, so it's still fully
// exercised in `bun test` / CI. `buildTestServer` (not a direct `fastify`
// import here) keeps every third-party module resolving from apps/api's
// own node_modules rather than this package's.
import { buildTestServer, TEST_ADMIN_TOKEN } from "../../../apps/api/src/routes/test-support.ts";

import { main } from "./cli/cli.ts";

interface Harness {
  url: string;
  dataDir: string;
  cleanup: () => void;
}

async function bootServer(): Promise<Harness> {
  process.env.MAILER = "export";
  const { server, dataDir, cleanup: cleanupRepo } = await buildTestServer();

  await server.listen({ port: 0, host: "127.0.0.1" });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    dataDir,
    cleanup: () => {
      void server.close();
      cleanupRepo();
    },
  };
}

/** Run one CLI invocation against the booted harness, capturing stdout and the exit code. */
async function run(
  harness: Harness,
  args: string[],
): Promise<{ output: string; exitCode: number }> {
  process.env.DRAFTER_URL = harness.url;
  process.env.DRAFTER_ADMIN_TOKEN = TEST_ADMIN_TOKEN;

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

describe("drafter-axi end to end (real API, temp data repo)", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("docs create -> versions publish -> docs open -> people import -> people links round-trips against a real API", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);

    const slug = "e2e-charter";

    // 1. docs create
    const create = await run(harness, [
      "docs",
      "create",
      slug,
      "--title",
      "E2E Charter",
      "--owner",
      "owner@example.org",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
    ]);
    expect(create.exitCode).toBe(0);
    expect(create.output).toContain(slug);
    expect(create.output).toContain("draft");

    // 2. versions publish
    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const bodyFile = join(scratch, "body.md");
    writeFileSync(bodyFile, "# E2E Charter\n\nWe hold these truths.\n", "utf8");

    const publish = await run(harness, [
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
    const open = await run(harness, [
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
    const importResult = await run(harness, ["people", "import", slug, peopleFile]);
    expect(importResult.exitCode).toBe(0);
    expect(importResult.output).toContain("invitations_created: 2");

    // 5. people links round trip — the one command allowed to print tokens
    const links = await run(harness, ["people", "links", slug]);
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
    const slug = "e2e-bad-dispositions";

    await run(harness, [
      "docs",
      "create",
      slug,
      "--title",
      "Bad Dispositions",
      "--owner",
      "owner@example.org",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
    ]);

    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const bodyFile = join(scratch, "body.md");
    writeFileSync(bodyFile, "# Bad Dispositions\n\nFirst text.\n", "utf8");
    await run(harness, ["versions", "publish", slug, "--file", bodyFile, "--summary", "v1"]);

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

    const result = await run(harness, [
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

  it("people list never prints a token or email unless --contacts", async () => {
    const harness = await bootServer();
    cleanups.push(harness.cleanup);
    const slug = "e2e-privacy";

    await run(harness, [
      "docs",
      "create",
      slug,
      "--title",
      "Privacy Check",
      "--owner",
      "owner@example.org",
      "--sender-name",
      "The Board",
      "--reply-to",
      "board@example.org",
    ]);

    const scratch = mkdtempSync(join(tmpdir(), "drafter-axi-e2e-"));
    const peopleFile = join(scratch, "people.ndjson");
    const email = "secret-person@example.org";
    writeFileSync(peopleFile, JSON.stringify({ name: "Secret Person", email }), "utf8");
    await run(harness, ["people", "import", slug, peopleFile]);

    const linksJson = await run(harness, ["people", "links", slug, "--json"]);
    const tokenMatch = /\/i\/([^"'\s]+)/.exec(linksJson.output);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1]!;

    const withoutContacts = await run(harness, ["people", "list", slug]);
    expect(withoutContacts.exitCode).toBe(0);
    expect(withoutContacts.output).not.toContain(email);
    expect(withoutContacts.output).not.toContain(token);

    const withContacts = await run(harness, ["people", "list", slug, "--contacts"]);
    expect(withContacts.exitCode).toBe(0);
    expect(withContacts.output).toContain(email);
    expect(withContacts.output).not.toContain(token);

    rmSync(scratch, { recursive: true, force: true });
  }, 30_000);
});
