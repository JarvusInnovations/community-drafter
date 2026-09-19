import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { VersionMismatchBar } from "./VersionMismatchBar.tsx";

afterEach(cleanup);

/**
 * `specs/screens/comment-mode.md` § Version mismatch: "'Keep commenting on
 * v2' or 'Move my comments to v3'." The re-anchoring/rebase call itself is
 * covered by `routes/participant/draft.test.ts`'s rebase test; this only
 * covers the bar wiring the right action to the right button.
 */
describe("VersionMismatchBar", () => {
  it("shows both options and calls the matching handler", () => {
    let kept = false;
    let moved = false;
    render(
      <VersionMismatchBar
        draftVersion={2}
        currentVersion={3}
        onKeep={() => {
          kept = true;
        }}
        onMove={() => {
          moved = true;
        }}
        moving={false}
      />,
    );

    expect(screen.getByText("You're commenting on v2; v3 is now current.")).toBeTruthy();

    fireEvent.click(screen.getByText("Keep commenting on v2"));
    expect(kept).toBe(true);
    expect(moved).toBe(false);

    fireEvent.click(screen.getByText("Move my comments to v3"));
    expect(moved).toBe(true);
  });

  it("disables both buttons while a move is in progress", () => {
    render(
      <VersionMismatchBar
        draftVersion={2}
        currentVersion={3}
        onKeep={() => {}}
        onMove={() => {}}
        moving={true}
      />,
    );

    expect((screen.getByText("Keep commenting on v2") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Move my comments to v3") as HTMLButtonElement).disabled).toBe(true);
  });
});
