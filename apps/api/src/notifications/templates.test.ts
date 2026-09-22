import { describe, expect, it } from "bun:test";

import type { RecipientContext } from "./types.ts";
import {
  closedTemplate,
  closingSoonTemplate,
  digestTemplate,
  dispositionTemplate,
  finalPublishedTemplate,
  invitationTemplate,
  listingChangedTemplate,
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
    siteName: "Save the Academy Coalition",
    documentTitle: "Coalition Charter",
    personName: "Jane Doe",
    firstName: "Jane",
    personEmail: "jane@example.org",
    senderName: "Coalition Team",
    clockLine: "Signatures are due Sun, Sep 20 · 9:14 AM EDT.",
    personalLink: "https://drafter.example.org/i/JANE-TOKEN-1234",
    prefsLink: "https://drafter.example.org/i/JANE-TOKEN-1234/prefs",
    stopOptionalLink: "https://drafter.example.org/i/JANE-TOKEN-1234/prefs?stop-optional=1",
    fromName: "Coalition Team",
    fromEmail: "team@example.org",
    replyTo: "team@example.org",
    tag: "default",
  };
}

function assertNoLeakage(result: { subject: string; text: string; html: string }): void {
  for (const secret of OTHER_PARTICIPANT_SECRETS) {
    expect(result.subject).not.toContain(secret);
    expect(result.text).not.toContain(secret);
    expect(result.html).not.toContain(secret);
  }
}

/**
 * `specs/behaviors/notifications.md` § Content rules "Shape": greeting by
 * first name, the clock sentence, exactly one button whose URL also appears
 * in plain text, the private-link small print, and the same words in both
 * parts.
 */
