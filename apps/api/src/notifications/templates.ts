import type { Judgement } from "@signatories/shared";

import { type EmailLink, renderEmail } from "../lib/mailer/shell.ts";
import type { RecipientContext, TemplateResult } from "./types.ts";

/**
 * `specs/behaviors/notifications.md` § Messages — one function per event
 * key, every one rendered through the shared email shell (§ Content rules
 * "Shape"). Every function takes only `ctx` (this recipient's own data,
 * built by `context.ts`) plus event-specific `extra` (also always scoped to
 * this one recipient) — there is no parameter through which another
 * participant's name, email or comment text could reach a template, which
 * is what the plan's "no message leaks another participant's data"
 * validation criterion is testing structurally, not just by inspection.
 */

const PRIVATE_LINK = "This link is yours alone; please don't forward it.";

/**
 * `specs/behaviors/review-and-judgement.md` § Dispositions: "Where there is
 * no room for that sentence — an email line, a badge on the author's own
 * submission — the outcome is labeled ... The raw wire value is never shown
 * to an author."
 */
export function dispositionLabel(outcome: string): string {
  switch (outcome) {
    case "accepted":
      return "Accepted";
    case "partial":
      return "Partly addressed";
    case "declined":
      return "Declined";
    case "noted":
      return "Noted";
    default:
      return outcome;
  }
}

function greeting(ctx: RecipientContext): string {
  return `Hi ${ctx.firstName},`;
}

function quoted(ctx: RecipientContext): string {
  return `"${ctx.documentTitle}"`;
}

/**
 * `specs/behaviors/notifications.md` § Content rules: "**Every message to a
 * participant** ends with 'Manage how we contact you' ... and a one-click
 * 'stop all optional messages' link". Transactional messages carry them
 * too — the signing receipt is the one message from a campaign people keep,
 * so it is where someone goes looking for the controls. Operator mail
 * (`operator-mail.ts`, `auth/routes.ts`) renders no footer links at all
 * (§ Operator mail).
 */
function preferenceLinks(ctx: RecipientContext): EmailLink[] {
  return [
    { label: "Manage how we contact you", url: ctx.prefsLink },
    { label: "Stop optional messages", url: ctx.stopOptionalLink },
  ];
}

/**
 * The one body every participant message renders through. The two wrappers
 * below delegate to it unchanged, on purpose: whether a message is
 * transactional decides *if* it is sent (`lib/notify.ts`), never what it
 * contains. They stay separate so this file still says which kind each
 * message is.
 */
function participantMessage(
  ctx: RecipientContext,
  subject: string,
  body: string[],
  button: EmailLink,
  alsoLink?: EmailLink,
): TemplateResult {
  const rendered = renderEmail({
    greeting: greeting(ctx),
    body,
    button,
    alsoLink,
    smallPrint: [PRIVATE_LINK],
    footerLinks: preferenceLinks(ctx),
  });
  return { subject, ...rendered };
}

/** Sent unconditionally, whatever the participation's preferences say. */
function transactional(
  ctx: RecipientContext,
  subject: string,
  body: string[],
  button: EmailLink,
  alsoLink?: EmailLink,
): TemplateResult {
  return participantMessage(ctx, subject, body, button, alsoLink);
}

/** Sent only when the recipient's named preference is on. */
function subscription(
  ctx: RecipientContext,
  subject: string,
  body: string[],
  button: EmailLink,
  alsoLink?: EmailLink,
): TemplateResult {
  return participantMessage(ctx, subject, body, button, alsoLink);
}

