import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { makeBundle } from "../participant/__fixtures__/bundle.ts";
import { type Bundle } from "../participant/types.ts";
import { ViewAsScreen } from "./ViewAsScreen.tsx";

afterEach(cleanup);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderViewAs(bundle: Bundle) {
  globalThis.fetch = (() => Promise.resolve(jsonResponse(bundle))) as unknown as typeof fetch;
  return render(
    <MemoryRouter initialEntries={["/admin/d/coalition-charter/view-as/jane-doe"]}>
      <Routes>
        <Route path="/admin/d/:slug/view-as/:person" element={<ViewAsScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Every control the page renders is disabled, and nothing navigates into
 * the participant app. (The footer's `mailto:` "Questions?" link stays —
 * it acts on nothing and is part of the page an operator is checking.)
 */
function expectEverythingDisabled() {
  const controls = document.querySelectorAll("button, input, textarea, select");
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect((control as HTMLButtonElement).disabled).toBe(true);
  }
  expect(document.querySelectorAll('a[href^="/"]')).toHaveLength(0);
}

/**
 * `specs/screens/admin-dashboard.md` § "View as": the action panel is the
 * participant's own card, not a summary of it — "an unsigned person's view
 * shows the whole sign card ... with every input, checkbox, button and
 * link disabled" (#54).
 */
describe("ViewAsScreen", () => {
  it("renders the whole sign card for an unsigned official-capacity invitee, disabled", async () => {
    renderViewAs(
      makeBundle({
        prefill: { name: "Jane Doe", suggested_capacity: "official", org: "Example Alliance" },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Viewing as Jane Doe (read-only)")).toBeTruthy();
    });

    // The controls an operator came here to check: capacity choice, the
    // prefilled fields, the official-capacity attestation in its exact
    // wording, and the sign button.
    expect(screen.getByRole("radio", { name: /on behalf of an organization/iu })).toBeTruthy();
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Jane Doe");
    expect((screen.getByLabelText("Organization") as HTMLInputElement).value).toBe(
      "Example Alliance",
    );
    expect(
      screen.getByText("I am authorized to sign this on behalf of Example Alliance."),
    ).toBeTruthy();
    // `specs/screens/document.md` § Display Rules 3: in official capacity
    // the button names the organization, not the person.
    expect(screen.getByRole("button", { name: /sign for example alliance/iu })).toBeTruthy();

    expectEverythingDisabled();
  });

  it("renders the signed state with its actions disabled", async () => {
    renderViewAs(
      makeBundle({
        signature: {
          capacity: "personal",
          display_name: "Jane Doe",
          conditional: false,
          listed: true,
          signed_on_version: 1,
          revoked: false,
          signed_at: "2026-09-19T12:00:00Z",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Viewing as Jane Doe (read-only)")).toBeTruthy();
    });

    expect(screen.getByText(/You signed version 1 on/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove my name/iu })).toBeTruthy();
    expect(screen.getByRole("button", { name: /change how you're listed/iu })).toBeTruthy();

    expectEverythingDisabled();

    // `specs/screens/admin-dashboard.md` § View as: "exactly one `h1`" — the
    // admin document layout owns it, so view-as itself contributes none.
    expect(document.querySelectorAll("h1")).toHaveLength(0);
  });
});
