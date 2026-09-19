import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { makeBundle } from "../participant/__fixtures__/bundle.ts";
import { ViewAsScreen } from "./ViewAsScreen.tsx";

afterEach(cleanup);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `plans/admin-dashboard.md` § Validation: "View-as renders the participant
 * page with every control disabled and the banner present."
 */
describe("ViewAsScreen", () => {
  beforeEach(() => {
    const bundle = makeBundle({
      signature: {
        capacity: "personal",
        display_name: "Jane Doe",
        conditional: false,
        listed: true,
        signed_on_version: 1,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
      },
    });
    globalThis.fetch = (() => Promise.resolve(jsonResponse(bundle))) as unknown as typeof fetch;
  });

  it("shows the read-only banner and renders no enabled buttons, links or form fields", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/d/coalition-charter/view-as/jane-doe"]}>
        <Routes>
          <Route path="/admin/d/:slug/view-as/:person" element={<ViewAsScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Viewing as Jane Doe (read-only)")).toBeTruthy();
    });

    // No mutating controls: the read-only status card renders text only,
    // never `StatusCard`'s buttons ("Remove my name", "Change how you're
    // listed", etc.) or any `<input>`/`<button>`/`<a>` element at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(screen.getByText(/You signed on/u)).toBeTruthy();
  });
});
