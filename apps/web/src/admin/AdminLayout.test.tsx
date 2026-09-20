import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { AdminLayout } from "./AdminLayout.tsx";
import { LoginScreen } from "./LoginScreen.tsx";

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>documents list</p>} />
          <Route path="d/:slug" element={<p>dashboard</p>} />
        </Route>
        <Route path="/admin/login" element={<LoginScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * `specs/screens/admin-dashboard.md` § Navigation: "Any admin route without
 * a session redirects to `/admin/login` with a return path."
 */
describe("AdminLayout — session guard", () => {
  it("redirects to /admin/login with the current path as ?return=, threaded through to the login POST", async () => {
    let lastBody: { return?: string } | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (url === "/auth/session") {
        return Promise.resolve(
          jsonResponse(401, { error: "unauthenticated", message: "No operator session." }),
        );
      }
      if (url === "/auth/login") {
        lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return Promise.resolve(jsonResponse(202, { ok: true }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderAt("/admin/d/coalition-charter");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in/iu })).toBeTruthy();
    });
    expect(screen.queryByText("dashboard")).toBeNull();

    fireEvent.change(screen.getByLabelText(/email address/iu), {
      target: { value: "ops@example.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in link/iu }));

    await waitFor(() => {
      expect(lastBody?.return).toBe("/admin/d/coalition-charter");
    });
  });

  it("renders the nested route (and never calls /admin/login) once signed in", async () => {
    globalThis.fetch = ((url: string) => {
      if (url === "/auth/session") {
        return Promise.resolve(
          jsonResponse(200, { email: "ops@example.org", expires_at: "2026-01-01T00:00:00Z" }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderAt("/admin");

    await waitFor(() => {
      expect(screen.getByText("documents list")).toBeTruthy();
    });
    expect(screen.getByText("ops@example.org")).toBeTruthy();
  });
});
