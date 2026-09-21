import { afterEach, describe, expect, it } from "bun:test";

import { commit } from "./commit.ts";
import { ReadModel } from "./read-model.ts";
import { openDataRepo } from "./repo.ts";
import { createTestDataRepo } from "./test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("ReadModel — version derivation", () => {
  it("counts exactly one version per body change, and none for settings-only commits", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const actor = { kind: "operator" as const, email: "team@example.org" };

    // Creating the record with its initial text is version 1 — the version
    // trailers (Version/Summary) belong on this commit, since it's the one
    // whose body actually changed (nonexistent → "v1 text").
    await commit(
      store,
      "create",
      {
        actor,
        subject: "create: coalition-charter",
        document: "coalition-charter",
        version: 1,
        summary: "Initial draft",
      },
      async (tx) => {
        await tx.documents.upsert({
          slug: "coalition-charter",
          title: "Coalition Charter",
          state: "draft",
          body: "v1 text",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    // A settings-only transition to `open` — same body, no new version.
    await commit(
      store,
      "open",
      {
        actor,
        subject: "open: coalition-charter comments and signing",
        document: "coalition-charter",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "coalition-charter" }, { state: "open" });
      },
    );

    // Settings-only: no body change, must not create a version.
    await commit(
      store,
      "settings",
      { actor, subject: "settings: coalition-charter tags updated", document: "coalition-charter" },
      async (tx) => {
        await tx.documents.patch({ slug: "coalition-charter" }, { tags: ["governance"] });
      },
    );

    // Body change: exactly one more version.
    await commit(
      store,
      "publish",
      {
        actor,
        subject: "publish: coalition-charter v2",
        document: "coalition-charter",
        version: 2,
        summary: "Clarified section 3",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "coalition-charter" }, { body: "v2 text" });
      },
    );

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();

    const doc = readModel.getDocument("coalition-charter");
    expect(doc).toBeDefined();
    expect(doc?.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(doc?.versions[0]?.body).toBe("v1 text");
    expect(doc?.versions[0]?.summary).toBe("Initial draft");
    expect(doc?.versions[1]?.body).toBe("v2 text");
    expect(doc?.versions[1]?.summary).toBe("Clarified section 3");
    expect(doc?.record.body).toBe("v2 text");
    expect(doc?.record.tags).toEqual(["governance"]);
  });

  it("derives the summary from the subject when no Summary trailer is set", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const actor = { kind: "operator" as const, email: "team@example.org" };

    await commit(
      store,
      "publish",
      { actor, subject: "publish: doc-a v1", document: "doc-a", version: 1 },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-a",
          title: "Doc A",
          state: "draft",
          body: "text",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();
    const doc = readModel.getDocument("doc-a");
    // Stripping the "publish: <slug> v<n>" prefix leaves nothing here, so
    // the derivation falls back to the full subject rather than an empty
    // summary (an empty one-line changelog would be worse for "versions
    // are for normies" display than the raw subject).
    expect(doc?.versions[0]?.summary).toBe("publish: doc-a v1");
  });

  it("includes sign/comment/submit commits in a document's activity, not just body/settings commits", async () => {
    // specs/screens/admin-dashboard.md: recent activity is "the last 50
    // commits on this document" — every commit carrying its Document
    // trailer, not only commits that touched documents/<slug>.md.
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const actor = { kind: "operator" as const, email: "team@example.org" };

    await commit(
      store,
      "create",
      { actor, subject: "create: doc-c", document: "doc-c" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-c",
          title: "Doc C",
          state: "open",
          body: "text",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    await commit(
      store,
      "sign",
      {
        actor: { kind: "participant" },
        subject: "sign: jane-doe on doc-c",
        document: "doc-c",
        person: "jane-doe",
        version: 1,
      },
      async (tx) => {
        await tx.people.upsert({
          site: "default",
          id: "jane-doe",
          name: "Jane",
          email: "jane@x.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-c",
          person: "jane-doe",
          token: "f".repeat(20),
          source: "admin",
          signature: { capacity: "personal", display_name: "Jane", authorized: true, listed: true },
        });
      },
    );

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();

    const activityActions = readModel.getDocument("doc-c")?.activity.map((entry) => entry.action);
    // Newest first: sign, then create.
    expect(activityActions).toEqual(["sign", "create"]);
  });

  it("counts a body change made outside the service, with no trailers at all, as a version", async () => {
    // specs/behaviors/versioning.md § Any body change is a version: a
    // teammate editing the record with `gitsheets-axi` or by hand writes a
    // commit carrying none of this service's trailers. It is still a
    // version, read back from its subject and its git author; a trailerless
    // settings-only commit still is not.
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const teammate = { name: "Alex Teammate", email: "alex@example.org" };

    await commit(
      store,
      "create",
      {
        actor: { kind: "operator" as const, email: "team@example.org" },
        subject: "create: doc-hand",
        document: "doc-hand",
        version: 1,
        summary: "Initial draft",
      },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-hand",
          title: "Doc Hand",
          state: "draft",
          body: "v1 text",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    // Straight through the store, the way an outside editor writes: a
    // message, an identity, no trailers.
    await store.transact(
      { message: "Fix the typo in term 2", author: teammate, committer: teammate },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-hand" }, { body: "v2 text, typo fixed" });
      },
    );

    await store.transact(
      { message: "Tag it governance", author: teammate, committer: teammate },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-hand" }, { tags: ["governance"] });
      },
    );

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();
    const doc = readModel.getDocument("doc-hand");

    expect(doc?.versions.map((v) => v.summary)).toEqual([
      "Initial draft",
      "Fix the typo in term 2",
    ]);
    expect(doc?.versions[1]?.body).toBe("v2 text, typo fixed");
    expect(doc?.versions[1]?.published_by).toBe("Alex Teammate");
    // Both outside commits are events on the record even though only one is
    // a version (specs/screens/admin-dashboard.md § Recent activity).
    expect(doc?.activity.map((entry) => entry.subject)).toEqual([
      "Tag it governance",
      "Fix the typo in term 2",
      "create: doc-hand",
    ]);
  });
});

