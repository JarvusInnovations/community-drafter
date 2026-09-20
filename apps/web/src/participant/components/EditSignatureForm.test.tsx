import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EditSignatureForm } from "./EditSignatureForm.tsx";

afterEach(cleanup);

const SIGNATURE = {
  capacity: "official" as const,
  display_name: "Sr. Margaret Doyle",
  org: "St. Brigid Parish Council",
  title: "Chair",
  conditional: false,
  listed: true,
  signed_on_version: 1,
  revoked: false,
  signed_at: "2026-09-20T17:23:00Z",
};

/**
 * Issue #62: the first click on Save did nothing at all — no error, no
 * "Saving…", no request — and only the second one went through. The panel is
 * a form now and the save happens on submit, so one press is one save.
 */
describe("EditSignatureForm — Save takes one press", () => {
  it("sends the patch on the first click, from a field that still has focus", async () => {
    let calls = 0;
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ...SIGNATURE, title: "President" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    let saved = 0;
    render(
      <EditSignatureForm
        signature={SIGNATURE}
        token="test-token"
        onSaved={() => {
          saved += 1;
          return Promise.resolve();
        }}
        onCancel={() => {}}
      />,
    );

    const title = screen.getByLabelText("Your title (optional)");
    fireEvent.change(title, { target: { value: "President" } });
    title.focus();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: /Save|Saving…/u });
    expect(calls).toBe(1);
    expect(body?.title).toBe("President");
    expect(saved).toBe(1);
  });

  it("shows the server's message instead of failing silently", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "phase_closed", message: "Signing has closed.", details: {} }),
        { status: 409, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    render(
      <EditSignatureForm
        signature={SIGNATURE}
        token="test-token"
        onSaved={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Signing has closed.");
  });
});
