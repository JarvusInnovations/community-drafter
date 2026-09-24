import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { useDraftTray } from "./useDraftTray.ts";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TOKEN = "test-token";
const DOC = "coalition-charter";
const PERSON = "jane-doe";

describe("useDraftTray — the three-layer save path", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores a comment buffered but never acknowledged (a killed tab before Add), then saves it", async () => {
    // Simulate a prior session that buffered the general comment locally
    // (the key `editGeneral` itself would have used) but the tab was killed
    // before the create request ever landed.
    window.localStorage.setItem(
      `drafter:comment-buffer:${DOC}:${PERSON}:general`,
      JSON.stringify({ body: "Restored text", updatedAt: "2026-09-19T00:00:00Z" }),
    );

    const posted: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/draft") && (!init || init.method === undefined)) {
        return jsonResponse(null);
      }
      if (url.endsWith("/draft/comments") && init?.method === "POST") {
        posted.push(JSON.parse(init.body as string));
        return jsonResponse({
          submission: "jane-doe-abcd",
          id: "c1",
          saved_at: "2026-09-19T00:00:01Z",
        });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDraftTray({ token: TOKEN, documentSlug: DOC, person: PERSON, version: 1, canSave: true }),
    );

    // Immediately after restore, before the save resolves, the item is
    // visible with the "Restored from this device" state.
    await waitFor(() => {
      expect(result.current.general?.body).toBe("Restored text");
    });

    await waitFor(() => {
      expect(result.current.general?.status).toBe("saved");
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.client_id).toBe("general");
    expect(posted[0]?.body).toBe("Restored text");

    // The buffer entry is cleared once the server acknowledges.
    expect(
      window.localStorage.getItem(`drafter:comment-buffer:${DOC}:${PERSON}:general`),
    ).toBeNull();
  });

  it("retries with backoff after the API is unreachable, then succeeds using the same client_id", async () => {
    let calls = 0;
    const clientIds = new Set<string>();
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/draft") && (!init || init.method === undefined)) {
        return jsonResponse(null);
      }
      if (url.endsWith("/draft/comments") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { client_id: string };
        clientIds.add(body.client_id);
        calls += 1;
        if (calls === 1) {
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse({
          submission: "jane-doe-abcd",
          id: "c1",
          saved_at: "2026-09-19T00:00:01Z",
        });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDraftTray({
        token: TOKEN,
        documentSlug: DOC,
        person: PERSON,
        version: 1,
        canSave: true,
        retryDelaysMs: [300],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    let localId = "";
    act(() => {
      localId = result.current.addInline(
        {
          version: 1,
          commit: "",
          block: "b-1",
          heading_path: [],
          quote: "quick brown fox",
          prefix: "",
          suffix: "",
          start: 0,
        },
        "A note about the fox.",
      );
    });

    // First attempt fails → "Not saved, retrying".
    await waitFor(() => {
      const item = result.current.inlineComments.find((c) => c.id === localId);
      expect(item?.status).toBe("retrying");
    });

    // The retry (after the 300ms backoff) succeeds.
    await waitFor(
      () => {
        const item = result.current.inlineComments.find((c) => c.id === localId);
        expect(item?.status).toBe("saved");
      },
      { timeout: 3_000 },
    );

    expect(calls).toBe(2);
    // Same client_id both times — the server-side idempotency this relies
    // on to guarantee exactly one commit only works if retries reuse it.
    expect(clientIds.size).toBe(1);
    expect([...clientIds][0]).toBe(localId);
  });

  it("does not buffer or resend a comment once it's been acknowledged", async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/draft") && (!init || init.method === undefined)) {
        return jsonResponse(null);
      }
      if (url.endsWith("/draft/comments") && init?.method === "POST") {
        return jsonResponse({
          submission: "jane-doe-abcd",
          id: "c1",
          saved_at: "2026-09-19T00:00:01Z",
        });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDraftTray({ token: TOKEN, documentSlug: DOC, person: PERSON, version: 1, canSave: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let localId = "";
    act(() => {
      localId = result.current.addInline(
        {
          version: 1,
          commit: "",
          block: "b-1",
          heading_path: [],
          quote: "quick brown fox",
          prefix: "",
          suffix: "",
          start: 0,
        },
        "Note.",
      );
    });

    await waitFor(() => {
      const item = result.current.inlineComments.find((c) => c.id === localId);
      expect(item?.status).toBe("saved");
    });

    const key = `drafter:comment-buffer:${DOC}:${PERSON}:${localId}`;
    expect(window.localStorage.getItem(key)).toBeNull();
    await sleep(20);
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
