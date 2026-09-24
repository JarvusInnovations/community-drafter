import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { CompareScreen } from "./CompareScreen.tsx";
import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { type DocumentDetail } from "./types.ts";
import { VersionsScreen } from "./VersionsScreen.tsx";

afterEach(cleanup);

const DOCUMENT: DocumentDetail = {
  slug: "coalition-charter",
  title: "Coalition Charter",
  state: "open",
  phase: "commenting",
  audience: "closed" as const,
  counts: {
    versions: 3,
    participations: 0,
    signatures: { organizations: 0, individuals: 0, unlisted: 0 },
    submissions: { submitted: 0, draft: 0 },
  },
  versions: [
    {
      number: 3,
      summary: "Tightened term 2.",
      published_at: "2026-09-22T12:00:00Z",
      dispositions: 0,
    },
    { number: 2, summary: "Added a step.", published_at: "2026-09-21T12:00:00Z", dispositions: 1 },
    { number: 1, summary: "First draft.", published_at: "2026-09-20T12:00:00Z", dispositions: 0 },
  ],
};

async function noopRefetch(): Promise<void> {}
const CONTEXT: DocumentContextValue = { document: DOCUMENT, refetch: noopRefetch };

function renderAt(path: string, element: ReactNode, routePath: string) {
  return render(
    <DocumentContext.Provider value={CONTEXT}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </DocumentContext.Provider>,
  );
}

const COMPARE = {
  from: 2,
  to: 3,
  summary: {
    changed: 2,
    added: 0,
    removed: 0,
    items: [
      { kind: "paragraph", change: "changed", count: 1 },
      { kind: "code block", change: "changed", count: 1 },
    ],
  },
  blocks: [
    {
      status: "changed",
      id: "b-11111111",
      html: '<p data-block="b-11111111">Term <del>two</del> <ins>2</ins>.</p>',
    },
    {
      status: "changed",
      id: "c-22222222",
      html: '<div class="diff-stack" data-block="c-22222222"><p class="diff-stack-label" data-change="removed">Removed</p><del class="diff-stack-old"><pre><code>old step\n</code></pre></del><p class="diff-stack-label" data-change="added">Added</p><ins class="diff-stack-new"><pre><code>new step\n</code></pre></ins></div>',
    },
    { status: "same", id: "b-33333333", html: '<p data-block="b-33333333">Unchanged.</p>' },
  ],
};

/** `specs/screens/admin-dashboard.md` § Versions "Compare" (#107). */
describe("admin CompareScreen", () => {
  let requested: string[] = [];

  beforeEach(() => {
    requested = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify(COMPARE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("defaults to latest against previous and renders the summary line and redline from the admin API", async () => {
    const { container } = renderAt(
      "/admin/d/coalition-charter/versions/compare",
      <CompareScreen />,
      "/admin/d/:slug/versions/compare",
    );

    await waitFor(() =>
      expect(screen.getByText("1 paragraph changed, 1 code block changed")).toBeTruthy(),
    );
    expect(requested).toEqual(["/admin/api/documents/coalition-charter/compare?from=2&to=3"]);
    expect(
      screen.getByRole("heading", { level: 2, name: "What changed from version 2 to version 3" }),
    ).toBeTruthy();
    expect(container.querySelector('[data-status="changed"] del')?.textContent).toBe("two");
    expect(container.querySelector(".diff-stack-old pre")?.textContent).toBe("old step\n");
    expect(screen.getByText("Unchanged.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Versions" }).getAttribute("href")).toBe(
      "/admin/d/coalition-charter/versions",
    );
  });

  it("hides unchanged blocks when the URL says so, and reads from/to from the URL", async () => {
    renderAt(
      "/admin/d/coalition-charter/versions/compare?from=1&to=3&hide_unchanged=1",
      <CompareScreen />,
      "/admin/d/:slug/versions/compare",
    );

    await waitFor(() => expect(requested.length).toBe(1));
    expect(requested[0]).toBe("/admin/api/documents/coalition-charter/compare?from=1&to=3");
    await waitFor(() => expect(screen.getByText(/code block changed/u)).toBeTruthy());
    expect(screen.queryByText("Unchanged.")).toBeNull();
    expect((screen.getByLabelText("Hide unchanged paragraphs") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("says there is nothing to compare for a same-version pair without requesting a diff", async () => {
    renderAt(
      "/admin/d/coalition-charter/versions/compare?from=2&to=2",
      <CompareScreen />,
      "/admin/d/:slug/versions/compare",
    );
    await waitFor(() => expect(screen.getByText(/nothing to compare/u)).toBeTruthy());
    expect(requested).toEqual([]);
  });
});

describe("admin VersionsScreen compare links", () => {
  it("offers Compare with previous on every version but v1, and a header Compare versions link", () => {
    renderAt("/admin/d/coalition-charter/versions", <VersionsScreen />, "/admin/d/:slug/versions");

    const perRow = screen
      .getAllByRole("link", { name: "Compare with previous" })
      .map((link) => link.getAttribute("href"));
    expect(perRow).toEqual([
      "/admin/d/coalition-charter/versions/compare?from=2&to=3",
      "/admin/d/coalition-charter/versions/compare?from=1&to=2",
    ]);
    expect(screen.getByRole("link", { name: "Compare versions" }).getAttribute("href")).toBe(
      "/admin/d/coalition-charter/versions/compare",
    );
  });
});
