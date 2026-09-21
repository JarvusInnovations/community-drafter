import { describe, expect, it } from "bun:test";

import { formatDeadlinesTrailer, parseDeadlinesTrailer } from "./trailers.ts";

describe("the Deadlines trailer", () => {
  it("round-trips the deadlines an extension moved, including one with no previous value", () => {
    const changes = [
      {
        deadline: "comments_close_at" as const,
        from: "2026-09-23T21:00:00.000Z",
        to: "2026-09-25T21:00:00.000Z",
      },
      { deadline: "signing_closes_at" as const, to: "2026-10-02T21:00:00.000Z" },
    ];

    const trailer = formatDeadlinesTrailer(changes);
    expect(trailer).toBe(
      "comments_close_at 2026-09-23T21:00:00.000Z -> 2026-09-25T21:00:00.000Z, " +
        "signing_closes_at (unset) -> 2026-10-02T21:00:00.000Z",
    );
    expect(parseDeadlinesTrailer(trailer!)).toEqual(changes);
  });

  it("writes no trailer when nothing moved, and reads nothing out of a damaged one", () => {
    expect(formatDeadlinesTrailer([])).toBeUndefined();
    expect(parseDeadlinesTrailer("comments_close_at")).toEqual([]);
    expect(parseDeadlinesTrailer("tags (unset) -> governance")).toEqual([]);
  });
});
