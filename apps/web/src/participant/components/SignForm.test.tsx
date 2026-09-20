import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { makeBundle } from "../__fixtures__/bundle.ts";
import { SignForm } from "./SignForm.tsx";

afterEach(cleanup);

const noop = () => Promise.resolve();

/**
 * `plans/participant-sign-flow.md` § Validation: "Official capacity cannot
 * be submitted without the attestation checkbox; personal capacity shows
 * the descriptor field with the specified prompt."
 */
describe("SignForm — capacity fields and the attestation gate", () => {
  let fetchCalled = false;

  beforeEach(() => {
    fetchCalled = false;
    // `postSignature` must never reach the network when the client-side
    // attestation gate rejects the submission first.
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error("fetch should not have been called"));
    }) as unknown as typeof fetch;
  });

  it("personal capacity shows the descriptor field with the specified prompt", () => {
    const bundle = makeBundle({});
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    const descriptor = screen.getByLabelText("How would you like to be described? (optional)");
    // The hint is deliberately generic — it appears on every document on the
    // instance, and naming one campaign's subject read as a phishing tell
    // (issue #73).
    expect(descriptor.getAttribute("placeholder")).toBe(
      "your neighborhood, profession, or organization",
    );
    // Official-only fields are absent in personal capacity.
    expect(screen.queryByLabelText("Organization")).toBeNull();
  });

  it("official capacity cannot be submitted without the attestation checkbox", async () => {
    const bundle = makeBundle({});
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    fireEvent.click(screen.getByLabelText("On behalf of an organization"));
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "Save the Academy Coalition" },
    });
    fireEvent.change(screen.getByLabelText("Your title"), { target: { value: "Chair" } });
    // Deliberately leave the attestation checkbox unchecked.
    fireEvent.click(screen.getByRole("button", { name: /^Sign for/u }));

    // The error says what to do, rather than repeating the checkbox label.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Check the box confirming you're authorized to sign for Save the Academy Coalition before adding your name.",
    );
    expect(fetchCalled).toBe(false);
  });

  it("official capacity submits once the attestation checkbox is checked", async () => {
    let posted: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ capacity: "official" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bundle = makeBundle({});
    let signedCalled = false;
    render(
      <SignForm
        bundle={bundle}
        token="test-token"
        onSigned={() => {
          signedCalled = true;
          return Promise.resolve();
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("On behalf of an organization"));
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "Save the Academy Coalition" },
    });
    fireEvent.change(screen.getByLabelText("Your title"), { target: { value: "Chair" } });
    fireEvent.click(
      screen.getByText("I am authorized to sign this on behalf of Save the Academy Coalition."),
    );
    // `specs/screens/document.md` § Display Rules 3: the official-capacity
    // button names the organization.
    fireEvent.click(screen.getByRole("button", { name: "Sign for Save the Academy Coalition" }));

    await screen.findByText(/Signing…|Sign for/u);
    expect(posted?.capacity).toBe("official");
    expect(posted?.org).toBe("Save the Academy Coalition");
    expect(posted?.authorized).toBe(true);
    expect(posted?.title).toBe("Chair");
    // `specs/behaviors/signatures.md` § Consent at signing: the listing
    // choice travels with the signature, decided before it exists.
    expect(posted?.listed).toBe(true);
    expect(signedCalled).toBe(true);
  });

  /**
   * `specs/behaviors/signatures.md` § Capacity: "Official capacity requires
   * a title" (issue #81, decided 2026-09-20).
   */
  it("official capacity refuses a blank title, before the attestation gate", async () => {
    const bundle = makeBundle({});
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    fireEvent.click(screen.getByLabelText("On behalf of an organization"));
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "Save the Academy Coalition" },
    });
    // The field carries `required`, so the empty case never reaches the
    // handler; whitespace is what slips past it and has to be caught here.
    fireEvent.change(screen.getByLabelText("Your title"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign for/u }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Add your title before signing for an organization.");
    expect(fetchCalled).toBe(false);
  });
});

/**
 * `specs/behaviors/signatures.md` § Consent at signing +
 * `specs/screens/document.md` § Display Rules 3: the sentence and the
 * checkbox are on the card *before* the signature exists (issue #70 — the
 * skeptic could not tell who would see their name).
 */
describe("SignForm — who sees your name, and the listing choice", () => {
  it("names who a closed statement goes to, whatever the draft's public_access is", () => {
    const bundle = makeBundle({
      document: {
        audience: "closed",
        addressed_to: ["St. Brigid Parish Council", "City Arts Council"],
      },
    });
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(
        /This statement and its signatory list go to St\. Brigid Parish Council and City Arts Council; the people invited to sign can also see the list\./u,
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText(/List my name on the signatory list/u)).toBeTruthy();
  });

  it("falls back to the invited people on a record written before the field existed", () => {
    const bundle = makeBundle({ document: { audience: "closed", addressed_to: [] } });
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(/This statement and its signatory list go to the people invited to sign\./u),
    ).toBeTruthy();
  });

  it("says a public statement will be published for anyone to read", () => {
    const bundle = makeBundle({ document: { audience: "public", addressed_to: [] } });
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(
        /This statement and its signatory list will be published for anyone to read\./u,
      ),
    ).toBeTruthy();
    const listed = screen.getByLabelText(/List my name publicly/u) as HTMLInputElement;
    expect(listed.checked).toBe(true);
  });

  it("names the recipients of a public statement too", () => {
    const bundle = makeBundle({
      document: { audience: "public", addressed_to: ["the State Board of Education"] },
    });
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(
        /published for anyone to read, addressed to the State Board of Education\./u,
      ),
    ).toBeTruthy();
  });

  it("offers no listing choice when no list is shown at all, and picks the verb by audience", () => {
    const published = makeBundle({
      document: { audience: "public", addressed_to: [], show_signatories: "count" },
    });
    const { unmount } = render(<SignForm bundle={published} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(/Only the number of signatories will be published with this statement/u),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/List my name/u)).toBeNull();
    unmount();

    const delivered = makeBundle({
      document: {
        audience: "closed",
        addressed_to: ["City Arts Council"],
        show_signatories: "none",
      },
    });
    render(<SignForm bundle={delivered} token="test-token" onSigned={noop} />);

    expect(
      screen.getByText(/No signatory list will be delivered with this statement/u),
    ).toBeTruthy();
  });

  it("sends listed: false when the signer turns the listing off before signing", async () => {
    let posted: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ capacity: "personal" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bundle = makeBundle({});
    render(<SignForm bundle={bundle} token="test-token" onSigned={noop} />);

    fireEvent.click(screen.getByLabelText(/List my name on the signatory list/u));
    fireEvent.click(screen.getByRole("button", { name: /^Sign as/u }));

    await screen.findByText(/Signing…|Sign as/u);
    expect(posted?.listed).toBe(false);
  });
});
