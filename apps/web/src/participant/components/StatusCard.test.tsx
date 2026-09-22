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

  it("signed: shows the heading, the facts and the change/remove actions", () => {
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

    expect(screen.getByRole("heading", { name: "You signed" })).toBeTruthy();
    expect(screen.getByText("Jane Doe, former Academy educator")).toBeTruthy();
    expect(screen.getByText(/^Version 1 · /u)).toBeTruthy();
    expect(screen.getByText("Your name is on the signatory list.")).toBeTruthy();
    expect(screen.getByText("Change how you're listed")).toBeTruthy();
    expect(screen.getByText("Remove my name")).toBeTruthy();
  });

  /**
   * `specs/screens/document.md` § Display Rules 3, *Your listing status is a
   * fact on the card*: the signer who asked not to be named is the one most
   * likely to come back and check, so the card says it rather than leaving
   * it behind "Change how you're listed".
   */
  it("signed but not listed: says so plainly, in the card's own voice", () => {
    renderCard(
      makeBundle({
        signature: {
          capacity: "personal",
          display_name: "Jane Doe",
          conditional: false,
          listed: false,
          signed_on_version: 1,
          revoked: false,
          signed_at: "2026-09-19T12:00:00Z",
        },
      }),
    );

    expect(screen.getByText("Your name is not on the signatory list.")).toBeTruthy();
    expect(screen.getByText("Only the team sees it; you are counted, not named.")).toBeTruthy();
    expect(screen.queryByText("Your name is on the signatory list.")).toBeNull();
  });

  it("says nothing about a list on a document that shows none", () => {
    renderCard(
      makeBundle({
        document: { show_signatories: "count" },
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

    expect(screen.queryByText(/signatory list/u)).toBeNull();
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
    expect(screen.getByText(/You signed version 1 on .* as Jane Doe\./u)).toBeTruthy();
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

    const heading = screen.getByRole("heading", { name: "You signed" });
    expect(document.activeElement).toBe(heading);

    // The heading is short, so the live region carries the facts that changed.
    const status = screen.getByRole("status");
    expect(status.textContent ?? "").toMatch(/You signed version 1 on .* Listed as Jane Doe\./u);
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

    const line = screen.getByText(/^Version 1 · /u).textContent ?? "";
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

    expect(screen.getByText("St. Brigid Parish Council — Sr. Margaret Doyle, Chair")).toBeTruthy();
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

/**
 * `specs/screens/document.md` § Display Rules 3, *Behind the current
 * version* — issue #67: the product knew which version Elena had signed and
 * said nothing, so her name stood against text she had never read.
 */
describe("StatusCard — a signature behind the current version", () => {
  const V1_V3 = [
    {
      number: 1,
      summary: "Initial draft.",
      published_at: "2026-09-01T00:00:00Z",
      final: false,
      dispositions: 0,
    },
    {
      number: 2,
      summary: "Second pass.",
      published_at: "2026-09-10T00:00:00Z",
      final: false,
      dispositions: 0,
    },
    {
      number: 3,
      summary: "Tightened.",
      published_at: "2026-09-20T00:00:00Z",
      final: false,
      dispositions: 0,
    },
  ];

  function signedOn(version: number, extra: Record<string, unknown> = {}) {
    return makeBundle({
      version: { number: 3, summary: "Tightened.", published_at: "2026-09-20T00:00:00Z" },
      versions: V1_V3,
      signature: {
        capacity: "personal",
        display_name: "Elena Vasquez",
        descriptor: "RN, school nurse",
        conditional: false,
        listed: true,
        signed_on_version: version,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
        ...extra,
      },
    });
  }

  it("says the text has changed, compares from the signer's own version, and offers Keep my name", () => {
    renderCard(signedOn(2));

    expect(screen.getByRole("heading", { name: "You signed" })).toBeTruthy();
    expect(screen.getByText("Elena Vasquez, RN, school nurse")).toBeTruthy();
    expect(
      screen.getByText(/The text has changed since you signed \(now version 3\)\./u),
    ).toBeTruthy();

    const compare = screen.getByRole("link", { name: "See what changed" });
    expect(compare.getAttribute("href")).toBe("/i/test-token/history/compare?from=2&to=3");

    expect(screen.getByRole("button", { name: "Keep my name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove my name" })).toBeTruthy();
  });

  it("says nothing once the signature is on the current version", () => {
    renderCard(signedOn(3));

    expect(screen.queryByText(/The text has changed since you signed/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep my name" })).toBeNull();
  });

  it("offers only 'Confirm my signature' when a final version is what the signer is behind", () => {
    const bundle = makeBundle({
      version: {
        number: 3,
        summary: "Final text.",
        published_at: "2026-09-20T00:00:00Z",
        final: true,
      },
      versions: [...V1_V3.slice(0, 2), { ...V1_V3[2]!, final: true }],
      signature: {
        capacity: "personal",
        display_name: "Elena Vasquez",
        conditional: false,
        listed: true,
        signed_on_version: 2,
        revoked: false,
        signed_at: "2026-09-19T12:00:00Z",
      },
    });
    renderCard(bundle);

    expect(screen.getByRole("button", { name: "Confirm my signature" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep my name" })).toBeNull();
    expect(
      screen.getByText(/The text has changed since you signed \(now version 3\)\./u),
    ).toBeTruthy();
  });
});
