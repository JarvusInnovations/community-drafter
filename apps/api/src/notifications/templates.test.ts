import { describe, expect, it } from "bun:test";

import type { RecipientContext } from "./types.ts";
import {
  confirmCallTemplate,
  deliveredTemplate,
  dispositionTemplate,
  invitationTemplate,
  listingChangedTemplate,
  reminderTemplate,
  reviewReceiptTemplate,
  revocationConfirmationTemplate,
  scheduleChangedTemplate,
  type SignatureReceiptData,
  signatureConfirmationTemplate,
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

const RECEIPT: SignatureReceiptData = {
  capacity: "personal",
  conditional: false,
  deliveredTo: "the State Board of Education",
  removeBy: "Thu, Oct 1 · 5:00 PM EDT",
};

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
    const result = signatureConfirmationTemplate(ctx, { ...RECEIPT, capacity: "official" });
    expect(result.subject).toBe("Coalition Charter — you signed");
    expect(result.text).toContain("official");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("signature confirmation states the listing status, both ways", () => {
    const listed = signatureConfirmationTemplate(ctx, { ...RECEIPT, listed: true });
    expect(listed.text).toContain("Your name is on the signatory list.");
    assertShape(listed);
    assertNoLeakage(listed);

    const unlisted = signatureConfirmationTemplate(ctx, { ...RECEIPT, listed: false });
    expect(unlisted.text).toContain("Your name is not on the signatory list");
    expect(unlisted.text).toContain("counted, not named");
    assertShape(unlisted);
    assertNoLeakage(unlisted);

    // No signatory list exists, so there is nothing to be on or off.
    const noList = signatureConfirmationTemplate(ctx, RECEIPT);
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

  /**
   * `specs/behaviors/notifications.md` § What each message says: the receipt
   * promises exactly what the matrix sends — one confirm-call, then
   * `delivered` — and drops both promises once the document is delivered.
   */
  it("signature confirmation says what happens next, and promises nothing the matrix won't send", () => {
    const result = signatureConfirmationTemplate(ctx, RECEIPT);
    expect(result.text).toContain(
      "What happens next: If the text changes before it's delivered, we'll ask you once to confirm your signature. We'll let you know when it's delivered to the State Board of Education. You can change how you're listed or remove your name any time until Thu, Oct 1 · 5:00 PM EDT.",
    );
    expect(result.text).not.toContain("final");
    assertShape(result);
    assertNoLeakage(result);

    const conditional = signatureConfirmationTemplate(ctx, { ...RECEIPT, conditional: true });
    expect(conditional.text).toContain(
      "Because you signed on a condition, we'll ask you to confirm before it's delivered.",
    );

    const noRecipients = signatureConfirmationTemplate(ctx, {
      ...RECEIPT,
      deliveredTo: "its recipients",
    });
    expect(noRecipients.text).toContain(
      "We'll let you know when it's delivered to its recipients.",
    );

    const after = signatureConfirmationTemplate(ctx, { ...RECEIPT, deliveredOn: "Sep 30" });
    expect(after.text).toContain("It was delivered to the State Board of Education on Sep 30.");
    expect(after.text).not.toContain("we'll ask you once to confirm");
    expect(after.text).not.toContain("We'll let you know when");

    const withComments = signatureConfirmationTemplate(ctx, { ...RECEIPT, commentCount: 3 });
    expect(withComments.text).toContain("We received your 3 comments too.");
  });

  it("revocation confirmation includes the reason when given", () => {
    const result = revocationConfirmationTemplate(ctx, { reason: "changed my mind" });
    expect(result.text).toContain("changed my mind");
    expect(result.text).toContain(`Sign again: ${ctx.personalLink}`);
    assertShape(result);
    assertNoLeakage(result);
  });

  it("review receipt names what the author can still do, and never another author's comments", () => {
    const comment = reviewReceiptTemplate(ctx, {
      judgement: "comment",
      commentCount: 2,
      until: "Thu, Sep 24 · 5:00 PM EDT",
    });
    expect(comment.text).toContain("2 comments");
    expect(comment.text).toContain("You can add more comments until Thu, Sep 24 · 5:00 PM EDT.");
    assertShape(comment);
    assertNoLeakage(comment);

    const decline = reviewReceiptTemplate(ctx, {
      judgement: "decline",
      commentCount: 0,
      until: "Thu, Oct 1 · 5:00 PM EDT",
    });
    expect(decline.text).toContain("You can still sign until Thu, Oct 1 · 5:00 PM EDT.");
    assertShape(decline);
    assertNoLeakage(decline);
  });

  /**
   * `specs/behaviors/notifications.md` § What each message says: deadlines
   * only move later, so `schedule-changed` says there is more time, deadline
   * by deadline, and asks for an answer.
   */
  it("schedule-changed says there is more time, with each new and old time", () => {
    const result = scheduleChangedTemplate(ctx, {
      changes: [
        {
          label: "signing now closes",
          from: "Thu, Sep 24 · 5:00 PM EDT",
          to: "Sat, Sep 26 · 5:00 PM EDT",
        },
        { label: "comments now close", to: "Wed, Sep 23 · 5:00 PM EDT" },
      ],
    });
    expect(result.subject).toBe("Coalition Charter — more time to sign");
    expect(result.text).toContain(
      'More time on "Coalition Charter": signing now closes Sat, Sep 26 · 5:00 PM EDT (it was Thu, Sep 24 · 5:00 PM EDT). comments now close Wed, Sep 23 · 5:00 PM EDT.',
    );
    expect(result.text).toContain(`Read and sign: ${ctx.personalLink}`);
    assertShape(result);
    assertNoLeakage(result);
  });

  it("confirm-call asks to keep or remove by a date, and links the comparison when the text moved", () => {
    const behind = confirmCallTemplate(ctx, {
      reason: "behind",
      signedVersion: 2,
      currentVersion: 4,
      by: "Wed, Sep 30 · 5:00 PM EDT",
      compareLink: `${ctx.personalLink}/history/compare?from=2&to=4`,
    });
    expect(behind.subject).toBe("Coalition Charter — the text changed since you signed");
    expect(behind.text).toContain("You signed version 2; the current text is version 4.");
    expect(behind.text).toContain(
      "Please keep your name on the current text or remove it by Wed, Sep 30 · 5:00 PM EDT.",
    );
    expect(behind.text).toContain(`Keep or remove my name: ${ctx.personalLink}`);
    expect(behind.text).toContain("history/compare?from=2&to=4");
    assertShape(behind);
    assertNoLeakage(behind);

    const conditional = confirmCallTemplate(ctx, {
      reason: "conditional",
      signedVersion: 4,
      currentVersion: 4,
      by: "Wed, Sep 30 · 5:00 PM EDT",
    });
    expect(conditional.subject).toBe(
      "Coalition Charter — please confirm your conditional signature",
    );
    expect(conditional.text).not.toContain("See what changed");
    assertShape(conditional);
  });

  it("delivered names where and when, the note and the count, and asks nothing", () => {
    const result = deliveredTemplate(ctx, {
      deliveredTo: "the State Board of Education",
      on: "Sep 30",
      note: "Handed over at the public meeting.",
      signatories: "Signed by 2 organizations and 14 individuals.",
    });
    expect(result.subject).toBe("Coalition Charter — delivered");
    expect(result.text).toContain(
      '"Coalition Charter" was delivered to the State Board of Education on Sep 30.',
    );
    expect(result.text).toContain("Handed over at the public meeting.");
    expect(result.text).toContain("Signed by 2 organizations and 14 individuals.");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("disposition template lists only this recipient's own outcomes", () => {
    const result = dispositionTemplate(ctx, {
      version: 3,
      outcomes: [{ outcome: "partial", note: "we addressed part of this" }],
      compareLink: `${ctx.personalLink}/history/compare?from=2&to=3`,
    });
    // `specs/behaviors/review-and-judgement.md` § Dispositions: the label,
    // never the raw wire value.
    expect(result.text).toContain("Partly addressed");
    expect(result.text).not.toContain("partial");
    expect(result.text).toContain("we addressed part of this");
    assertShape(result);
    assertNoLeakage(result);
  });

  it("reminder opens with the deadline and the ask", () => {
    const result = reminderTemplate(ctx, {
      n: 1,
      deadline: "Signing closes Wed, Sep 23 · 2:00 PM EDT.",
    });
    expect(
      result.text.startsWith(
        "Hi Jane,\n\nSigning closes Wed, Sep 23 · 2:00 PM EDT. Sign or decline.",
      ),
    ).toBe(true);
    assertNoLeakage(result);
    // Without a deadline to name, it carries the clock instead.
    assertShape(reminderTemplate(ctx, { n: 2 }));
  });

  // Messages sent whatever the preferences say, whatever the preferences say
  // (`specs/behaviors/notifications.md` § Messages). Carrying the footer does
  // not make them optional; it is where a signer who keeps only the receipt
  // goes looking for the controls.
  const TRANSACTIONAL: Array<[string, () => { text: string; html: string }]> = [
    ["invitation", () => invitationTemplate(ctx)],
    ["signature-confirmation", () => signatureConfirmationTemplate(ctx, RECEIPT)],
    ["revocation-confirmation", () => revocationConfirmationTemplate(ctx, {})],
    ["listing-changed", () => listingChangedTemplate(ctx, { listedAs: "Jane Doe", listed: true })],
    [
      "review-receipt",
      () => reviewReceiptTemplate(ctx, { judgement: "comment", commentCount: 2, until: "soon" }),
    ],
  ];

  it.each(TRANSACTIONAL)("%s carries both preference links, in both parts", (_event, render) => {
    assertPreferenceFooter(render());
  });

  it("subscription messages keep the two preference links", () => {
    assertPreferenceFooter(reminderTemplate(ctx, { n: 1 }));
  });

  it("the footer is small print, not a second button", () => {
    const result = signatureConfirmationTemplate(ctx, { ...RECEIPT, capacity: "official" });
    expect(result.html.match(/display:inline-block;background:#2457f5/g)).toHaveLength(1);
  });

  it("omits the clock sentence when the document is not open", () => {
    const result = invitationTemplate({ ...ctx, clockLine: undefined });
    expect(result.text).not.toContain("Signatures are due");
    expect(result.text.startsWith("Hi Jane,\n\n")).toBe(true);
  });
});
