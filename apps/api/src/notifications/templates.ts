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

/**
 * `specs/behaviors/notifications.md` § What each message says: the
 * signing receipt is one of the two messages that asks nothing, so it says
 * what happens next instead — and promises only what the matrix sends:
 * one confirm-call if the text moves (or, on a conditional signature,
 * before delivery), and `delivered`. Both promises are dropped once the
 * document has been delivered.
 */
export interface SignatureReceiptData {
  capacity: string;
  conditional: boolean;
  /** `undefined` when the document shows no signatory list (§ Display). */
  listed?: boolean;
  /** "the State Board of Education" — `addressed_to` joined, or "its recipients". */
  deliveredTo: string;
  /** "Sep 30" when the document has already been delivered. */
  deliveredOn?: string;
  /** `signing_closes_at`, formatted — the change-or-remove deadline. */
  removeBy?: string;
  /** Set when a signing submission from comment mode carried comments. */
  commentCount?: number;
}

export function signatureConfirmationTemplate(
  ctx: RecipientContext,
  extra: SignatureReceiptData,
): TemplateResult {
  const capacity =
    extra.capacity === "official"
      ? "in an official capacity, on behalf of your organization"
      : `in a ${extra.capacity} capacity`;
  const comments =
    extra.commentCount !== undefined && extra.commentCount > 0
      ? ` We received your ${plural(extra.commentCount, "comment")} too.`
      : "";
  const next: string[] = [];
  if (extra.deliveredOn) {
    next.push(`It was delivered to ${extra.deliveredTo} on ${extra.deliveredOn}.`);
  } else {
    next.push(
      extra.conditional
        ? "Because you signed on a condition, we'll ask you to confirm before it's delivered."
        : "If the text changes before it's delivered, we'll ask you once to confirm your signature.",
      `We'll let you know when it's delivered to ${extra.deliveredTo}.`,
    );
  }
  if (extra.removeBy) {
    next.push(
      `You can change how you're listed or remove your name any time until ${extra.removeBy}.`,
    );
  }
  return transactional(
    ctx,
    `${ctx.documentTitle} — you signed`,
    [
      `Your name is on ${quoted(ctx)}, ${capacity}.${comments}`,
      // A signer who asked not to be named keeps this mail as their record
      // of what they were promised, so it says so in its own sentence.
      listingLine(extra.listed),
      `What happens next: ${next.join(" ")}`,
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

/**
 * `specs/behaviors/notifications.md` § What each message says: a review
 * receipt is sent only when it can name an action — for `comment`, adding
 * more comments until comments close; for `decline`, signing after all
 * until signing closes. A signing submission sends the signing receipt
 * instead (`signatureConfirmationTemplate` with `commentCount`).
 */
export function reviewReceiptTemplate(
  ctx: RecipientContext,
  extra: { judgement: "comment" | "decline"; commentCount: number; until: string },
): TemplateResult {
  if (extra.judgement === "decline") {
    return transactional(
      ctx,
      `${ctx.documentTitle} — you declined to sign`,
      [
        `We've recorded that you won't be signing ${quoted(ctx)}${extra.commentCount > 0 ? `, with ${plural(extra.commentCount, "comment")}` : ""}. Changed your mind? You can still sign until ${extra.until}.`,
        clock(ctx),
      ],
      { label: "Open the document", url: ctx.personalLink },
    );
  }
  return transactional(
    ctx,
    `${ctx.documentTitle} — we received your comments`,
    [
      `We received your ${plural(extra.commentCount, "comment")} on ${quoted(ctx)}. ${ctx.senderName} reads every submission whole and answers in a later version. You can add more comments until ${extra.until}.`,
      clock(ctx),
    ],
    { label: "Add more comments", url: ctx.personalLink },
  );
}

/** One deadline that moved, already formatted for the recipient's clock. */
export interface ScheduleChangeLine {
  /** "Comments now close" / "Signing now closes". */
  label: string;
  /** Absent when the deadline had none before (a reopening that sets one). */
  from?: string;
  to: string;
}

/**
 * `specs/behaviors/notifications.md` § What each message says:
 * `schedule-changed-<ts>` goes to O only, and deadlines only move later, so
 * it says there is more time, deadline by deadline, and asks them to sign
 * or decline by the new time.
 */
export function scheduleChangedTemplate(
  ctx: RecipientContext,
  extra: { changes?: ScheduleChangeLine[] } = {},
): TemplateResult {
  const lines = (extra.changes ?? []).map((change) =>
    change.from
      ? `${change.label} ${change.to} (it was ${change.from}).`
      : `${change.label} ${change.to}.`,
  );
  return transactional(
    ctx,
    `${ctx.documentTitle} — more time to sign`,
    [
      `More time on ${quoted(ctx)}: ${lines.join(" ")}`,
      "You haven't signed or declined yet. Read it and add your name, or tell us you'd rather not sign.",
      clock(ctx),
    ],
    { label: "Read and sign", url: ctx.personalLink },
  );
}

export function dispositionTemplate(
  ctx: RecipientContext,
  extra: {
    version: number;
    outcomes: Array<{ outcome: string; note?: string }>;
    compareLink: string;
  },
): TemplateResult {
  const body = [`Version ${extra.version} of ${quoted(ctx)} answers your comments:`];
  for (const outcome of extra.outcomes) {
    body.push(`- ${dispositionLabel(outcome.outcome)}${outcome.note ? ` — ${outcome.note}` : ""}.`);
  }
  body.push(
    "Read the new text, then sign, remove your name, or comment again while you still can.",
    clock(ctx),
  );
  return subscription(
    ctx,
    `${ctx.documentTitle} — your comments were addressed in version ${extra.version}`,
    body,
    { label: "See what changed", url: extra.compareLink },
    { label: "Read the whole document", url: ctx.personalLink },
  );
}

/**
 * `specs/behaviors/notifications.md` § What each message says: the
 * reminder is the last call — there is no automatic one — so its first
 * sentence carries the deadline and the ask.
 */
export function reminderTemplate(
  ctx: RecipientContext,
  extra: { n: number; deadline?: string },
): TemplateResult {
  const ask = extra.deadline
    ? `${extra.deadline} Sign or decline.`
    : "Sign or decline when you can.";
  return subscription(
    ctx,
    `${ctx.documentTitle} — reminder: your answer is needed`,
    [
      ask,
      `${quoted(ctx)} is waiting on you. Read it and add your name, leave comments, or tell us you'd rather not sign.`,
      // The opening sentence already is the clock, as an ask.
      extra.deadline ? "" : clock(ctx),
    ],
    { label: "Read and sign", url: ctx.personalLink },
  );
}

/**
 * `specs/behaviors/notifications.md` → `confirm-call-<ts>`: to S-behind
 * ("the text changed since you signed") and C ("please confirm your
 * conditional signature"). One button to the card that offers both "Keep
 * my name" and "Remove my name"; one further link to the comparison from
 * the version they signed to the current one, whenever those differ.
 */
export function confirmCallTemplate(
  ctx: RecipientContext,
  extra: {
    reason: "behind" | "conditional";
    signedVersion?: number;
    currentVersion: number;
    by: string;
    compareLink?: string;
  },
): TemplateResult {
  const changed =
    extra.signedVersion !== undefined && extra.signedVersion < extra.currentVersion
      ? `You signed version ${extra.signedVersion}; the current text is version ${extra.currentVersion}.`
      : "";
  const opening =
    extra.reason === "conditional"
      ? `You signed ${quoted(ctx)} on a condition. ${changed}`.trim()
      : `The text of ${quoted(ctx)} changed since you signed. ${changed}`.trim();
  return transactional(
    ctx,
    extra.reason === "conditional"
      ? `${ctx.documentTitle} — please confirm your conditional signature`
      : `${ctx.documentTitle} — the text changed since you signed`,
    [
      opening,
      `Please keep your name on the current text or remove it by ${extra.by}. If you do nothing, your name stays on it.`,
      clock(ctx),
    ],
    { label: "Keep or remove my name", url: ctx.personalLink },
    extra.compareLink
      ? { label: `See what changed since version ${extra.signedVersion}`, url: extra.compareLink }
      : undefined,
  );
}

/**
 * `specs/behaviors/notifications.md` → `delivered`: the one message besides
 * the signing receipt that asks nothing — it is the outcome.
 */
export function deliveredTemplate(
  ctx: RecipientContext,
  extra: { deliveredTo: string; on: string; note?: string; signatories: string },
): TemplateResult {
  const body = [`${quoted(ctx)} was delivered to ${extra.deliveredTo} on ${extra.on}.`];
  if (extra.note) body.push(extra.note);
  body.push(extra.signatories, clock(ctx));
  return transactional(ctx, `${ctx.documentTitle} — delivered`, body, {
    label: "Read the statement",
    url: ctx.personalLink,
  });
}
