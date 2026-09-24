import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { JudgementPicker } from "./JudgementPicker.tsx";

afterEach(cleanup);

/**
 * `specs/behaviors/review-and-judgement.md`: "`sign_conditional` / 'make
 * conditional' requires at least one comment in the submission" —
 * `specs/screens/comment-mode.md`: "Conditional options are disabled with a
 * hint when there are no comments." (The API side of this same rule is
 * covered by `routes/participant/submit.test.ts`'s
 * `judgement_requires_comments` case.)
 */
describe("JudgementPicker — the sign_conditional gate", () => {
  it("disables sign_conditional with a hint when there are no comments yet", () => {
    render(
      <JudgementPicker
        value={null}
        onChange={() => {}}
        isCurrentSigner={false}
        hasComments={false}
      />,
    );

    const conditional = screen.getByRole("radio", {
      name: /Sign conditionally — add my name; I want to see my comments addressed/u,
    });
    expect((conditional as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Add at least one comment to sign conditionally.")).toBeTruthy();
  });

  it("enables sign_conditional once there's at least one comment", () => {
    const calls: string[] = [];

    render(
      <JudgementPicker
        value={null}
        onChange={(judgement) => calls.push(judgement)}
        isCurrentSigner={false}
        hasComments={true}
      />,
    );

    const conditional = screen.getByRole("radio", {
      name: /Sign conditionally — add my name; I want to see my comments addressed/u,
    });
    expect((conditional as HTMLInputElement).disabled).toBe(false);

    fireEvent.click(conditional);
    expect(calls).toEqual(["sign_conditional"]);
  });

  it("swaps labels for a current signer ('Make my signature conditional' / 'Remove my signature')", () => {
    render(
      <JudgementPicker
        value={null}
        onChange={() => {}}
        isCurrentSigner={true}
        hasComments={true}
      />,
    );

    expect(screen.getByText("Keep my signature")).toBeTruthy();
    expect(screen.getByText("Make my signature conditional on my comments")).toBeTruthy();
    expect(screen.getByText("Remove my signature")).toBeTruthy();
  });
});
