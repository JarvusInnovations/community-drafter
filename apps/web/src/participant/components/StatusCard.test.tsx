import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { makeBundle } from "../__fixtures__/bundle.ts";
import { StatusCard } from "./StatusCard.tsx";

// `@testing-library/react`'s own auto-cleanup detects a *global*
// `afterEach`; this file imports `afterEach` from `bun:test` as a local
// binding instead, so it doesn't run automatically — wire it explicitly,
// or renders from earlier tests in this file pile up in `document.body`
// and later `screen` queries can match stale DOM.
afterEach(cleanup);

const noop = () => Promise.resolve();

function renderCard(bundle: ReturnType<typeof makeBundle>) {
  return render(
    <MemoryRouter>
      <StatusCard bundle={bundle} token="test-token" refetch={noop} />
    </MemoryRouter>,
  );
}

/**
 * `plans/participant-sign-flow.md` § Validation: "Each of the six
 * status-card states renders from fixture bundles." One test per state in
 * `cardState.ts`'s `CardState` union, checking the mandatory copy
 * (`specs/screens/document.md` § Display Rules 3).
 */
describe("StatusCard — the six states", () => {
  it("not signed: shows the sign form with the reassurance line", () => {
    const bundle = makeBundle({});
    renderCard(bundle);

    expect(screen.getByRole("heading", { name: "Add your name" })).toBeTruthy();
    expect(screen.getByText(/You can remove your name any time until/u)).toBeTruthy();
    expect(screen.getByText("I'd rather not sign")).toBeTruthy();
    expect(screen.getByText("I have comments first")).toBeTruthy();
  });

  it("not signed, after a revocation: shows the removed-on line above the sign form", () => {
    const bundle = makeBundle({
      signature: {
        capacity: "personal",
        display_name: "Jane Doe",
        conditional: false,
        listed: true,
        signed_on_version: 1,
        revoked: true,
        signed_at: "2026-09-19T12:00:00Z",
        revoked_at: "2026-09-19T14:00:00Z",
      },
    });
    renderCard(bundle);

    expect(screen.getByText(/You removed your name on/u)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add your name" })).toBeTruthy();
  });

  it("signed: shows the own-status line and the change/remove actions", () => {
    const bundle = makeBundle({
      signature: {
        capacity: "personal",
        display_name: "Jane Doe",
        descriptor: "former Academy educator",
        conditional: false,
        listed: true,
        signed_on_version: 1,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
      },
    });
    renderCard(bundle);

    expect(
      screen.getByText(/You signed on .* as Jane Doe, former Academy educator\./u),
    ).toBeTruthy();
    expect(screen.getByText("Change how you're listed")).toBeTruthy();
    expect(screen.getByText("Remove my name")).toBeTruthy();
  });

  it("signed conditionally: shows the conditional note", () => {
    const bundle = makeBundle({
      signature: {
        capacity: "personal",
        display_name: "Jane Doe",
        conditional: true,
        listed: true,
        signed_on_version: 1,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
      },
    });
    renderCard(bundle);

    expect(
      screen.getByText(
        "You signed conditionally; we'll show you what changed when the final version is published.",
      ),
    ).toBeTruthy();
  });

  it("signed, final version pending confirmation: shows the final-published line and Confirm my signature", () => {
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
      versions: [
        {
          number: 1,
          summary: "Initial draft.",
          published_at: "2026-09-01T00:00:00Z",
          final: false,
          dispositions: 0,
        },
        {
          number: 2,
          summary: "Final text.",
          published_at: "2026-09-24T00:00:00Z",
          final: true,
          dispositions: 3,
        },
      ],
    });
    renderCard(bundle);

    expect(screen.getByText(/The final text was published/u)).toBeTruthy();
    expect(screen.getByText("Confirm my signature")).toBeTruthy();
  });

  it("declined: shows the decline message and a way to change your mind", () => {
    const bundle = makeBundle({ position: { judgement: "decline", version: 1 } });
    renderCard(bundle);

    expect(screen.getByText("You told us you won't be signing.")).toBeTruthy();
    expect(screen.getByText("Sign as Jane Doe")).toBeTruthy();
  });

  it("closed: shows the closed heading and the participant's own outcome", () => {
    const bundle = makeBundle({
      document: { phase: "closed", state: "closed" },
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
    renderCard(bundle);

    expect(screen.getByText(/The signatory list closed/u)).toBeTruthy();
    expect(screen.getByText(/You signed on .* as Jane Doe\./u)).toBeTruthy();
  });

  it("focus and the live region: signing moves focus to the new heading and announces it (#72)", () => {
    const { rerender } = renderCard(makeBundle({}));

    // Signing itself is `SignForm` POSTing and calling `onSigned` (the
    // parent's `refetch`); the observable effect on `StatusCard` is that
    // its `bundle` prop is re-supplied with the now-signed state, exactly
    // what this `rerender` simulates.
    rerender(
      <MemoryRouter>
        <StatusCard
          bundle={makeBundle({
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              conditional: false,
              listed: true,
              signed_on_version: 1,
              revoked: false,
              signed_at: "2026-09-19T12:00:00Z",
            },
          })}
          token="test-token"
          refetch={noop}
        />
      </MemoryRouter>,
    );

    const heading = screen.getByRole("heading", { name: /You signed on .* as Jane Doe\./u });
    expect(document.activeElement).toBe(heading);

    const status = screen.getByRole("status");
    expect(status.textContent ?? "").toMatch(/You signed on .* as Jane Doe\./u);
  });

  it("focus and the live region: removing a signature moves focus back to the sign form heading (#72)", () => {
    const { rerender } = renderCard(
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

    rerender(
      <MemoryRouter>
        <StatusCard
          bundle={makeBundle({
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              conditional: false,
              listed: true,
              signed_on_version: 1,
              revoked: true,
              signed_at: "2026-09-19T12:00:00Z",
              revoked_at: "2026-09-19T14:00:00Z",
            },
          })}
          token="test-token"
          refetch={noop}
        />
      </MemoryRouter>,
    );

    const heading = screen.getByRole("heading", { name: "Add your name" });
    expect(document.activeElement).toBe(heading);

    const status = screen.getByRole("status");
    expect(status.textContent ?? "").toMatch(/You removed your name on/u);
  });

  /**
   * Issue #63 — `specs/behaviors/signatures.md` § Signing: the date shown is
   * "the time of the commit that put the signature currently in force — the
   * `resign` commit, not the superseded `sign` one."
   */
  it("signed again after a removal: shows the re-signature's time, not the first one's", () => {
    const bundle = makeBundle({
      signature: {
        capacity: "personal",
        display_name: "Jane Doe",
        conditional: false,
        listed: true,
        signed_on_version: 1,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
        resigned_at: "2026-09-20T17:34:00Z",
      },
    });
    renderCard(bundle);

    const line = screen.getByText(/^You signed on /u).textContent ?? "";
    expect(line).toContain("Sep 20");
    expect(line).not.toContain("Sep 19");
  });

  /**
   * `specs/screens/document.md` § Display Rules 3: "In official capacity the
   * line names the organization."
   */
  it("signed in official capacity: names the organization and the title", () => {
    const bundle = makeBundle({
      signature: {
        capacity: "official",
        display_name: "Sr. Margaret Doyle",
        org: "St. Brigid Parish Council",
        title: "Chair",
        conditional: false,
        listed: true,
        signed_on_version: 1,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
      },
    });
    renderCard(bundle);

    expect(
      screen.getByText(
        /You signed on .* for St\. Brigid Parish Council as Sr\. Margaret Doyle, Chair\./u,
      ),
    ).toBeTruthy();
  });

  it("draft line: shows the unsent-comments line alongside whatever the primary state is", () => {
    const bundle = makeBundle({
      submissions: [
        {
          id: "jane-doe-abcd",
          version: 1,
          state: "draft",
          judgement: null,
          comments: [],
        },
      ],
    });
    renderCard(bundle);

    expect(screen.getByText(/You have unsent comments on v1/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue" })).toBeTruthy();
  });
});