function assertShape(result: { subject: string; text: string; html: string }): void {
  expect(result.text.startsWith("Hi Jane,\n\n")).toBe(true);
  expect(result.text).toContain("Signatures are due Sun, Sep 20 · 9:14 AM EDT.");
  expect(result.text).toContain("This link is yours alone; please don't forward it.");
  const buttons = result.html.match(/display:inline-block;background:#2457f5/g) ?? [];
  expect(buttons).toHaveLength(1);
  expect(result.html).toContain("Or paste this link into your browser:");
  expect(result.html).not.toContain("<img");
  expect(result.text).not.toContain("Coalition Team <");
  assertPreferenceFooter(result);
}

/**
 * `specs/behaviors/notifications.md` § Content rules: "**Every message to a
 * participant** ends with 'Manage how we contact you' ... and a one-click
 * 'stop all optional messages' link" — transactional messages included.
 * Both parts say the same words, and both URLs carry this recipient's own
 * personal-link token.
 */
function assertPreferenceFooter(result: { text: string; html: string }): void {
  const ctx = buildContext();
  expect(result.text).toContain(`Manage how we contact you: ${ctx.prefsLink}`);
  expect(result.text).toContain(`Stop optional messages: ${ctx.stopOptionalLink}`);
  expect(result.html).toContain(`href="${ctx.prefsLink}"`);
  expect(result.html).toContain(`href="${ctx.stopOptionalLink}"`);
  // The token is what makes the links personal — a footer pointing at a
  // token-less `/prefs` would land nobody anywhere.
  expect(result.text).toContain("JANE-TOKEN-1234/prefs");
}

describe("notification templates", () => {
  const ctx = buildContext();

  it("invitation speaks as the sender, names the document and offers one action", () => {
    const result = invitationTemplate(ctx);
    expect(result.subject).toContain("Coalition Charter");
    expect(result.text).toContain("Coalition Team would like you to read");
    expect(result.text).toContain(`Read and sign: ${ctx.personalLink}`);
    assertShape(result);
    assertNoLeakage(result);
  });

  it("signature confirmation states the capacity and is sent regardless of preferences", () => {
    const result = signatureConfirmationTemplate(ctx, { capacity: "official", conditional: false });
    expect(result.subject).toBe("Coalition Charter — you signed");
    expect(result.text).toContain("official");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("signature confirmation states the listing status, both ways", () => {
    const listed = signatureConfirmationTemplate(ctx, {
      capacity: "personal",
      conditional: false,
      listed: true,
    });
    expect(listed.text).toContain("Your name is on the signatory list.");
    assertShape(listed);
    assertNoLeakage(listed);

    const unlisted = signatureConfirmationTemplate(ctx, {
      capacity: "personal",
      conditional: false,
      listed: false,
    });
    expect(unlisted.text).toContain("Your name is not on the signatory list");
    expect(unlisted.text).toContain("counted, not named");
    assertShape(unlisted);
    assertNoLeakage(unlisted);

    // No signatory list exists, so there is nothing to be on or off.
    const noList = signatureConfirmationTemplate(ctx, {
      capacity: "personal",
      conditional: false,
    });
    expect(noList.text).not.toContain("signatory list");
  });

  it("listing-changed states the listing status, both ways", () => {
    const listed = listingChangedTemplate(ctx, { listedAs: "Jane Doe", listed: true });
    expect(listed.text).toContain("Your name is on the signatory list.");
    assertShape(listed);
    assertNoLeakage(listed);

    const unlisted = listingChangedTemplate(ctx, { listedAs: "Jane Doe", listed: false });
    expect(unlisted.text).toContain("Your name is not on the signatory list");
    assertShape(unlisted);

    const noList = listingChangedTemplate(ctx, {
      listedAs: "Jane Doe",
      listed: true,
      showsList: false,
    });
    expect(noList.text).not.toContain("Your name is on the signatory list.");
  });

  it("conditional signature confirmation mentions confirm/remove", () => {
    const result = signatureConfirmationTemplate(ctx, { capacity: "personal", conditional: true });
    expect(result.text).toContain("conditional");
    expect(result.text).toContain("confirm or remove");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("revocation confirmation includes the reason when given", () => {
    const result = revocationConfirmationTemplate(ctx, { reason: "changed my mind" });
    expect(result.text).toContain("changed my mind");
    expect(result.text).toContain(`Sign again: ${ctx.personalLink}`);
    assertShape(result);
    assertNoLeakage(result);
  });

  it("review receipt states judgement and comment count, never another author's comments", () => {
    const result = reviewReceiptTemplate(ctx, { judgement: "decline", commentCount: 0 });
    expect(result.text).toContain("declined");
    expect(result.text).toContain("0 comments");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("version template includes version number, summary, a compare button and the document link", () => {
    const result = versionTemplate(ctx, {
      version: 3,
      summary: "Clarified section 2",
      compareLink: "https://drafter.example.org/i/JANE-TOKEN-1234/history/compare?from=2&to=3",
    });
    expect(result.subject).toBe("Coalition Charter — version 3 published");
    expect(result.text).toContain("Clarified section 2");
    expect(result.text).toContain(
      "See what changed: https://drafter.example.org/i/JANE-TOKEN-1234/history/compare?from=2&to=3",
    );
    expect(result.text).toContain(`Read the whole document: ${ctx.personalLink}`);
    assertShape(result);
    assertNoLeakage(result);
  });

  it("digest lists only this recipient's own dispositions and aggregate counts", () => {
    const result = digestTemplate(ctx, {
      versions: [{ number: 3, summary: "Clarified section 2" }],
      dispositions: [{ outcome: "accepted", note: "good catch" }],
      signatoryCounts: { organizations: 2, individuals: 5, unlisted: 1 },
    });
    expect(result.text).toContain("Version 3");
    expect(result.text).toContain("Accepted");
    expect(result.text).toContain("2 organizations and 5 individuals");
    expect(result.html).toContain("<ul");
    assertShape(result);
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
      assertShape(result);
      assertNoLeakage(result);
    }
  });

  /**
   * `specs/behaviors/notifications.md` § Content rules + issue #71:
   * "`schedule-changed` says what changed: one line per deadline that moved,
   * with its old and new time ... before the current clock."
   */
  it("schedule-changed names each deadline that moved with its old and new time", () => {
    const result = scheduleChangedTemplate(ctx, {
      changes: [
        {
          label: "Comments close",
          from: "Thu, Sep 24 · 5:00 PM EDT",
          to: "Sat, Sep 26 · 5:00 PM EDT",
        },
        { label: "Signatures are due", to: "Wed, Sep 30 · 5:00 PM EDT" },
      ],
    });
    expect(result.text).toContain(
      "Comments close moved from Thu, Sep 24 · 5:00 PM EDT to Sat, Sep 26 · 5:00 PM EDT.",
    );
    expect(result.text).toContain("Signatures are due is now Wed, Sep 30 · 5:00 PM EDT.");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("final-published uses the confirm/remove variant only for conditional signers", () => {
    const plain = finalPublishedTemplate(ctx, { version: 4, conditional: false });
    expect(plain.subject).toBe("Coalition Charter — final version published");
    expect(plain.text).toContain(`Read the final text: ${ctx.personalLink}`);

    const conditional = finalPublishedTemplate(ctx, { version: 4, conditional: true });
    expect(conditional.subject).toBe("Coalition Charter — final version, please confirm");
    expect(conditional.text).toContain(`Confirm or remove your signature: ${ctx.personalLink}`);
    assertShape(plain);
    assertShape(conditional);
    assertNoLeakage(plain);
    assertNoLeakage(conditional);
  });

  it("disposition template lists only this recipient's own outcomes", () => {
    const result = dispositionTemplate(ctx, {
      version: 3,
      outcomes: [{ outcome: "partial", note: "we addressed part of this" }],
    });
    // `specs/behaviors/review-and-judgement.md` § Dispositions: the label,
    // never the raw wire value.
    expect(result.text).toContain("Partly addressed");
    expect(result.text).not.toContain("partial");
    expect(result.text).toContain("we addressed part of this");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("reminder mentions the occurrence number", () => {
    const first = reminderTemplate(ctx, { n: 1 });
    expect(first.text).toContain("a reminder");
    const second = reminderTemplate(ctx, { n: 2 });
    expect(second.text).toContain("reminder #2");
    assertShape(first);
    assertShape(second);
    assertNoLeakage(first);
    assertNoLeakage(second);
  });

  // The five messages sent unconditionally, whatever the preferences say
  // (`specs/behaviors/notifications.md` § Messages). Carrying the footer does
  // not make them optional; it is where a signer who keeps only the receipt
  // goes looking for the controls.
  const TRANSACTIONAL: Array<[string, () => { text: string; html: string }]> = [
    ["invitation", () => invitationTemplate(ctx)],
    [
      "signature-confirmation",
      () => signatureConfirmationTemplate(ctx, { capacity: "personal", conditional: false }),
    ],
    ["revocation-confirmation", () => revocationConfirmationTemplate(ctx, {})],
    ["listing-changed", () => listingChangedTemplate(ctx, { listedAs: "Jane Doe", listed: true })],
    ["review-receipt", () => reviewReceiptTemplate(ctx, { judgement: "sign", commentCount: 2 })],
  ];

  it.each(TRANSACTIONAL)("%s carries both preference links, in both parts", (_event, render) => {
    assertPreferenceFooter(render());
  });

  it("subscription messages keep the two preference links", () => {
    const result = versionTemplate(ctx, {
      version: 1,
      summary: "First draft",
      compareLink: ctx.personalLink,
    });
    assertPreferenceFooter(result);
  });

  it("the footer is small print, not a second button", () => {
    const result = signatureConfirmationTemplate(ctx, { capacity: "official", conditional: false });
    expect(result.html.match(/display:inline-block;background:#2457f5/g)).toHaveLength(1);
  });

  it("omits the clock sentence when the document is not open", () => {
    const result = closedTemplate({ ...ctx, clockLine: undefined });
    expect(result.text).not.toContain("Signatures are due");
    expect(result.text.startsWith("Hi Jane,\n\n")).toBe(true);
  });
});
