import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DeviceApprovalScreen } from "./DeviceApprovalScreen.tsx";
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
        <Route path="/auth/device" element={<DeviceApprovalScreen />} />
        <Route path="/admin/login" element={<LoginScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DeviceApprovalScreen", () => {
  it("shows the code and the signed-in operator, then approves it with the CSRF header", async () => {
    let approveCall: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (url === "/auth/session") {
        return Promise.resolve(
          jsonResponse(200, { email: "ops@example.org", expires_at: "2026-01-01T00:00:00Z" }),
        );
      }
      if (url === "/auth/device/approve") {
        approveCall = { url, init: init! };
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderAt("/auth/device?code=ABCD1234");

    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    expect(screen.getByText(/ops@example\.org/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /approve this device/iu }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("close this page");
    });
    expect(approveCall?.url).toBe("/auth/device/approve");
    const headers = new Headers(approveCall?.init.headers);
    expect(headers.get("x-requested-with")).toBe("drafter");
    expect(JSON.parse(approveCall!.init.body as string)).toEqual({ user_code: "ABCD1234" });
  });

  it("redirects to /admin/login with itself as the return path when signed out", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse(401, { error: "unauthenticated", message: "No operator session." }),
      )) as unknown as typeof fetch;

    renderAt("/auth/device?code=WXYZ9999");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in/iu })).toBeTruthy();
    });
  });

  it("shows an error for a missing code without ever calling the API", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("should not be called"));
    }) as unknown as typeof fetch;

    renderAt("/auth/device");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("unknown, or has expired");
    });
    expect(called).toBe(false);
  });
});
