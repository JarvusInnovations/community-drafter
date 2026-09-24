import { afterEach, describe, expect, it } from "bun:test";

import { commit } from "./commit.ts";
import { logWithTrailers } from "./git-log.ts";
import { openDataRepo } from "./repo.ts";
import { createTestDataRepo } from "./test-helpers.ts";
import { OpenTracker } from "./tracker.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function countCommits(dataDir: string): Promise<number> {
  const proc = Bun.spawn(["git", "rev-list", "--count", "HEAD"], {
    cwd: dataDir,
    stdout: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(stdout.trim());
}

describe("OpenTracker", () => {
  it("never produces more than one commit under a synthetic load of 100 opens, and flushes on demand", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    await commit(
      store,
      "invite",
      { actor: { kind: "system" }, subject: "invite: jane-doe on doc" },
      async (tx) => {
        await tx.people.upsert({
          site: "default",
          id: "jane-doe",
          name: "Jane",
          email: "jane@x.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc",
          person: "jane-doe",
          token: "d".repeat(20),
          source: "admin",
        });
      },
    );

    const before = await countCommits(dataDir);
    // A very long interval — this test flushes explicitly, never via the timer.
    const tracker = new OpenTracker(
      (action, input, fn) => commit(store, action, input, fn),
      3_600_000,
    );

    for (let i = 0; i < 100; i++) {
      tracker.record("doc", "jane-doe");
    }
    expect(tracker.pendingCount()).toBe(1); // one participation, deduped

    const result = await tracker.flush();
    expect(result?.commitHash).toBeTruthy();

    const after = await countCommits(dataDir);
    expect(after - before).toBe(1); // exactly one commit for all 100 opens

    const participation = await store.participations.queryFirst({
      document: "doc",
      person: "jane-doe",
    });
    expect(participation?.opens).toBe(100);
    expect(participation?.first_opened_at).toBeTruthy();
    expect(participation?.last_seen_at).toBeTruthy();

    // A second flush with nothing pending must not produce another commit.
    const noop = await tracker.flush();
    expect(noop).toBeNull();
    expect(await countCommits(dataDir)).toBe(after);
  });

  it("flush on stop (SIGTERM path) commits any pending opens", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    await commit(
      store,
      "invite",
      { actor: { kind: "system" }, subject: "invite: p1 on doc" },
      async (tx) => {
        await tx.people.upsert({
          site: "default",
          id: "p1",
          name: "P1",
          email: "p1@x.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc",
          person: "p1",
          token: "e".repeat(20),
          source: "admin",
        });
      },
    );

    const tracker = new OpenTracker(
      (action, input, fn) => commit(store, action, input, fn),
      60_000,
    );
    tracker.start();
    tracker.record("doc", "p1");

    // Simulate the SIGTERM shutdown path: stop the timer, flush once more.
    tracker.stop();
    const result = await tracker.flush();
    expect(result?.commitHash).toBeTruthy();

    const participation = await store.participations.queryFirst({ document: "doc", person: "p1" });
    expect(participation?.opens).toBe(1);
  });
});

/**
 * `specs/data-model.md` → `Opened`, and `specs/screens/admin-dashboard.md`
 * § Recent activity: the batched commit is per document and names the
 * people whose *first* open it recorded, which is where the feed's
 * `opened` entries come from. A return visit names nobody.
 */
describe("OpenTracker: opens as events", () => {
  it("commits one track per document, naming only first opens", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });

    await commit(
      store,
      "invite",
      { actor: { kind: "system" }, subject: "invite: two people on two documents" },
      async (tx) => {
        for (const [person, document, token] of [
          ["jane-doe", "doc-a", "a"],
          ["rick-roe", "doc-a", "b"],
          ["sam-soe", "doc-b", "c"],
        ] as const) {
          await tx.people.upsert({
            site: "default",
            id: person,
            name: person,
            email: `${person}@x.org`,
            source: "admin",
          });
          await tx.participations.upsert({
            document,
            person,
            token: token.repeat(20),
            source: "admin",
          });
        }
      },
    );

    const opened = new Set<string>();
    const tracker = new OpenTracker(
      (action, input, fn) => commit(store, action, input, fn),
      3_600_000,
      (document, person) => !opened.has(`${document}/${person}`),
    );

    tracker.record("doc-a", "jane-doe");
    tracker.record("doc-a", "rick-roe");
    tracker.record("doc-b", "sam-soe");
    await tracker.flush();
    for (const key of ["doc-a/jane-doe", "doc-a/rick-roe", "doc-b/sam-soe"]) opened.add(key);

    const log = await logWithTrailers(dataDir);
    const tracks = log.filter((entry) => entry.trailers.Action === "track");
    expect(tracks.length).toBe(2); // one per document, not one per person
    const docA = tracks.find((entry) => entry.trailers.Document === "doc-a");
    expect(docA?.trailers.Opened).toBe("jane-doe, rick-roe");
    expect(tracks.find((entry) => entry.trailers.Document === "doc-b")?.trailers.Opened).toBe(
      "sam-soe",
    );

    // A return visit is tracked but is not an event: no `Opened` trailer.
    tracker.record("doc-a", "jane-doe");
    await tracker.flush();
    const after = await logWithTrailers(dataDir);
    const latest = after.at(-1);
    expect(latest?.trailers.Action).toBe("track");
    expect(latest?.trailers.Document).toBe("doc-a");
    expect(latest?.trailers.Opened).toBeUndefined();
  });
});
