import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { OperatorsScreen } from "./OperatorsScreen.tsx";
import { SessionContext, type SessionContextValue } from "./SessionContext.tsx";

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function noopRefetch(): Promise<void> {}

const SESSION: SessionContextValue = {
  session: { email: "me@example.org", expires_at: "2026-01-01T00:00:00Z" },
  refetch: noopRefetch,
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={SESSION}>
        <OperatorsScreen />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
}

const OPERATORS = [
  { email: "me@example.org", name: "Me", kind: "person" as const, active: true },
  { email: "bot@example.org", name: "Reminder Bot", kind: "bot" as const, active: true },
];

describe("OperatorsScreen", () => {
  it("lists operators and disables deactivate/remove for the signed-in operator's own row", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse(200, OPERATORS))) as unknown as typeof fetch;

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText("Reminder Bot")).toBeTruthy();
    });

    const rows = screen.getAllByRole("row");
    const selfRow = rows.find((row) => row.textContent?.includes("me@example.org"))!;
    const otherRow = rows.find((row) => row.textContent?.includes("bot@example.org"))!;

    expect(
      within(selfRow)
        .getByRole("button", { name: /deactivate/iu })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(otherRow)
        .getByRole("button", { name: /deactivate/iu })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("adds an operator and shows the resulting commit subject", async () => {
    let created: unknown;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        created = init.body ? JSON.parse(init.body as string) : undefined;
        return Promise.resolve(
          jsonResponse(201, {
            email: "new-op@example.org",
            name: "New Op",
            kind: "person",
            active: true,
            commit: "abc1234",
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, OPERATORS));
    }) as unknown as typeof fetch;

    renderScreen();
    await waitFor(() => expect(screen.getByText("Reminder Bot")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Add operator" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new-op@example.org" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Op" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("abc1234");
    });
    expect((created as { email: string }).email).toBe("new-op@example.org");
  });

  it("removing an operator requires confirmation and shows the commit subject", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, { ok: true, commit: "def5678" }));
      }
      return Promise.resolve(jsonResponse(200, OPERATORS));
    }) as unknown as typeof fetch;

    renderScreen();
    await waitFor(() => expect(screen.getByText("Reminder Bot")).toBeTruthy());

    const rows = screen.getAllByRole("row");
    const otherRow = rows.find((row) => row.textContent?.includes("bot@example.org"))!;
    fireEvent.click(within(otherRow).getByRole("button", { name: /remove/iu }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /remove/iu }).at(-1)!);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("def5678");
    });
  });
});
