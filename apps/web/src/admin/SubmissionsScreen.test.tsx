import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { SubmissionsScreen } from "./SubmissionsScreen.tsx";
import { type DocumentDetail, type SubmissionView } from "./types.ts";

afterEach(cleanup);

const DOCUMENT: DocumentDetail = {
  slug: "coalition-charter",
  title: "Coalition Charter",
  state: "open",
  phase: "commenting",
  counts: {
    versions: 1,
    participations: 2,
    signatures: { organizations: 0, individuals: 0, unlisted: 0 },
    submissions: { submitted: 1, draft: 1 },
  },
  versions: [],
};

async function noopRefetch(): Promise<void> {}
const DOCUMENT_CONTEXT_VALUE: DocumentContextValue = { document: DOCUMENT, refetch: noopRefetch };

function withDocument(children: ReactNode) {
  return (
    <DocumentContext.Provider value={DOCUMENT_CONTEXT_VALUE}>{children}</DocumentContext.Provider>
  );
}

const SUBMITTED: SubmissionView = {
  id: "sub-1",
  author: "Jane Doe",
  person: "jane-doe",
  version: 1,
  state: "submitted",
  judgement: "sign",
  submitted_at: "2026-09-19T12:00:00Z",
  comments: [
    {
      id: "c1",
      anchor: { heading_path: ["Section 1"], quote: "the quoted text" },
      body: "A submitted comment.",
      disposition: null,
    },
  ],
};

const DRAFT: SubmissionView = {
  id: "sub-2",
  author: "John Smith",
  person: "john-smith",
  version: 1,
  state: "draft",
  judgement: null,
  started_at: "2026-09-19T12:00:00Z",
  comments: [{ id: "c2", anchor: null, body: "An unsent draft comment.", disposition: null }],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `plans/admin-dashboard.md` § Validation: "Submissions page shows a draft
 * only under the 'Unsubmitted' group and never renders a comment detached
 * from its submission."
 */
describe("SubmissionsScreen", () => {
  beforeEach(() => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse([SUBMITTED, DRAFT]))) as unknown as typeof fetch;
  });

  it("renders the draft only under Unsubmitted, and every comment inside its own submission", async () => {
    render(
      withDocument(
        <MemoryRouter initialEntries={["/admin/d/coalition-charter/submissions"]}>
          <Routes>
            <Route path="/admin/d/:slug/submissions" element={<SubmissionsScreen />} />
          </Routes>
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("A submitted comment.")).toBeTruthy();
    });

    // The draft appears once, under "Unsubmitted (drafts)" — never inside
    // the "Submitted" group, never sorted among submitted submissions.
    const unsubmittedHeading = screen.getByText("Unsubmitted (drafts)");
    const submittedHeading = screen.getByText("Submitted");
    expect(
      unsubmittedHeading.compareDocumentPosition(submittedHeading) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    const draftBadges = screen.getAllByText("unsubmitted");
    expect(draftBadges).toHaveLength(1);

    // Every comment renders nested two levels deep inside a submission's
    // own outer <li> (its author/version/judgement line, one level up from
    // the comment's own <li>) — never a bare comment floating outside any
    // submission block.
    const submittedComment = screen.getByText("A submitted comment.");
    const submittedSubmissionItem = submittedComment.closest("li")?.parentElement?.closest("li");
    expect(submittedSubmissionItem?.textContent).toContain("Jane Doe");
    expect(submittedSubmissionItem?.textContent).toContain("v1");

    const draftComment = screen.getByText("An unsent draft comment.");
    const draftSubmissionItem = draftComment.closest("li")?.parentElement?.closest("li");
    expect(draftSubmissionItem?.textContent).toContain("John Smith");
    expect(draftSubmissionItem?.textContent).toContain("unsubmitted");
  });

  it("the by-passage view groups comments under headings and links back to the whole submission", async () => {
    render(
      withDocument(
        <MemoryRouter initialEntries={["/admin/d/coalition-charter/submissions?view=passage"]}>
          <Routes>
            <Route path="/admin/d/:slug/submissions" element={<SubmissionsScreen />} />
          </Routes>
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Section 1")).toBeTruthy();
    });

    // The by-passage view only ever shows submitted comments (drafts are
    // never detached into a headings view either).
    expect(screen.queryByText("An unsent draft comment.")).toBeNull();
    const link = screen.getByRole("link", { name: /View full submission/u });
    expect(link.getAttribute("href")).toBe("#submission-sub-1");
  });
});
