import { describe, expect, it } from "bun:test";

import type { RecipientContext } from "./types.ts";
import {
  closedTemplate,
  closingSoonTemplate,
  digestTemplate,
  dispositionTemplate,
  finalPublishedTemplate,
  invitationTemplate,
  reminderTemplate,
  reviewReceiptTemplate,
  revocationConfirmationTemplate,
  scheduleChangedTemplate,
  signatureConfirmationTemplate,
  signingOpenedTemplate,
  versionTemplate,
} from "./templates.ts";

const OTHER_PARTICIPANT_SECRETS = ["other-person", "other@example.org", "their private comment"];

function buildContext(): RecipientContext {
  return {
    instanceName: "Save the Academy Coalition",
    documentTitle: "Coalition Charter",
    personName: "Jane Doe",
    personEmail: "jane@example.org",
    phaseLabel: "signing",
    nextDeadline: "Sep 20, 2026, 9:14 AM EDT",
    personalLink: "https://drafter.example.org/i/JANE-TOKEN-1234",
    prefsLink: "https://drafter.example.org/i/JANE-TOKEN-1234/prefs",
    stopOptionalLink: "https://drafter.example.org/i/JANE-TOKEN-1234/prefs?stop-optional=1",
    fromName: "Coalition Team",
    fromEmail: "team@example.org",
    replyTo: "team@example.org",
  };
}

function assertNoLeakage(result: { subject: string; text: string; html: string }): void {
  for (const secret of OTHER_PARTICIPANT_SECRETS) {
    expect(result.subject).not.toContain(secret);
    expect(result.text).not.toContain(secret);
    expect(result.html).not.toContain(secret);
  }
}

describe("notification templates", () => {
  const ctx = buildContext();

  it("invitation names the document and links the personal link", () => {
    const result = invitationTemplate(ctx);
    expect(result.subject).toContain("Coalition Charter");
    expect(result.text).toContain(ctx.personalLink);
    assertNoLeakage(result);
  });

  it("signature confirmation states the capacity and is sent regardless of preferences", () => {
    const result = signatureConfirmationTemplate(ctx, { capacity: "official", conditional: false });
    expect(result.subject).toBe("Coalition Charter — you signed");
    expect(result.text).toContain("official");
    assertNoLeakage(result);
  });

  it("conditional signature confirmation mentions confirm/remove", () => {
    const result = signatureConfirmationTemplate(ctx, { capacity: "personal", conditional: true });
    expect(result.text).toContain("conditional");
    assertNoLeakage(result);
  });

  it("revocation confirmation includes the reason when given", () => {
    const result = revocationConfirmationTemplate(ctx, { reason: "changed my mind" });
    expect(result.text).toContain("changed my mind");
    assertNoLeakage(result);
  });

  it("review receipt states judgement and comment count, never another author's comments", () => {
    const result = reviewReceiptTemplate(ctx, { judgement: "decline", commentCount: 0 });
    expect(result.text).toContain("declined");
    assertNoLeakage(result);
  });

  it("version template includes version number, summary and a compare link", () => {
    const result = versionTemplate(ctx, {
      version: 3,
      summary: "Clarified section 2",
      compareLink: "https://drafter.example.org/i/JANE-TOKEN-1234/history/compare?from=2&to=3",
    });
    expect(result.subject).toBe("Coalition Charter — version 3 published");
    expect(result.text).toContain("Clarified section 2");
    expect(result.text).toContain("compare?from=2&to=3");
    assertNoLeakage(result);
  });

  it("digest lists only this recipient's own dispositions and aggregate counts", () => {
    const result = digestTemplate(ctx, {
      versions: [{ number: 3, summary: "Clarified section 2" }],
      dispositions: [{ outcome: "accepted", note: "good catch" }],
      signatoryCounts: { organizations: 2, individuals: 5, unlisted: 1 },
    });
    expect(result.text).toContain("Version 3");
    expect(result.text).toContain("accepted");
    expect(result.text).toContain("2 organizations and 5 individuals");
    assertNoLeakage(result);
  });

  it("signing-opened, closing-soon, closed and schedule-changed all name the document and link the reader", () => {
    for (const template of [
      signingOpenedTemplate,
      closingSoonTemplate,
      closedTemplate,
      scheduleChangedTemplate,
    ]) {
      const result = template(ctx);
      expect(result.text).toContain("Coalition Charter");
      expect(result.text).toContain(ctx.personalLink);
      assertNoLeakage(result);
    }
  });

  it("final-published uses the confirm/remove variant only for conditional signers", () => {
    const plain = finalPublishedTemplate(ctx, { version: 4, conditional: false });
    expect(plain.subject).toBe("Coalition Charter — final version published");

    const conditional = finalPublishedTemplate(ctx, { version: 4, conditional: true });
    expect(conditional.subject).toBe("Coalition Charter — final version, please confirm");
    expect(conditional.text).toContain("Confirm or remove");
    assertNoLeakage(plain);
    assertNoLeakage(conditional);
  });

  it("disposition template lists only this recipient's own outcomes", () => {
    const result = dispositionTemplate(ctx, {
      version: 3,
      outcomes: [{ outcome: "partial", note: "we addressed part of this" }],
    });
    expect(result.text).toContain("partial");
    expect(result.text).toContain("we addressed part of this");
    assertNoLeakage(result);
  });

  it("reminder mentions the occurrence number", () => {
    const first = reminderTemplate(ctx, { n: 1 });
    expect(first.text).toContain("a reminder");
    const second = reminderTemplate(ctx, { n: 2 });
    expect(second.text).toContain("reminder #2");
    assertNoLeakage(first);
    assertNoLeakage(second);
  });

  it("every subscription message includes the prefs link and the stop-optional link", () => {
    const result = versionTemplate(ctx, {
      version: 1,
      summary: "First draft",
      compareLink: ctx.personalLink,
    });
    expect(result.text).toContain(ctx.prefsLink);
    expect(result.text).toContain(ctx.stopOptionalLink);
  });
});
