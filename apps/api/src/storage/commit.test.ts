import { afterEach, describe, expect, it } from "bun:test";

import { commit } from "./commit.ts";
import { openDataRepo } from "./repo.ts";
import { createTestDataRepo } from "./test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
  return stdout;
}

describe("commit()", () => {
  it("stamps Action, Actor, Request-Id and action-specific trailers, verified with git interpret-trailers", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    const result = await commit(
      store,
      "sign",
      {
        actor: { kind: "operator", email: "jane@example.org" },
        subject: "sign: jane-doe on coalition-charter",
        document: "coalition-charter",
        person: "jane-doe",
        version: 1,
        requestId: "req-abc123",
      },
      async (tx) => {
        await tx.people.upsert({
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.documents.upsert({
          slug: "coalition-charter",
          title: "Coalition Charter",
          state: "open",
          body: "The charter text.",
          created_by: "jane@example.org",
          operators: ["jane@example.org"],
        });
        await tx.participations.upsert({
          document: "coalition-charter",
          person: "jane-doe",
          token: "a".repeat(20),
          source: "admin",
          signature: {
            capacity: "personal",
            display_name: "Jane Doe",
            authorized: true,
            listed: true,
          },
        });
      },
    );

    expect(result.commitHash).toBeTruthy();
    expect(result.trailers.Action).toBe("sign");
    expect(result.trailers.Actor).toBe("jane@example.org");
    expect(result.trailers.Document).toBe("coalition-charter");
    expect(result.trailers.Person).toBe("jane-doe");
    expect(result.trailers.Version).toBe(1);
    expect(result.trailers["Request-Id"]).toBe("req-abc123");

    // Verify the trailers are really on the commit object, the way an
    // operator or agent would from the shell: read the commit message and
    // pipe it through `git interpret-trailers --parse`.
    const message = await runGit(["log", "-1", "--format=%B"], dataDir);
    const proc = Bun.spawn(["git", "interpret-trailers", "--parse"], {
      cwd: dataDir,
      stdin: "pipe",
      stdout: "pipe",
    });
    proc.stdin.write(message);
    proc.stdin.end();
    const trailerOutput = await new Response(proc.stdout).text();
    await proc.exited;

    expect(trailerOutput).toContain("Action: sign");
    expect(trailerOutput).toContain("Actor: jane@example.org");
    expect(trailerOutput).toContain("Document: coalition-charter");
    expect(trailerOutput).toContain("Person: jane-doe");
    expect(trailerOutput).toContain("Version: 1");
    expect(trailerOutput).toContain("Request-Id: req-abc123");

    const authorLine = await runGit(["log", "-1", "--format=%an <%ae>"], dataDir);
    expect(authorLine.trim()).toBe("jane@example.org <jane@example.org>");
  });

  it("does not commit when the handler stages no mutation", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    const before = (await runGit(["rev-parse", "HEAD"], dataDir)).trim();

    const result = await commit(
      store,
      "track",
      { actor: { kind: "system" }, subject: "track: no-op" },
      async () => {
        // no mutation
      },
    );

    expect(result.commitHash).toBeNull();
    const after = (await runGit(["rev-parse", "HEAD"], dataDir)).trim();
    expect(after).toBe(before);
  });

  it("uses system and participant actor forms", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    const systemResult = await commit(
      store,
      "invite",
      { actor: { kind: "system" }, subject: "invite: 1 person on doc" },
      async (tx) => {
        await tx.people.upsert({ id: "p1", name: "P1", email: "p1@x.org", source: "crm" });
      },
    );
    expect(systemResult.trailers.Actor).toBe("system");

    const participantResult = await commit(
      store,
      "prefs",
      {
        actor: { kind: "participant" },
        subject: "prefs: p1 on doc",
        document: "doc",
        person: "p1",
      },
      async (tx) => {
        await tx.participations.upsert({
          document: "doc",
          person: "p1",
          token: "b".repeat(20),
          source: "crm",
        });
      },
    );
    expect(participantResult.trailers.Actor).toBe("participant");
  });
});
