import { afterEach, describe, expect, it } from "bun:test";

import {
  adminHeaders,
  buildTestServer,
  commitCount,
  seedDocument,
  seedParticipant,
} from "../test-support.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const TOKEN_A = "a".repeat(20);
const TOKEN_B = "b".repeat(20);

describe("draft submission endpoints", () => {
  it("GET draft is null before any comment, then reflects saved comments", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-draft",
      body: "First paragraph.\n\nSecond paragraph.",
    });
    await seedParticipant(server, { document: "doc-draft", person: "jane-doe", token: TOKEN_A });

    const empty = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toBeNull();

    const created = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "General note.", client_id: "c-1" },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json();
    expect(createdBody.id).toBe("c1");
    expect(typeof createdBody.saved_at).toBe("string");
    expect(typeof createdBody.submission).toBe("string");

    const draft = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json();
    expect(draftBody.state).toBe("draft");
    expect(draftBody.version).toBe(1);
    expect(draftBody.comments).toHaveLength(1);
    expect(draftBody.comments[0].body).toBe("General note.");
    expect(draftBody.comments[0].saved_at).toBe(createdBody.saved_at);

    await server.close();
  });

  it("client_id makes POST draft/comments idempotent across retries", async () => {
    const { server, cleanup, dataDir } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-idem" });
    await seedParticipant(server, { document: "doc-idem", person: "jane-doe", token: TOKEN_A });

    const before = await commitCount(dataDir);

    const first = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Note.", client_id: "retry-key" },
    });
    const second = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Note.", client_id: "retry-key" },
    });

    expect(first.json()).toEqual(second.json());

    const draft = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(draft.json().comments).toHaveLength(1);

    // Exactly one `Action: comment` commit landed — the retry replayed the
    // cached response instead of committing again.
    const after = await commitCount(dataDir);
    expect(after - before).toBe(1);

    await server.close();
  });

  it("PUT edits a comment and returns a fresh saved_at; DELETE removes it and deletes the draft when it was the last one", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-edit" });
    await seedParticipant(server, { document: "doc-edit", person: "jane-doe", token: TOKEN_A });

    const created = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "First draft.", client_id: "c-1" },
    });
    const { id, saved_at: firstSavedAt } = created.json();

    const edited = await server.inject({
      method: "PUT",
      url: `/i/${TOKEN_A}/api/draft/comments/${id}`,
      payload: { body: "Edited.", base_saved_at: firstSavedAt },
    });
    expect(edited.statusCode).toBe(200);
    expect(typeof edited.json().saved_at).toBe("string");

    const draft = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(draft.json().comments[0].body).toBe("Edited.");

    const deleted = await server.inject({
      method: "DELETE",
      url: `/i/${TOKEN_A}/api/draft/comments/${id}`,
    });
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(afterDelete.json()).toBeNull();

    await server.close();
  });

  it("PUT with a stale base_saved_at returns 409 stale_edit with the server copy", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-stale" });
    await seedParticipant(server, { document: "doc-stale", person: "jane-doe", token: TOKEN_A });

    const created = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Original.", client_id: "c-1" },
    });
    const { id, saved_at: originalSavedAt } = created.json();

    const firstEdit = await server.inject({
      method: "PUT",
      url: `/i/${TOKEN_A}/api/draft/comments/${id}`,
      payload: { body: "Second version.", base_saved_at: originalSavedAt },
    });
    expect(firstEdit.statusCode).toBe(200);

    // A client still holding the *original* saved_at (e.g. a second tab, or
    // one that never received the first edit's ack) retries against a copy
    // that's now stale.
    const staleEdit = await server.inject({
      method: "PUT",
      url: `/i/${TOKEN_A}/api/draft/comments/${id}`,
      payload: { body: "Conflicting edit.", base_saved_at: originalSavedAt },
    });
    expect(staleEdit.statusCode).toBe(409);
    expect(staleEdit.json().error).toBe("stale_edit");
    expect(staleEdit.json().details.comment.body).toBe("Second version.");

    await server.close();
  });

  it("draft saves are refused with phase_closed once commenting has closed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-closed-comments",
      comments_close_at: new Date(Date.now() - 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-closed-comments",
      person: "jane-doe",
      token: TOKEN_A,
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Too late.", client_id: "c-1" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("phase_closed");

    await server.close();
  });

  it("rebase re-anchors comments to the target version and reports which ones placed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-rebase",
      body: "Untouched paragraph.\n\nOriginal wording here.",
    });
    await seedParticipant(server, { document: "doc-rebase", person: "jane-doe", token: TOKEN_A });

    const bundle1 = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/bundle` });
    const blockId = bundle1.json().version.html.match(/data-block="([^"]+)"/)?.[1];
    expect(blockId).toBeTruthy();

    const created = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: {
        version: 1,
        body: "About the second paragraph.",
        client_id: "c-1",
        anchor: {
          version: 1,
          commit: "deadbeef",
          block: "b-doesnotmatchanything",
          heading_path: [],
          quote: "Original wording here.",
          prefix: "",
          suffix: "",
          start: 0,
        },
      },
    });
    expect(created.statusCode).toBe(200);

    // Publish v2: the first paragraph is untouched (same block id survives);
    // the second is reworded, so the anchor's quote can no longer be found.
    const publish = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-rebase/versions",
      headers: adminHeaders(),
      payload: {
        body: "Untouched paragraph.\n\nCompletely different text now.",
        summary: "Reworded the second paragraph.",
      },
    });
    expect(publish.statusCode).toBe(200);

    const rebase = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/rebase`,
      payload: { to_version: 2 },
    });
    expect(rebase.statusCode).toBe(200);
    const rebaseBody = rebase.json();
    expect(rebaseBody.version).toBe(2);
    expect(rebaseBody.comments).toEqual([{ id: "c1", placed: false }]);

    const draft = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(draft.json().version).toBe(2);
    // The stored anchor's quote is untouched — "comments never orphan
    // silently" (`specs/principles.md`).
    expect(draft.json().comments[0].anchor.quote).toBe("Original wording here.");

    await server.close();
  });

  it("keeps each participant's own draft isolated from the other's", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-isolation" });
    await seedParticipant(server, {
      document: "doc-isolation",
      person: "jane-doe",
      token: TOKEN_A,
    });
    await seedParticipant(server, {
      document: "doc-isolation",
      person: "john-doe",
      token: TOKEN_B,
    });

    await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Jane's private note.", client_id: "jane-1" },
    });
    await server.inject({
      method: "POST",
      url: `/i/${TOKEN_B}/api/draft/comments`,
      payload: { version: 1, body: "John's private note.", client_id: "john-1" },
    });

    const janeDraft = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/draft` });
    expect(janeDraft.json().comments).toHaveLength(1);
    expect(janeDraft.json().comments[0].body).toBe("Jane's private note.");

    const johnDraft = await server.inject({ method: "GET", url: `/i/${TOKEN_B}/api/draft` });
    expect(johnDraft.json().comments).toHaveLength(1);
    expect(johnDraft.json().comments[0].body).toBe("John's private note.");

    const janeBundle = await server.inject({ method: "GET", url: `/i/${TOKEN_A}/api/bundle` });
    const bundleText = JSON.stringify(janeBundle.json());
    expect(bundleText).not.toContain("John's private note.");

    const johnBundle = await server.inject({ method: "GET", url: `/i/${TOKEN_B}/api/bundle` });
    const johnBundleText = JSON.stringify(johnBundle.json());
    expect(johnBundleText).not.toContain("Jane's private note.");

    await server.close();
  });
});
