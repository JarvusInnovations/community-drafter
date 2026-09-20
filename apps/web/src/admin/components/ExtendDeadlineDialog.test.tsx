import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExtendDeadlineDialog } from "./ExtendDeadlineDialog.tsx";
import { type DocumentDetail } from "../types.ts";

afterEach(cleanup);

const DOCUMENT: DocumentDetail = {
  slug: "coalition-charter",
  title: "Coalition Charter",
  state: "open",
  phase: "commenting",
  audience: "closed" as const,
  comments_close_at: "2026-09-23T21:00:00Z",
  signing_closes_at: "2026-09-30T21:00:00Z",
  counts: {
    versions: 1,
    participations: 0,
    signatures: { organizations: 0, individuals: 0, unlisted: 0 },
    submissions: { submitted: 0, draft: 0 },
  },
  versions: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `plans/admin-dashboard.md` § Validation: extend-deadline dialog error and success paths. */
describe("ExtendDeadlineDialog", () => {
  it("shows the deadline_not_later message on an earlier time", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse(409, {
          error: "deadline_not_later",
          message: "comments_close_at must move later, never earlier.",
          details: {},
        }),
      )) as unknown as typeof fetch;

    render(
      <ExtendDeadlineDialog open document={DOCUMENT} onClose={() => {}} onExtended={() => {}} />,
    );

    fireEvent.click(screen.getByText("Extend"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("must move later, never earlier");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the resulting commit on success", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse(200, {
          ...DOCUMENT,
          comments_close_at: "2026-09-25T21:00:00Z",
          commit: "abc1234",
        }),
      )) as unknown as typeof fetch;

    let extended = false;
    render(
      <ExtendDeadlineDialog
        open
        document={DOCUMENT}
        onClose={() => {}}
        onExtended={() => {
          extended = true;
        }}
      />,
    );

    fireEvent.click(screen.getByText("Extend"));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("abc1234");
    });
    expect(extended).toBe(true);
  });
});
