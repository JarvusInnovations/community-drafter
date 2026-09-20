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
    expect(signedCalled).toBe(true);
  });
});
