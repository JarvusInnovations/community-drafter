import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  audience: "closed" as const,
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
  org: "",
  prefill: { name: "Jane Doe" },
  email: "jane@example.org",
  status: "opened",
  source: "admin",
  opens: 1,
  link_revoked: false,
  signature: null,
  notify: {
    channel: "email",
    my_comments_addressed: true,
    reminders: true,
  },
};

const SECRET_TOKEN = "TotallySecretToken1234567890";

function documentWithVersions(count: number): DocumentDetail {
  return {
    ...DOCUMENT,
    counts: { ...DOCUMENT.counts, versions: count },
    versions: Array.from({ length: count }, (_unused, index) => ({
      number: index + 1,
      summary: `Version ${index + 1}.`,
      published_at: "2026-09-01T00:00:00Z",
      final: false,
      dispositions: 0,
    })),
  };
}

async function noopRefetch(): Promise<void> {}
const DOCUMENT_CONTEXT_VALUE: DocumentContextValue = { document: DOCUMENT, refetch: noopRefetch };
const AT_V2: DocumentContextValue = { document: documentWithVersions(2), refetch: noopRefetch };
const AT_V3: DocumentContextValue = { document: documentWithVersions(3), refetch: noopRefetch };

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

/**
 * `specs/screens/admin-dashboard.md` § People: the signature column carries
 * the version it is attached to and a "behind v3" marker when that version
 * is older than the current one (issue #67).
 */
describe("PeopleScreen — the version a signature is attached to", () => {
  const SIGNED_ON_V2: InvitationRow = {
    ...ROW,
    status: "signed",
    signature: {
      capacity: "personal",
      display_name: "Jane Doe",
      conditional: false,
      listed: true,
      signed_on_version: 2,
      revoked: false,
      signed_at: "2026-09-19T12:00:00Z",
    },
  };

  function renderWith(rows: InvitationRow[], versionCount: number) {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(rows), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as unknown as typeof fetch;

    const context = versionCount === 3 ? AT_V3 : AT_V2;
    return render(
      <DocumentContext.Provider value={context}>
        <MemoryRouter initialEntries={["/admin/d/coalition-charter/people"]}>
          <Routes>
            <Route path="/admin/d/:slug/people" element={<PeopleScreen />} />
          </Routes>
        </MemoryRouter>
      </DocumentContext.Provider>,
    );
  }

  it("shows the version and marks the row behind when the document has moved on", async () => {
    renderWith([SIGNED_ON_V2], 3);

    await waitFor(() => {
      expect(screen.getByText(/personal · v2/u)).toBeTruthy();
    });
    expect(screen.getByText("behind v3")).toBeTruthy();
  });

  it("shows the version with no marker when the signature is on the current one", async () => {
    renderWith([SIGNED_ON_V2], 2);

    await waitFor(() => {
      expect(screen.getByText(/personal · v2/u)).toBeTruthy();
    });
    expect(screen.queryByText(/^behind v/u)).toBeNull();
  });

  it("never marks a revoked signature behind", async () => {
    renderWith(
      [
        {
          ...SIGNED_ON_V2,
          status: "revoked",
          signature: { ...SIGNED_ON_V2.signature!, revoked: true },
        },
      ],
      3,
    );

    await waitFor(() => {
      expect(screen.getByText(/personal \(revoked\) · v2/u)).toBeTruthy();
    });
    expect(screen.queryByText(/^behind v/u)).toBeNull();
  });
});

/**
 * `specs/screens/admin-dashboard.md` § People: every live signature says
 * whether the signer is on the signatory list — *listed* muted, *not listed*
 * amber soft — and a revoked signature says neither. The Listing filter lives
 * beside status and source, in the URL.
 */
describe("PeopleScreen — the listing choice", () => {
  const LISTED: InvitationRow = {
    ...ROW,
    person: "jane-doe",
    name: "Jane Doe",
    status: "signed",
    signature: {
      capacity: "personal",
      display_name: "Jane Doe",
      conditional: false,
      listed: true,
      signed_on_version: 1,
      revoked: false,
      signed_at: "2026-09-19T12:00:00Z",
    },
  };
  const UNLISTED: InvitationRow = {
    ...LISTED,
    person: "sam-reed",
    name: "Sam Reed",
    signature: { ...LISTED.signature!, display_name: "Sam Reed", listed: false },
  };
  const REVOKED: InvitationRow = {
    ...LISTED,
    person: "alex-kim",
    name: "Alex Kim",
    status: "revoked",
    signature: { ...LISTED.signature!, display_name: "Alex Kim", revoked: true },
  };

  let lastRequestUrl: string | null = null;

  /** Stands in for the endpoint's own `listed` filter (`specs/api/admin.md`). */
  function serveFiltered(rows: InvitationRow[]) {
    globalThis.fetch = ((url: string) => {
      lastRequestUrl = url;
      const wanted = new URL(url, "http://localhost").searchParams.get("listed");
      const served =
        wanted === null
          ? rows
          : rows.filter(
              (row) =>
                row.signature !== null &&
                !row.signature.revoked &&
                row.signature.listed === (wanted === "true"),
            );
      return Promise.resolve(
        new Response(JSON.stringify(served), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    lastRequestUrl = null;
    serveFiltered([LISTED, UNLISTED, REVOKED]);
  });

  it("marks a listed signer, an unlisted signer, and neither on a revoked signature", async () => {
    renderAt("/admin/d/coalition-charter/people");

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    // Scoped to the table: the Listing filter's own options read the same.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("listed")).toBeTruthy();
    expect(table.getByText("not listed")).toBeTruthy();
    // One pill each across three rows: the revoked row carries neither.
    expect(table.getAllByText(/^(listed|not listed)$/u)).toHaveLength(2);
    expect(table.getByText(/personal \(revoked\)/u)).toBeTruthy();
  });

  it("reads the listing filter from the URL, narrows the table, and offers a chip to clear it", async () => {
    renderAt("/admin/d/coalition-charter/people?listed=false");

    await waitFor(() => {
      expect(screen.getByText("Sam Reed")).toBeTruthy();
    });
    expect(lastRequestUrl).toContain("listed=false");
    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.queryByText("Alex Kim")).toBeNull();
    expect(screen.getByLabelText("Listing")).toHaveProperty("value", "false");

    fireEvent.click(screen.getByText(/^Listing: not listed/u));

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });
    expect(lastRequestUrl).not.toContain("listed=");
  });

  it("writes the filter back into the URL when it changes", async () => {
    renderAt("/admin/d/coalition-charter/people");
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Listing"), { target: { value: "true" } });

    await waitFor(() => {
      expect(lastRequestUrl).toContain("listed=true");
    });
    expect(screen.queryByText("Sam Reed")).toBeNull();
  });
});
