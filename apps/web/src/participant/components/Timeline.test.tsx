import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { Timeline } from "./Timeline.tsx";

afterEach(cleanup);

const opened = "2026-09-19T18:00:00Z";
const commentsClose = "2026-09-24T21:00:00Z";
const signingCloses = "2026-10-01T21:00:00Z";

function states() {
  return Array.from(document.querySelectorAll("[data-state]")).map((el) =>
    el.getAttribute("data-state"),
  );
}

/** `plans/timeline-clock.md` § Validation: correct active segment and chip texts per phase. */
describe("Timeline", () => {
  it("commenting: first segment active, both countdowns in the future", () => {
    render(
      <Timeline
        document={{
          phase: "commenting",
          opened_at: opened,
          comments_close_at: commentsClose,
          signing_closes_at: signingCloses,
        }}
        now={new Date("2026-09-20T12:00:00Z")}
      />,
    );
    expect(screen.getByText("Comments close", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Signatures due", { selector: "p" })).toBeTruthy();
    expect(screen.getAllByText(/^in \d+ days? \d+ hours?$|^in \d+ days?$/u).length).toBe(2);
    // chips: comment active, signing pending; segments: same
    expect(states()).toEqual(["active", "pending", "active", "pending"]);
  });

  it("signing: comments closed, second segment active, never a negative countdown", () => {
    render(
      <Timeline
        document={{
          phase: "signing",
          opened_at: opened,
          comments_close_at: commentsClose,
          signing_closes_at: signingCloses,
        }}
        now={new Date("2026-09-26T12:00:00Z")}
      />,
    );
    expect(screen.getByText("Comments closed", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText(/^in -/u)).toBeNull();
    expect(states()).toEqual(["done", "active", "done", "active"]);
  });

  it("closed: both done", () => {
    render(
      <Timeline
        document={{
          phase: "closed",
          opened_at: opened,
          comments_close_at: commentsClose,
          signing_closes_at: signingCloses,
        }}
        now={new Date("2026-10-03T12:00:00Z")}
      />,
    );
    expect(screen.getByText("Signing closed", { selector: "p" })).toBeTruthy();
    expect(states()).toEqual(["done", "done", "done", "done"]);
  });

  it("withdrawn and not-yet-open render a single line, no track", () => {
    const { unmount } = render(<Timeline document={{ phase: "withdrawn" }} />);
    expect(screen.getByText("This document was withdrawn.")).toBeTruthy();
    expect(states()).toEqual([]);
    unmount();
    render(
      <Timeline
        document={{
          phase: "draft",
          comments_close_at: commentsClose,
          signing_closes_at: signingCloses,
        }}
      />,
    );
    expect(screen.getByText(/Not yet open/u)).toBeTruthy();
    expect(states()).toEqual([]);
  });
});
