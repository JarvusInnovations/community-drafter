import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { PeopleScreen } from "./PeopleScreen.tsx";
import { type DocumentDetail, type InvitationRow } from "./types.ts";

afterEach(cleanup);

const DOCUMENT: DocumentDetail = {
  slug: "coalition-charter",
  title: "Coalition Charter",
  state: "open",
  phase: "commenting",
  counts: {
    versions: 1,
    participations: 1,
    signatures: { organizations: 0, individuals: 0, unlisted: 0 },
    submissions: { submitted: 0, draft: 0 },
  },
  versions: [],
};

const ROW: InvitationRow = {
  person: "jane-doe",
  name: "Jane Doe",
  email: "jane@example.org",
  status: "opened",
  source: "admin",
  opens: 1,
  link_revoked: false,
  signature: null,
  notify: {
    channel: "email",
    every_revision: false,
    daily_digest: false,
    phase_changes: true,
    my_comments_addressed: true,
    reminders: true,
    forced: [],
  },
};

const SECRET_TOKEN = "TotallySecretToken1234567890";

async function noopRefetch(): Promise<void> {}
const DOCUMENT_CONTEXT_VALUE: DocumentContextValue = { document: DOCUMENT, refetch: noopRefetch };

function withDocument(children: ReactNode) {
  return (
    <DocumentContext.Provider value={DOCUMENT_CONTEXT_VALUE}>{children}</DocumentContext.Provider>
  );
}

function renderAt(path: string) {
  return render(
    withDocument(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/d/:slug/people" element={<PeopleScreen />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe("PeopleScreen — URL-state filters", () => {
  let lastRequestUrl: string | null = null;

  beforeEach(() => {
    lastRequestUrl = null;
    globalThis.fetch = ((url: string) => {
      lastRequestUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify([ROW]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  /** `plans/admin-dashboard.md` § Validation: "People table filters are in the URL and survive reload." */
  it("reads the status filter from the URL on first render (a fresh mount, standing in for reload)", async () => {
    renderAt("/admin/d/coalition-charter/people?status=opened&source=admin&q=Jane");

    await waitFor(() => {
      expect(lastRequestUrl).toContain("status=opened");
    });
    expect(lastRequestUrl).toContain("source=admin");
    expect(lastRequestUrl).toContain("q=Jane");

    expect(screen.getByLabelText("Status")).toHaveProperty("value", "opened");
    expect(screen.getByLabelText("Source")).toHaveProperty("value", "admin");
    expect(screen.getByPlaceholderText("Search name or org…")).toHaveProperty("value", "Jane");
  });

  it("updating a filter writes it back into the URL", async () => {
    renderAt("/admin/d/coalition-charter/people");
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "signed" } });

    await waitFor(() => {
      expect(lastRequestUrl).toContain("status=signed");
    });
  });
});

/**
 * `plans/admin-dashboard.md` § Validation: "no token appears in any
 * rendered page except after the explicit copy/export action, which
 * appears in activity" (checked here via a regex over rendered HTML).
 */
describe("PeopleScreen — tokens never render except after an explicit action", () => {
  beforeEach(() => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/invitations/links")) {
        return Promise.resolve(
          new Response(
            "person,name,email,link\njane-doe,Jane Doe,jane@example.org,/i/" + SECRET_TOKEN,
            {
              status: 200,
              headers: { "content-type": "text/csv" },
            },
          ),
        );
      }
      void init;
      return Promise.resolve(
        new Response(JSON.stringify([ROW]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("shows no token until 'Copy personal link' is clicked", async () => {
    const { container } = renderAt("/admin/d/coalition-charter/people");
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    expect(container.innerHTML).not.toContain(SECRET_TOKEN);

    fireEvent.click(screen.getByText("Copy personal link"));

    await waitFor(() => {
      expect(container.innerHTML).toContain(SECRET_TOKEN);
    });
  });
});