describe("ReadModel — participations, positions, token index", () => {
  it("indexes participations by token, tracks positions, and refreshes incrementally", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const actor = { kind: "operator" as const, email: "team@example.org" };

    await commit(
      store,
      "create",
      { actor, subject: "create: doc-b", document: "doc-b" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-b",
          title: "Doc B",
          state: "open",
          body: "text",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    await commit(
      store,
      "invite",
      { actor, subject: "invite: jane-doe on doc-b", document: "doc-b", person: "jane-doe" },
      async (tx) => {
        await tx.people.upsert({
          site: "default",
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-b",
          person: "jane-doe",
          token: "c".repeat(20),
          source: "admin",
        });
      },
    );

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();

    const byToken = readModel.getParticipationByToken("c".repeat(20));
    expect(byToken?.record.person).toBe("jane-doe");
    expect(readModel.getParticipationByToken("does-not-exist")).toBeUndefined();

    // Submit a comment-only judgement.
    const submitResult = await commit(
      store,
      "submit",
      {
        actor: { kind: "participant" },
        subject: "submit: jane-doe on doc-b v1 (comment)",
        document: "doc-b",
        person: "jane-doe",
        submission: "jane-doe-aaaa",
        version: 1,
        judgement: "comment",
      },
      async (tx) => {
        await tx.submissions.upsert({
          document: "doc-b",
          id: "jane-doe-aaaa",
          person: "jane-doe",
          version: 1,
          state: "submitted",
          judgement: "comment",
          comments: [{ id: "c1", body: "Consider clarifying section 2." }],
        });
      },
    );

    // Incremental update via applyCommit, as the storage plugin does.
    await readModel.applyCommit(submitResult.trailers);

    const position = readModel.getPosition("doc-b", "jane-doe");
    expect(position?.judgement).toBe("comment");
    expect(position?.submissionId).toBe("jane-doe-aaaa");

    const submission = readModel.getSubmission("doc-b", "jane-doe-aaaa");
    expect(submission?.timing.submittedAt).toBeTruthy();
    expect(submission?.timing.startedAt).toBeTruthy();

    // Sign, then revoke — signatureEvents should carry both.
    await commit(
      store,
      "sign",
      {
        actor: { kind: "participant" },
        subject: "sign: jane-doe on doc-b",
        document: "doc-b",
        person: "jane-doe",
        version: 1,
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-b", person: "jane-doe" },
          {
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              authorized: true,
              listed: true,
              signed_on_version: 1,
            },
          },
        );
      },
    );
    await readModel.refreshParticipation("doc-b", "jane-doe");

    const revokeResult = await commit(
      store,
      "revoke",
      {
        actor: { kind: "participant" },
        subject: "revoke: jane-doe on doc-b",
        document: "doc-b",
        person: "jane-doe",
        reason: "changed my mind",
      },
      async (tx) => {
        // `patch`'s second argument replaces `signature` wholesale (it isn't
        // deep-partial), so revoking means merging locally and patching the
        // full nested object — the same shape a real route would follow.
        await tx.participations.patch(
          { document: "doc-b", person: "jane-doe" },
          {
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              authorized: true,
              listed: true,
              signed_on_version: 1,
              revoked: true,
            },
          },
        );
      },
    );
    await readModel.applyCommit(revokeResult.trailers);

    const participation = readModel.getParticipation("doc-b", "jane-doe");
    const actions = participation?.signatureEvents.map((e) => e.action);
    expect(actions).toEqual(["sign", "revoke"]);
    expect(participation?.signatureEvents[1]?.reason).toBe("changed my mind");
  });
});

