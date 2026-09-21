import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SitesScreen } from "./SitesScreen.tsx";
import { type SiteRow } from "./types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DEFAULT_SITE: SiteRow = {
  slug: "default",
  hostname: "drafter.example.org",
  name: "Community Drafter",
  reply_to: "team@example.org",
  operators: ["ops@example.org"],
  documents: 2,
  from_line: "Community Drafter <team@example.org>",
  hostname_verified: true,
  sender_verified: null,
  dns: [],
  default: true,
};

const CUSTOMER_SITE: SiteRow = {
  slug: "letters",
  hostname: "letters.example.org",
  name: "Example Letters",
  sender_email: "letters@example.org",
  reply_to: "hello@example.org",
  operators: ["ops@example.org", "lead@example.org"],
  documents: 1,
  from_line: "Example Letters <letters@example.org>",
  hostname_verified: false,
  sender_verified: null,
  dns: [
    {
      type: "CNAME",
      name: "letters.example.org",
      value: "sites.signatories.org",
      purpose: "Point this hostname at the service",
    },
  ],
  default: false,
};

/**
 * `specs/screens/admin-dashboard.md` § "Sites": one row per site with the
 * From line mail will actually use and honest verification states, plus the
 * DNS a customer still has to add. Nothing here changes DNS.
 */
describe("SitesScreen", () => {
  it("lists each site with its From line, counts and verification state", async () => {
    globalThis.fetch = ((url: string) => {
      if (url === "/admin/api/sites") {
        return Promise.resolve(jsonResponse(200, [DEFAULT_SITE, CUSTOMER_SITE]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<SitesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Example Letters")).toBeTruthy();
    });
    expect(screen.getByText("Example Letters <letters@example.org>")).toBeTruthy();
    expect(screen.getByText("this deployment")).toBeTruthy();
    // The customer hostname has never answered a request here, so it is
    // reported as unverified rather than implied to be live.
    expect(screen.getAllByText("not verified yet").length).toBeGreaterThan(0);
    expect(screen.getByText("DNS still needed for letters.example.org")).toBeTruthy();
  });

  it("says so when there are no sites yet", async () => {
    globalThis.fetch = ((url: string) => {
      if (url === "/admin/api/sites") {
        return Promise.resolve(jsonResponse(200, []));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<SitesScreen />);

    await waitFor(() => {
      expect(
        screen.getByText("No sites yet — every document belongs to this deployment's own site."),
      ).toBeTruthy();
    });
  });
});
