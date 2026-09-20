import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DocumentOperatorsPanel } from "./DocumentOperatorsPanel.tsx";

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DOC_OPERATORS = [
  { email: "team@example.org", name: "Team", kind: "person" as const, active: true },
];

const ALL_OPERATORS = [
  ...DOC_OPERATORS,
  { email: "extra@example.org", name: "Extra Op", kind: "person" as const, active: true },
  { email: "inactive@example.org", name: "Retired Op", kind: "person" as const, active: false },
];

describe("DocumentOperatorsPanel", () => {
  it("lists the document's operators and offers only active, not-yet-added operators to add", async () => {
    globalThis.fetch = ((url: string) => {
      if (url.endsWith("/operators") && !url.includes("documents")) {
        return Promise.resolve(jsonResponse(200, ALL_OPERATORS));
      }
      return Promise.resolve(jsonResponse(200, DOC_OPERATORS));
    }) as unknown as typeof fetch;

    render(<DocumentOperatorsPanel slug="coalition-charter" />);

    await waitFor(() => {
      expect(screen.getByText(/Team/u)).toBeTruthy();
    });

    const select = screen.getByLabelText(/add an operator/iu) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("extra@example.org");
    expect(optionValues).not.toContain("team@example.org");
    expect(optionValues).not.toContain("inactive@example.org");
  });

  it("adds the selected operator", async () => {
    let addedEmail: string | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        addedEmail = init.body
          ? (JSON.parse(init.body as string) as { email: string }).email
          : undefined;
        return Promise.resolve(jsonResponse(200, { ...ALL_OPERATORS[1], added: true }));
      }
      if (url.endsWith("/operators") && !url.includes("documents")) {
        return Promise.resolve(jsonResponse(200, ALL_OPERATORS));
      }
      return Promise.resolve(jsonResponse(200, DOC_OPERATORS));
    }) as unknown as typeof fetch;

    render(<DocumentOperatorsPanel slug="coalition-charter" />);
    await waitFor(() => expect(screen.getByText(/Team/u)).toBeTruthy());

    const select = screen.getByLabelText(/add an operator/iu);
    fireEvent.change(select, { target: { value: "extra@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(addedEmail).toBe("extra@example.org");
    });
  });

  it("shows the API's last_operator refusal verbatim when removing the last operator", async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(
          jsonResponse(409, {
            error: "last_operator",
            message: "'coalition-charter' would be left with no operators.",
          }),
        );
      }
      if (url.endsWith("/operators") && !url.includes("documents")) {
        return Promise.resolve(jsonResponse(200, ALL_OPERATORS));
      }
      return Promise.resolve(jsonResponse(200, DOC_OPERATORS));
    }) as unknown as typeof fetch;

    render(<DocumentOperatorsPanel slug="coalition-charter" />);
    await waitFor(() => expect(screen.getByText(/Team/u)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /remove/iu }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /remove/iu }).at(-1)!);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("would be left with no operators");
    });
  });
});