describe("ReadModel — golden fixture", () => {
  it("matches a hand-derived summary for 3 documents / 50 participations / 20 submissions / 5 versions", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);
    const { store } = await openDataRepo({ dataDir });
    const actor = { kind: "system" as const };

    const documentSlugs = ["doc-one", "doc-two", "doc-three"];
    for (const slug of documentSlugs) {
      await commit(
        store,
        "create",
        { actor, subject: `create: ${slug}`, document: slug },
        async (tx) => {
          await tx.documents.upsert({
            slug,
            title: slug,
            state: "open",
            body: `${slug} v1`,
            created_by: "team@example.org",
            operators: ["team@example.org"],
          });
        },
      );
    }

    // 5 versions total: each doc's `create` is v1; doc-one and doc-two each
    // get one more `publish` (v2); doc-three stays at v1. 3 + 2 = 5.
    const versionPlan: Array<{ slug: string; body: string }> = [
      { slug: "doc-one", body: "doc-one v2" },
      { slug: "doc-two", body: "doc-two v2" },
    ];
    for (const { slug, body } of versionPlan) {
      await commit(
        store,
        "publish",
        { actor, subject: `publish: ${slug} v2`, document: slug, version: 2 },
        async (tx) => {
          await tx.documents.patch({ slug }, { body });
        },
      );
    }

    // 50 participations: person-0..49, split across the 3 documents.
    for (let i = 0; i < 50; i++) {
      const person = `person-${i}`;
      const document = documentSlugs[i % documentSlugs.length] ?? "doc-one";
      await commit(
        store,
        "invite",
        { actor, subject: `invite: ${person} on ${document}`, document, person },
        async (tx) => {
          await tx.people.upsert({
            site: "default",
            id: person,
            name: `Person ${i}`,
            email: `${person}@example.org`,
            source: "crm",
          });
          await tx.participations.upsert({
            document,
            person,
            token: `tok${i}`.padEnd(20, "0"),
            source: "crm",
          });
        },
      );
    }

    // 20 submissions, one per person-0..19, each a draft-then-submit pair.
    for (let i = 0; i < 20; i++) {
      const person = `person-${i}`;
      const document = documentSlugs[i % documentSlugs.length] ?? "doc-one";
      const id = `${person}-s001`;
      await commit(
        store,
        "comment",
        {
          actor: { kind: "participant" },
          subject: `comment: ${person} on ${document} (${id})`,
          document,
          person,
          submission: id,
          version: 1,
        },
        async (tx) => {
          await tx.submissions.upsert({
            document,
            id,
            person,
            version: 1,
            state: "draft",
            comments: [{ id: "c1", body: "a thought" }],
          });
        },
      );
      await commit(
        store,
        "submit",
        {
          actor: { kind: "participant" },
          subject: `submit: ${person} on ${document} v1 (comment)`,
          document,
          person,
          submission: id,
          version: 1,
          judgement: "comment",
        },
        async (tx) => {
          await tx.submissions.patch(
            { document, id },
            { state: "submitted", judgement: "comment" },
          );
        },
      );
    }

    const readModel = new ReadModel(store, dataDir);
    await readModel.build();

    const totalVersions = readModel.listDocuments().reduce((sum, d) => sum + d.versions.length, 0);

    const summary = readModel.summary();
    expect(summary).toEqual({
      documents: 3,
      operators: 0,
      people: 50,
      participations: 50,
      submissions: 20,
      sites: 0,
    });
    expect(totalVersions).toBe(5);

    // Spot-check per-document version counts against the plan above.
    expect(readModel.getDocument("doc-one")?.versions.length).toBe(2);
    expect(readModel.getDocument("doc-two")?.versions.length).toBe(2);
    expect(readModel.getDocument("doc-three")?.versions.length).toBe(1);

    // Every submitted submission should have produced a position.
    for (let i = 0; i < 20; i++) {
      const person = `person-${i}`;
      const document = documentSlugs[i % documentSlugs.length] ?? "doc-one";
      expect(readModel.getPosition(document, person)?.judgement).toBe("comment");
    }
  });
});
