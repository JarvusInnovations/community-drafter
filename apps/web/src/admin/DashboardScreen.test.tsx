import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DashboardScreen } from "./DashboardScreen.tsx";
import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { type DocumentDetail, type InvitationRow } from "./types.ts";

afterEach(cleanup);

const NOTIFY: InvitationRow["notify"] = {
  channel: "email",
  every_revision: false,
  daily_digest: false,
  phase_changes: true,
  my_comments_addressed: true,
  reminders: true,
  forced: [],
};

function signedRow(person: string, signedOnVersion: number, revoked = false): InvitationRow {
  return {
    person,
    name: person,
    email: `${person}@example.org`,
    status: revoked ? "revoked" : "signed",
    source: "admin",
    opens: 1,
    link_revoked: false,
    signature: {
      capacity: "personal",
      display_name: person,
      conditional: false,
      listed: true,
      signed_on_version: signedOnVersion,
      revoked,
      signed_at: "2026-09-19T12:00:00Z",
    },
    notify: NOTIFY,
  };
}

function documentAt(versionCount: number): DocumentDetail {
  return {
    slug: "casn-sb412-stock-medications",
    title: "Stock medications",
    state: "open",
    phase: "signing",
    audience: "closed" as const,
    operators: ["team@example.org"],
    counts: {
      versions: versionCount,
      participations: 4,
      signatures: { organizations: 0, individuals: 4, unlisted: 0 },
      submissions: { submitted: 0, draft: 0 },
    },
    versions: Array.from({ length: versionCount }, (_unused, index) => ({
      number: index + 1,
      summary: `Version ${index + 1}.`,
      published_at: "2026-09-01T00:00:00Z",
      final: false,
      dispositions: 0,
    })),
  };
}

async function noopRefetch(): Promise<void> {}

const AT_V3: DocumentContextValue = { document: documentAt(3), refetch: noopRefetch };
const AT_V1: DocumentContextValue = { document: documentAt(1), refetch: noopRefetch };

function mockFetch(rows: InvitationRow[], notifications?: Record<string, unknown>): void {
  globalThis.fetch = ((url: string) => {
    const body = url.includes("/invitations")
      ? JSON.stringify(rows)
      : url.includes("/notifications")
        ? JSON.stringify({ sent: {}, pending: 0, failed: 0, ...notifications })
        : JSON.stringify([]);
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
  }) as unknown as typeof fetch;
}

function renderDashboard(context: DocumentContextValue) {
  return render(
    <DocumentContext.Provider value={context}>
      <MemoryRouter initialEntries={[`/admin/d/${context.document.slug}`]}>
        <Routes>
          <Route path="/admin/d/:slug" element={<DashboardScreen />} />
        </Routes>
      </MemoryRouter>
    </DocumentContext.Provider>,
  );
}

/**
 * `specs/screens/admin-dashboard.md` § Funnel — issue #67: "Nothing on
 * `/admin/d/<slug>` says '4 of 4 signatures are attached to version 2;
 * current version is 3.' That is the number I need before I mark anything
 * final."
 */
describe("DashboardScreen — signatures behind the current version", () => {
  beforeEach(() => {
    mockFetch([]);
  });

  it("counts the four nurses still attached to version 2 once version 3 is published", async () => {
    mockFetch([
      signedRow("elena-vasquez", 2),
      signedRow("priya-nair", 2),
      signedRow("marcus-hall", 2),
      signedRow("dana-liu", 2),
    ]);
    renderDashboard(AT_V3);

    const tile = await screen.findByText("Behind current");
    expect(tile.parentElement?.textContent).toContain("4");
  });

  it("does not count a signature on the current version, or a revoked one", async () => {
    mockFetch([signedRow("elena-vasquez", 3), signedRow("priya-nair", 2, true)]);
    renderDashboard(AT_V3);

    const tile = await screen.findByText("Behind current");
    expect(tile.parentElement?.textContent).toContain("0");
  });

  it("shows no tile at all while there is only one version", async () => {
    mockFetch([signedRow("elena-vasquez", 1)]);
    renderDashboard(AT_V1);

    await waitFor(() => {
      expect(screen.getByText("Organizations")).toBeTruthy();
    });
    expect(screen.queryByText("Behind current")).toBeNull();
  });
});

/**
 * `specs/screens/admin-dashboard.md` § Dashboard: the audience is its own
 * line and reads off `audience` / `addressed_to`, never `public_access` —
 * a letter to a named body may be drafted link-readable (issue #88).
 */
describe("DashboardScreen — the audience line", () => {
  beforeEach(() => {
    mockFetch([]);
  });

  it("says who a closed statement is delivered to even when the draft is link-readable", () => {
    renderDashboard({
      document: {
        ...documentAt(1),
        audience: "closed",
        addressed_to: ["St. Brigid Parish Council"],
        public_access: "read",
      },
      refetch: noopRefetch,
    });

    const line = screen.getByText("Audience:").parentElement;
    expect(line?.textContent).toContain("Delivered, not published");
    expect(line?.textContent).toContain("addressed to St. Brigid Parish Council");
    // `public_access` drives only the copy-link affordance, not this line.
    expect(screen.getByText("Copy public link")).toBeTruthy();
  });

  it("says a public statement is published for anyone to read", () => {
    renderDashboard({
      document: { ...documentAt(1), audience: "public" },
      refetch: noopRefetch,
    });

    const line = screen.getByText("Audience:").parentElement;
    expect(line?.textContent).toContain("Published for anyone to read");
    expect(line?.textContent).not.toContain("addressed to");
  });
});

/**
 * `specs/screens/admin-dashboard.md` § Notification health — issue #74:
 * the operators' own mail is the one delivery figure `notified` cannot
 * show, because an operator message writes nothing to any participation.
 */
describe("DashboardScreen — the last operator digest", () => {
  it("names the day the last operator digest went out", async () => {
    mockFetch([], { operator_digest_sent: "2026-09-20" });
    renderDashboard(AT_V3);

    const line = await screen.findByText(/Last operator digest/u);
    expect(line.textContent).toContain("Sep 20");
  });

  it("says so plainly when none has gone out", async () => {
    mockFetch([]);
    renderDashboard(AT_V3);

    const line = await screen.findByText(/Last operator digest/u);
    expect(line.textContent).toContain("none yet");
  });
});