/** The clock sentence, or nothing when the document isn't open. */
function clock(ctx: RecipientContext): string {
  return ctx.clockLine ?? "";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function invitationTemplate(ctx: RecipientContext): TemplateResult {
  return transactional(
    ctx,
    `${ctx.documentTitle} — you're invited to review`,
    [
      `${ctx.senderName} would like you to read ${quoted(ctx)} and, if you agree with it, add your name. You can also leave comments first, or tell us you'd rather not sign.`,
      clock(ctx),
    ],
    { label: "Read and sign", url: ctx.personalLink },
  );
}

/**
 * `specs/behaviors/signatures.md` § Display: "A signer is told their own
 * listing status, twice." `listed` is `undefined` on a document whose
 * `show_signatories` is not `list` — there is no signatory list to be on or
 * off, so the sentence is absent rather than reassuring about a list nobody
 * will ever see.
 */
export function listingLine(listed: boolean | undefined): string {
  if (listed === undefined) return "";
  return listed
    ? "Your name is on the signatory list."
    : "Your name is not on the signatory list — only the team sees it. You are counted, not named.";
}

export function signatureConfirmationTemplate(
  ctx: RecipientContext,
  extra: { capacity: string; conditional: boolean; listed?: boolean },
): TemplateResult {
  const capacity =
    extra.capacity === "official"
      ? "in an official capacity, on behalf of your organization"
      : `in a ${extra.capacity} capacity`;
  const conditional = extra.conditional
    ? " You signed conditionally, so we'll show you what changed when the final version is published, and you can confirm or remove your name then."
    : " You can remove it any time before signatures are due.";
  return transactional(
    ctx,
    `${ctx.documentTitle} — you signed`,
    [
      `Your name is on ${quoted(ctx)}, ${capacity}.${conditional}`,
      // A signer who asked not to be named keeps this mail as their record
      // of what they were promised, so it says so in its own sentence.
      listingLine(extra.listed),
      clock(ctx),
    ],
    { label: "Open the document", url: ctx.personalLink },
  );
}

export function revocationConfirmationTemplate(
  ctx: RecipientContext,
  extra: { reason?: string },
): TemplateResult {
  return transactional(
    ctx,
    `${ctx.documentTitle} — your signature was removed`,
    [
      `Your name has been removed from ${quoted(ctx)}.${extra.reason ? ` Reason given: ${extra.reason}` : ""}`,
      `You can sign again any time before signatures are due.`,
      clock(ctx),
    ],
    { label: "Sign again", url: ctx.personalLink },
  );
}

/**
 * `specs/behaviors/notifications.md` § Messages → `listing-changed-<ts>`,
 * and `specs/behaviors/signatures.md` § Changing how a signature is
 * listed: it names how the signer is now listed, and says plainly when
 * they are no longer named on the list. The point is that a signer can
 * notice a change to their public name that was not theirs, so the message
 * states the resulting line rather than a vague "your details changed".
 */
export function listingChangedTemplate(
  ctx: RecipientContext,
  extra: { listedAs: string; listed: boolean; showsList?: boolean },
): TemplateResult {
  const line = extra.listed
    ? `You're now listed on ${quoted(ctx)} as ${extra.listedAs}.`
    : `Your name is no longer shown on the signatory list for ${quoted(ctx)}. Your signature still counts toward the totals.`;
  return transactional(
    ctx,
    `${ctx.documentTitle} — how you're listed changed`,
    [
      `${line} If you didn't make this change, open the document and change it back, or reply to this message.`,
      // Stated again in its own sentence, for the same reason the signing
      // confirmation states it: this is the mail a signer keeps.
      listingLine(extra.showsList === false ? undefined : extra.listed),
      clock(ctx),
    ],
    { label: "Open the document", url: ctx.personalLink },
  );
}

export function reviewReceiptTemplate(
  ctx: RecipientContext,
  extra: { judgement: Judgement; commentCount: number },
): TemplateResult {
  const judgementLabel: Record<Judgement, string> = {
    sign: "you signed",
    sign_conditional: "you signed conditionally",
    comment: "you left comments without signing",
    decline: "you declined to sign",
  };
  return transactional(
    ctx,
    `${ctx.documentTitle} — we received your review`,
    [
      `We received your review of ${quoted(ctx)}: ${judgementLabel[extra.judgement]}, with ${plural(extra.commentCount, "comment")}. ${ctx.senderName} reads every submission whole and answers in the next version.`,
      clock(ctx),
    ],
    { label: "Open the document", url: ctx.personalLink },
  );
}

export function versionTemplate(
  ctx: RecipientContext,
  extra: { version: number; summary: string; compareLink: string },
): TemplateResult {
  return subscription(
    ctx,
    `${ctx.documentTitle} — version ${extra.version} published`,
    [
      `${ctx.senderName} published version ${extra.version} of ${quoted(ctx)}: ${extra.summary}`,
      clock(ctx),
    ],
    { label: "See what changed", url: extra.compareLink },
    { label: "Read the whole document", url: ctx.personalLink },
  );
}

export interface DigestData {
  versions: Array<{ number: number; summary: string }>;
  dispositions: Array<{ outcome: string; note?: string }>;
  signatoryCounts: { organizations: number; individuals: number; unlisted: number };
}

export function digestTemplate(ctx: RecipientContext, extra: DigestData): TemplateResult {
  const body = [`Here's what changed on ${quoted(ctx)} today:`];
  for (const version of extra.versions) {
    body.push(`- Version ${version.number}: ${version.summary}`);
  }
  for (const disposition of extra.dispositions) {
    body.push(
      `- One of your comments: ${dispositionLabel(disposition.outcome)}${disposition.note ? ` — ${disposition.note}` : ""}.`,
    );
  }
  const unlisted =
    extra.signatoryCounts.unlisted > 0 ? ` (${extra.signatoryCounts.unlisted} unlisted)` : "";
  body.push(
    `${extra.signatoryCounts.organizations} organizations and ${extra.signatoryCounts.individuals} individuals have signed so far${unlisted}.`,
    clock(ctx),
  );
  return subscription(ctx, `${ctx.documentTitle} — daily summary`, body, {
    label: "Open the document",
    url: ctx.personalLink,
  });
}

export function signingOpenedTemplate(ctx: RecipientContext): TemplateResult {
  return subscription(
    ctx,
    `${ctx.documentTitle} — signing is open`,
    [
      `The comment period on ${quoted(ctx)} has ended and signing is open. If you mean to add your name, now is the time.`,
      clock(ctx),
    ],
    { label: "Open the document", url: ctx.personalLink },
  );
}

export function finalPublishedTemplate(
  ctx: RecipientContext,
  extra: { version: number; conditional: boolean },
): TemplateResult {
  if (extra.conditional) {
    return subscription(
      ctx,
      `${ctx.documentTitle} — final version, please confirm`,
      [
        `${ctx.senderName} published the final text of ${quoted(ctx)} (version ${extra.version}). Your signature was conditional, so please read it and either confirm or remove your name.`,
        clock(ctx),
      ],
      { label: "Confirm or remove your signature", url: ctx.personalLink },
    );
  }
  return subscription(
    ctx,
    `${ctx.documentTitle} — final version published`,
    [
      `${ctx.senderName} published the final text of ${quoted(ctx)} (version ${extra.version}). Your name stays on it unless you remove it before signatures are due.`,
      clock(ctx),
    ],
    { label: "Read the final text", url: ctx.personalLink },
  );
}

/**
 * `specs/behaviors/notifications.md` § Sending: the clock audience is
 * "an invitee ... who has opened their personal link and is not a current
 * signer", so this addresses someone whose name is *not* on the document —
 * and it no longer always fires 24 hours out (a short window sends it at
 * the midpoint instead), so the body leaves the timing to `clock(ctx)`.
 */
export function closingSoonTemplate(ctx: RecipientContext): TemplateResult {
  return subscription(
    ctx,
    `${ctx.documentTitle} — signing window closes soon`,
    [
      `Signatures on ${quoted(ctx)} close soon, and your name isn't on it yet. If you mean to add it, now is the time.`,
      clock(ctx),
    ],
    { label: "Read and sign", url: ctx.personalLink },
  );
}

export function closedTemplate(ctx: RecipientContext): TemplateResult {
  return subscription(
    ctx,
    `${ctx.documentTitle} — signing has closed`,
    [`The signatory list for ${quoted(ctx)} is now final. Thank you for taking part.`, clock(ctx)],
    { label: "See the final record", url: ctx.personalLink },
  );
}

/** One deadline that moved, already formatted for the recipient's clock. */
export interface ScheduleChangeLine {
  /** "Comments close" / "Signatures due". */
  label: string;
  /** Absent when the deadline had none before (a reopening that sets one). */
  from?: string;
  to: string;
}

/**
 * `specs/behaviors/notifications.md` § Content rules: "`schedule-changed`
 * says what changed: one line per deadline that moved, with its old and new
 * time ... before the current clock. A reopening that sets a deadline which
 * had none states the new time alone."
 */
export function scheduleChangedTemplate(
  ctx: RecipientContext,
  extra: { changes?: ScheduleChangeLine[] } = {},
): TemplateResult {
  const body = [`${ctx.senderName} changed the schedule for ${quoted(ctx)}.`];
  for (const change of extra.changes ?? []) {
    body.push(
      change.from
        ? `${change.label} moved from ${change.from} to ${change.to}.`
        : `${change.label} is now ${change.to}.`,
    );
  }
  body.push(clock(ctx));
  return subscription(ctx, `${ctx.documentTitle} — schedule updated`, body, {
    label: "Open the document",
    url: ctx.personalLink,
  });
}

export function dispositionTemplate(
  ctx: RecipientContext,
  extra: { version: number; outcomes: Array<{ outcome: string; note?: string }> },
): TemplateResult {
  const body = [`Version ${extra.version} of ${quoted(ctx)} answers your comments:`];
  for (const outcome of extra.outcomes) {
    body.push(`- ${dispositionLabel(outcome.outcome)}${outcome.note ? ` — ${outcome.note}` : ""}.`);
  }
  body.push(clock(ctx));
  return subscription(
    ctx,
    `${ctx.documentTitle} — your comments were addressed in version ${extra.version}`,
    body,
    { label: `Read version ${extra.version}`, url: ctx.personalLink },
  );
}

export function reminderTemplate(ctx: RecipientContext, extra: { n: number }): TemplateResult {
  const ordinal = extra.n === 1 ? "a reminder" : `reminder #${extra.n}`;
  return subscription(
    ctx,
    `${ctx.documentTitle} — reminder: your review is needed`,
    [
      `Just ${ordinal}: ${quoted(ctx)} is waiting on you. Read it and add your name, leave comments, or tell us you'd rather not sign.`,
      clock(ctx),
    ],
    { label: "Open the document", url: ctx.personalLink },
  );
}
