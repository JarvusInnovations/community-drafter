import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ApiError } from "../api.ts";
import { makeBundle } from "../__fixtures__/bundle.ts";
import { ReviewTray, type ReviewTrayProps } from "./ReviewTray.tsx";

afterEach(cleanup);

function renderTray(overrides: Partial<ReviewTrayProps> = {}) {
  const props: ReviewTrayProps = {
    bundle: makeBundle({}),
    draftVersion: 1,
    currentVersion: 1,
    phaseCommenting: true,
    inlineComments: [],
    general: null,
    pendingCount: 0,
    focusedId: null,
    earlierSubmissions: [],
    sheetOpen: true,
    onToggleSheet: () => {},
    onEditComment: () => {},
    onCommitComment: () => {},
    onRemoveComment: () => {},
    onEditGeneral: () => {},
    onSubmit: () => Promise.resolve(),
    submitting: false,
    ...overrides,
  };
  return render(<ReviewTray {...props} />);
}

/** Issue #64 — `specs/screens/comment-mode.md` § Review tray. */
describe("ReviewTray — a refused submission is never swallowed", () => {
  it("disables submit with a reason while official capacity is unattested", () => {
    renderTray();

    fireEvent.click(screen.getByLabelText(/^Sign — add my name/u));
    fireEvent.click(screen.getByLabelText("On behalf of an organization"));
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "St. Brigid Parish Council" },
    });

    const button = screen.getByRole("button", { name: "Sign and send comments" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Check the box confirming you're authorized to sign for your organization."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByText("I am authorized to sign this on behalf of St. Brigid Parish Council."),
    );
    expect(
      screen.getByRole("button", { name: "Sign and send comments" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows the server's message as an alert when the submission is refused", async () => {
    renderTray({
      general: { id: "general", body: "One thought.", status: "saved" },
      onSubmit: () =>
        Promise.reject(
          new ApiError(409, "phase_closed", "Comments are closed for this document.", {}),
        ),
    });

    fireEvent.click(screen.getByLabelText(/^Comment without signing/u));
    fireEvent.click(screen.getByRole("button", { name: "Send comments" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Comments are closed for this document.");
  });
});
