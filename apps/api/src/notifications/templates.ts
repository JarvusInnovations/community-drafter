import type { Judgement } from "@community-drafter/shared";

import type { RecipientContext, TemplateResult } from "./types.ts";

/**
 * `specs/behaviors/notifications.md` § Messages — one function per event
 * key. Every function takes only `ctx` (this recipient's own data, built by
 * `context.ts`) plus event-specific `extra` (also always scoped to this one
 * recipient) — there is no parameter through which another participant's
 * name, email or comment text could reach a template, which is what the
 * plan's "no message leaks another participant's data" validation
 * criterion is testing structurally, not just by inspection.
 */

function paragraphs(lines: string[]): { text: string; html: string } {
  const nonEmpty = lines.filter((line) => line.length > 0);
  return {
    text: nonEmpty.join("\n\n"),
    html: nonEmpty.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function phaseAndDeadline(ctx: RecipientContext): string {
  const deadline = ctx.nextDeadline ? ` Next deadline: ${ctx.nextDeadline}.` : "";
  return `${ctx.documentTitle} is currently in the ${ctx.phaseLabel} phase.${deadline}`;
}

/** Every subscription (non-transactional) message ends with this footer. */
function subscriptionFooter(ctx: RecipientContext): string[] {
  return [
    `Manage how we contact you: ${ctx.prefsLink}`,
    `Stop all optional messages: ${ctx.stopOptionalLink}`,
  ];
}

function build(subject: string, intro: string[], footer: string[] = []): TemplateResult {
  const { text, html } = paragraphs([...intro, ...footer]);
  return { subject, text, html };
}

export function invitationTemplate(ctx: RecipientContext): TemplateResult {
  return build(`${ctx.documentTitle} — you're invited to review`, [
    `Hi ${ctx.personName},`,
    `You've been invited to review "${ctx.documentTitle}".`,
    phaseAndDeadline(ctx),
    `Open it here: ${ctx.personalLink}`,
  ]);
}

export function signatureConfirmationTemplate(
  ctx: RecipientContext,
  extra: { capacity: string; conditional: boolean },
): TemplateResult {
  const conditionalNote = extra.conditional
    ? " Your signature is conditional; you can confirm or remove it any time before signing closes."
    : "";
  return build(`${ctx.documentTitle} — you signed`, [
    `Hi ${ctx.personName},`,
    `You signed "${ctx.documentTitle}" in a ${extra.capacity} capacity.${conditionalNote}`,
    `View it here: ${ctx.personalLink}`,
  ]);
}

export function revocationConfirmationTemplate(
  ctx: RecipientContext,
  extra: { reason?: string },
): TemplateResult {
  return build(`${ctx.documentTitle} — your signature was removed`, [
    `Hi ${ctx.personName},`,
    `Your signature on "${ctx.documentTitle}" was removed.${extra.reason ? ` Reason: ${extra.reason}` : ""}`,
    `You can sign again any time before signing closes: ${ctx.personalLink}`,
  ]);
}

export function reviewReceiptTemplate(
  ctx: RecipientContext,
  extra: { judgement: Judgement; commentCount: number },
): TemplateResult {
  const judgementLabel: Record<Judgement, string> = {
    sign: "you signed",
    sign_conditional: "you signed conditionally",
    comment: "you left comments",
    decline: "you declined to sign",
  };
  return build(`${ctx.documentTitle} — we received your review`, [
    `Hi ${ctx.personName},`,
    `Thanks — we received your review of "${ctx.documentTitle}" (${judgementLabel[extra.judgement]}, ${extra.commentCount} comment${extra.commentCount === 1 ? "" : "s"}).`,
    `View it here: ${ctx.personalLink}`,
  ]);
}

export function versionTemplate(
  ctx: RecipientContext,
  extra: { version: number; summary: string; compareLink: string },
): TemplateResult {
  return build(
    `${ctx.documentTitle} — version ${extra.version} published`,
    [
      `Hi ${ctx.personName},`,
      `"${ctx.documentTitle}" was updated to version ${extra.version}: ${extra.summary}`,
      phaseAndDeadline(ctx),
      `See what changed: ${extra.compareLink}`,
      `Read it here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export interface DigestData {
  versions: Array<{ number: number; summary: string }>;
  dispositions: Array<{ outcome: string; note?: string }>;
  signatoryCounts: { organizations: number; individuals: number; unlisted: number };
}

export function digestTemplate(ctx: RecipientContext, extra: DigestData): TemplateResult {
  const lines = [`Hi ${ctx.personName},`, `Here's what changed on "${ctx.documentTitle}" today:`];
  for (const version of extra.versions) {
    lines.push(`- Version ${version.number}: ${version.summary}`);
  }
  for (const disposition of extra.dispositions) {
    lines.push(
      `- One of your comments was marked "${disposition.outcome}"${disposition.note ? `: ${disposition.note}` : ""}.`,
    );
  }
  lines.push(
    `${extra.signatoryCounts.organizations} organizations and ${extra.signatoryCounts.individuals} individuals have signed so far (${extra.signatoryCounts.unlisted} unlisted).`,
  );
  lines.push(`View it here: ${ctx.personalLink}`);
  return build(`${ctx.documentTitle} — daily summary`, lines, subscriptionFooter(ctx));
}

export function signingOpenedTemplate(ctx: RecipientContext): TemplateResult {
  return build(
    `${ctx.documentTitle} — signing is open`,
    [
      `Hi ${ctx.personName},`,
      `Signing is now open for "${ctx.documentTitle}".`,
      phaseAndDeadline(ctx),
      `Sign here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export function finalPublishedTemplate(
  ctx: RecipientContext,
  extra: { version: number; conditional: boolean },
): TemplateResult {
  if (extra.conditional) {
    return build(
      `${ctx.documentTitle} — final version, please confirm`,
      [
        `Hi ${ctx.personName},`,
        `The final text of "${ctx.documentTitle}" (version ${extra.version}) has been published. Your signature was conditional — please confirm it or remove it.`,
        phaseAndDeadline(ctx),
        `Confirm or remove your signature: ${ctx.personalLink}`,
      ],
      subscriptionFooter(ctx),
    );
  }
  return build(
    `${ctx.documentTitle} — final version published`,
    [
      `Hi ${ctx.personName},`,
      `The final text of "${ctx.documentTitle}" (version ${extra.version}) has been published.`,
      phaseAndDeadline(ctx),
      `Read it here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export function closingSoonTemplate(ctx: RecipientContext): TemplateResult {
  return build(
    `${ctx.documentTitle} — signing window closes soon`,
    [
      `Hi ${ctx.personName},`,
      `The signing window for "${ctx.documentTitle}" closes soon.`,
      phaseAndDeadline(ctx),
      `Review your signature: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export function closedTemplate(ctx: RecipientContext): TemplateResult {
  return build(
    `${ctx.documentTitle} — signing has closed`,
    [
      `Hi ${ctx.personName},`,
      `Signing has closed for "${ctx.documentTitle}".`,
      `View the final record here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export function scheduleChangedTemplate(ctx: RecipientContext): TemplateResult {
  return build(
    `${ctx.documentTitle} — schedule updated`,
    [
      `Hi ${ctx.personName},`,
      `The schedule for "${ctx.documentTitle}" changed.`,
      phaseAndDeadline(ctx),
      `View it here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}

export function dispositionTemplate(
  ctx: RecipientContext,
  extra: { version: number; outcomes: Array<{ outcome: string; note?: string }> },
): TemplateResult {
  const lines = [
    `Hi ${ctx.personName},`,
    `Version ${extra.version} of "${ctx.documentTitle}" responds to your comments:`,
  ];
  for (const outcome of extra.outcomes) {
    lines.push(`- Marked "${outcome.outcome}"${outcome.note ? `: ${outcome.note}` : ""}.`);
  }
  lines.push(`Read it here: ${ctx.personalLink}`);
  return build(
    `${ctx.documentTitle} — your comments were addressed in version ${extra.version}`,
    lines,
    subscriptionFooter(ctx),
  );
}

export function reminderTemplate(ctx: RecipientContext, extra: { n: number }): TemplateResult {
  const ordinal = extra.n === 1 ? "a reminder" : `reminder #${extra.n}`;
  return build(
    `${ctx.documentTitle} — reminder: your review is needed`,
    [
      `Hi ${ctx.personName},`,
      `Just ${ordinal} — "${ctx.documentTitle}" is waiting on your review.`,
      phaseAndDeadline(ctx),
      `Review it here: ${ctx.personalLink}`,
    ],
    subscriptionFooter(ctx),
  );
}
