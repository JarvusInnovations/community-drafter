import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { LoginScreen } from "./LoginScreen.tsx";

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function submit(email: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/email address/iu), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send sign-in link/iu }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toContain(
      "If that address belongs to an operator",
    );
  });
}

/**
 * `specs/screens/admin-dashboard.md` § Sign-in: "one email field and a
 * button; after submit, always [the sentence] ... No other text." This is
 * the load-bearing property — the same response for an operator and a
 * non-operator email.
 */
describe("LoginScreen — never reveals operator status", () => {
  it("shows the identical sentence whether the API 202s an operator or a non-operator address", async () => {
    let lastBody: unknown;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return Promise.resolve(jsonResponse(202, { ok: true }));
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/admin/login"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    await submit("real-operator@example.org");
    expect((lastBody as { email: string }).email).toBe("real-operator@example.org");
  });

  it("shows the same sentence even when the request itself fails (network error)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/admin/login"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    await submit("not-an-operator@example.org");
    // No error text, no distinguishing content beyond the one sentence.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes the return path from the URL through to POST /auth/login", async () => {
    let lastBody: unknown;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return Promise.resolve(jsonResponse(202, { ok: true }));
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/admin/login?return=%2Fadmin%2Fd%2Fcharter"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    await submit("someone@example.org");
    expect((lastBody as { return?: string }).return).toBe("/admin/d/charter");
  });
});
