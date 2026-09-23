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

/**
 * `specs/screens/document.md` § Display Rules 2 and § Design "Dates": a
 * point on the reader's today shows its time, not its date, and a chip
 * whose deadline passed today says when. Dates are built in the local zone
 * so the case holds wherever the tests run.
 */
function local(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function pointDates(): string[] {
  return Array.from(document.querySelectorAll("section .absolute.top-4 span:last-child")).map(
    (el) => el.textContent ?? "",
  );
}

describe("Timeline — same-day points", () => {
  const sameDay = {
    phase: "closed" as const,
    opened_at: local(22, 10),
    comments_close_at: local(23, 11),
    signing_closes_at: local(23, 14, 30),
  };

  it("today: the points show the time, an earlier day keeps its date", () => {
    render(<Timeline document={sameDay} now={new Date(2026, 8, 23, 15, 0)} />);
    const [openedPoint, closePoint, duePoint] = pointDates();
    expect(openedPoint).toMatch(/^Sep 22/u);
    expect(closePoint).toMatch(/^11\sAM$/u);
    expect(duePoint).toMatch(/^2:30\sPM$/u);
  });

  it("today: a passed chip reads 'today at' the time", () => {
    render(<Timeline document={sameDay} now={new Date(2026, 8, 23, 15, 0)} />);
    expect(screen.getByText(/^today at 11\sAM$/u)).toBeTruthy();
    expect(screen.getByText(/^today at 2:30\sPM$/u)).toBeTruthy();
  });

  it("yesterday: points and passed chips show the date", () => {
    render(<Timeline document={sameDay} now={new Date(2026, 8, 24, 9, 0)} />);
    const [, closePoint, duePoint] = pointDates();
    expect(closePoint).toMatch(/^Sep 23/u);
    expect(duePoint).toMatch(/^Sep 23/u);
    expect(screen.queryByText(/^today at/u)).toBeNull();
    expect(screen.getAllByText(/^Sep 23/u).length).toBe(4);
  });
});
