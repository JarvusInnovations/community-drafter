import { useEffect, useState } from "react";

import {
  ApiError,
  exportLinks,
  feedbackExportUrl,
  getActivity,
  getInvitations,
  getNotifications,
  statementPdfUrl,
} from "./api.ts";
import { copy } from "./copy.ts";
import { deliverableIsDraft } from "./deliverable.ts";
import { Card } from "./components/Card.tsx";
import { Pill } from "./components/Pill.tsx";
import { TableScroller } from "./components/TableScroller.tsx";
import { DocumentOperatorsPanel } from "./components/DocumentOperatorsPanel.tsx";
import { ExtendDeadlineDialog } from "./components/ExtendDeadlineDialog.tsx";
import { FunnelBar, StatTile } from "./components/Funnel.tsx";
import { useAdminDocument } from "./DocumentContext.tsx";
import { quietButtonClass } from "./styles.ts";
import {
  type ActivityEntry,
  type DocumentDetail,
  type InvitationRow,
  type NotificationsHealth,
} from "./types.ts";
import { Timeline } from "../participant/components/Timeline.tsx";
import { formatAbsolute, formatDayStamp } from "../participant/format.ts";

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Funnel {
  invited: number;
  sent: number;
  opened: number;
  acted: number;
  organizations: number;
  individuals: number;
  conditional: number;
  /**
   * `specs/screens/admin-dashboard.md` § Funnel: revoked signatures and
   * revoked links are two counts, never one. A person whose link was
   * revoked and reissued has withdrawn nothing, and a single "revoked"
   * figure standing beside the signature tiles is read as a withdrawn
   * signature (#60).
   */
  revokedSignatures: number;
  revokedLinks: number;
  /**
   * `specs/screens/admin-dashboard.md` § Funnel: live signatures still
   * attached to a version older than the current one
   * (`specs/behaviors/signatures.md` § A signature belongs to a version).
   */
  behind: number;
}

function computeFunnel(rows: InvitationRow[], currentVersion: number): Funnel {
  const funnel: Funnel = {
    invited: rows.length,
    sent: 0,
    opened: 0,
    acted: 0,
    organizations: 0,
    individuals: 0,
    conditional: 0,
    revokedSignatures: 0,
    revokedLinks: 0,
    behind: 0,
  };
  for (const row of rows) {
    if (row.sent_at) {
      funnel.sent += 1;
    }
    if (row.opened_at) {
      funnel.opened += 1;
    }
    if (["commented", "signed", "signed_conditional", "declined"].includes(row.status)) {
      funnel.acted += 1;
    }
    if (row.status === "signed" || row.status === "signed_conditional") {
      if (row.signature?.capacity === "official") {
        funnel.organizations += 1;
      } else {
        funnel.individuals += 1;
      }
    }
    if (row.status === "signed_conditional") {
      funnel.conditional += 1;
    }
    if (row.signature?.revoked) {
      funnel.revokedSignatures += 1;
    }
    if (row.link_revoked) {
      funnel.revokedLinks += 1;
    }
    const signedOn = row.signature?.signed_on_version;
    if (
      row.signature &&
      !row.signature.revoked &&
      signedOn !== undefined &&
      signedOn < currentVersion
    ) {
      funnel.behind += 1;
    }
  }
  return funnel;
}

/** `/admin/d/:slug` — `specs/screens/admin-dashboard.md` § "Dashboard". */
export function DashboardScreen(): JSX.Element {
  const { document, refetch } = useAdminDocument();
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationsHealth | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getInvitations(document.slug),
      getActivity(document.slug),
      getNotifications(document.slug),
    ])
      .then(([inv, act, notif]) => {
        if (cancelled) {
          return;
        }
        setInvitations(inv);
        setActivity(act);
        setNotifications(notif);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : copy.genericError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [document.slug]);

  async function handleExportFeedback() {
    const response = await fetch(feedbackExportUrl(document.slug), { credentials: "include" });
    const text = await response.text();
    downloadText(`${document.slug}-feedback.json`, text, "application/json");
    setBanner("Feedback exported.");
  }

  async function handleExportLinks() {
    const csv = await exportLinks(document.slug);
    downloadText(`${document.slug}-links.csv`, csv, "text/csv");
    setBanner("Links exported (recorded as an admin event).");
  }

  async function handleCopyPublicLink() {
    // `specs/behaviors/sites.md`: the public link is built on the
    // **document's** site, not on whichever host this dashboard was
    // reached on.
    const base = document.site_url || window.location.origin;
    const link = `${base}/d/${document.slug}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // clipboard access can be denied in some contexts; the link is still shown below.
    }
    setBanner(`Public link copied: ${link}`);
  }

  const currentVersion = document.versions.reduce(
    (max, version) => Math.max(max, version.number),
    0,
  );
  const funnel = invitations ? computeFunnel(invitations, currentVersion) : null;
  const hasDeadline = Boolean(document.comments_close_at || document.signing_closes_at);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          role="status"
          className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          {document.state} / {document.phase}
        </span>
      </div>

      {/*
       * `specs/screens/admin-dashboard.md` § Dashboard: the audience is its
       * own line — what every signer is told about who the statement goes
       * to, stated apart from "Copy public link" below, which is about who
       * may read the draft.
       */}
      <p className="mt-1.5 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{copy.dashboard.audienceLabel}:</span>{" "}
        {document.audience === "public"
          ? copy.dashboard.audiencePublic
          : copy.dashboard.audienceClosed}
        {(document.addressed_to?.length ?? 0) > 0
          ? ` · ${copy.dashboard.addressedTo(document.addressed_to ?? [])}`
          : ""}
      </p>

      {/*
       * `specs/screens/admin-dashboard.md` § Dashboard "Site": the team
       * reads the address their participants are actually sent before they
       * send anything. A document on the default site says so rather than
       * showing nothing.
       */}
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{copy.dashboard.siteLabel}:</span>{" "}
        {copy.dashboard.siteLine(document.site, document.site_url)}
      </p>

      {document.delivered_at ? (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {copy.dashboard.deliveredLine(formatAbsolute(document.delivered_at))}
          </span>
          {document.delivered_note ? ` · ${document.delivered_note}` : ""}
        </p>
      ) : null}

      <Timeline document={document} />

      <div className="mt-4 flex flex-wrap gap-2">
        {/*
          `specs/screens/admin-dashboard.md` § Dashboard: "Extend deadline…"
          only when there is a deadline to extend. A document that has never
          been opened has none, and the dialog could only answer with a
          refusal naming a stored field (#60).
        */}
        {hasDeadline ? (
          <button type="button" onClick={() => setExtendOpen(true)} className={quietButtonClass}>
            {copy.dashboard.extendDeadline}
          </button>
        ) : null}
        {document.public_access && document.public_access !== "none" ? (
          <button
            type="button"
            onClick={() => void handleCopyPublicLink()}
            className={quietButtonClass}
          >
            {copy.dashboard.copyPublicLink}
          </button>
        ) : null}
        {/*
          `specs/screens/deliverable.md` § Actions: a real destination, so
          it is a link and not a button pretending to be one — the browser
          keeps the filename the server chose, `-draft` and all.
        */}
        {document.versions.length === 0 ? (
          <span
            className={`${quietButtonClass} cursor-not-allowed opacity-50`}
            aria-disabled="true"
            title={copy.dashboard.downloadPdfUnavailable}
          >
            {copy.dashboard.downloadPdf}
          </span>
        ) : (
          <a className={quietButtonClass} href={statementPdfUrl(document.slug)}>
            {deliverableIsDraft(document)
              ? copy.dashboard.downloadPdfDraft
              : copy.dashboard.downloadPdf}
          </a>
        )}
        <button
          type="button"
          onClick={() => void handleExportFeedback()}
          className={quietButtonClass}
        >
          {copy.dashboard.exportFeedback}
        </button>
        <button type="button" onClick={() => void handleExportLinks()} className={quietButtonClass}>
          {copy.dashboard.exportLinks}
        </button>
      </div>

      {hasDeadline ? null : (
        <p className="mt-3 rounded-xl border-l-[3px] border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          {copy.dashboard.notOpenedYet}{" "}
          <code className="rounded bg-card px-1.5 py-0.5">
            {copy.dashboard.openCommand(document.slug)}
          </code>
        </p>
      )}

      {banner ? (
        <p
          role="status"
          className="mt-3 rounded-xl bg-ok-soft px-3 py-2 text-sm font-medium text-ok"
        >
          {banner}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      ) : null}

      <OperatorHints document={document} />

      <ExtendDeadlineDialog
        open={extendOpen && hasDeadline}
        document={document}
        onClose={() => setExtendOpen(false)}
        onExtended={() => void refetch()}
      />

      <DocumentOperatorsPanel slug={document.slug} />

      <section className="mt-6">
        <h2 className="text-base font-bold tracking-tight text-foreground">
          {copy.dashboard.funnel}
        </h2>
        {funnel ? (
          <Card className="mt-2">
            <FunnelBar
              funnel={funnel}
              labels={{
                invited: copy.dashboard.invited,
                sent: copy.dashboard.sent,
                opened: copy.dashboard.opened,
                acted: copy.dashboard.acted,
              }}
            />
            <div
              className={`mt-4 grid grid-cols-2 gap-3 ${
                currentVersion > 1 ? "sm:grid-cols-6" : "sm:grid-cols-5"
              }`}
            >
              <StatTile label={copy.dashboard.organizations} value={funnel.organizations} />
              <StatTile label={copy.dashboard.individuals} value={funnel.individuals} />
              <StatTile
                label={copy.dashboard.conditional}
                value={funnel.conditional}
                tone="muted"
              />
              <StatTile
                label={copy.dashboard.revokedSignatures}
                value={funnel.revokedSignatures}
                tone="muted"
              />
              <StatTile
                label={copy.dashboard.revokedLinks}
                value={funnel.revokedLinks}
                tone="muted"
              />
              {/*
               * Shown from the moment a second version exists, zero
               * included: the operator needs to read the number, not infer
               * it from the tile's absence.
               */}
              {currentVersion > 1 ? (
                <StatTile label={copy.dashboard.behind} value={funnel.behind} tone="amber" />
              ) : null}
            </div>
          </Card>
        ) : (
          <p className="mt-2 text-muted-foreground">{copy.loading}</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold tracking-tight text-foreground">
          {copy.dashboard.versions}
        </h2>
        <p className="mt-2 rounded-xl border-l-[3px] border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          {copy.dashboard.publishHint}{" "}
          <code className="rounded bg-card px-1.5 py-0.5">
            {copy.dashboard.publishCommand(document.slug)}
          </code>
        </p>
        <TableScroller className="mt-3">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Published</th>
                <th className="px-4 py-2.5">Summary</th>
                <th className="px-4 py-2.5">Dispositions</th>
              </tr>
            </thead>
            <tbody>
              {document.versions.map((v) => (
                <tr key={v.number} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-foreground">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {v.number}
                      {v.number === currentVersion ? (
                        <Pill tone="ok">{copy.versions.current}</Pill>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatAbsolute(v.published_at)}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{v.summary}</td>
                  <td className="px-4 py-2.5 text-foreground">{v.dispositions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-bold tracking-tight text-foreground">
          {copy.dashboard.recentActivity}
        </h2>
        {activity && activity.length === 0 ? (
          <p className="mt-2 text-muted-foreground">{copy.dashboard.noActivity}</p>
        ) : null}
        {activity ? (
          <Card className="mt-2 p-0">
            <ul className="flex flex-col text-sm">
              {activity.map((entry) => (
                <li
                  key={`${entry.commit}:${entry.person ?? ""}`}
                  className="border-b border-border px-4 py-2.5 last:border-0"
                >
                  <span className="text-muted-foreground">{formatAbsolute(entry.date)}</span> —{" "}
                  {entry.action === "confirm-call"
                    ? copy.dashboard.activityConfirmCall(entry.subject)
                    : entry.action === "deliver"
                      ? copy.dashboard.activityDelivered
                      : entry.subject}
                  {entry.actor ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({entry.actor}
                      {entry.actor_superadmin ? ` · ${copy.dashboard.superadminActor}` : ""})
                    </span>
                  ) : null}
                  {entry.deadlines?.length ? (
                    <ul className="mt-1 flex flex-col text-muted-foreground">
                      {entry.deadlines.map((shift) => (
                        <li key={shift.deadline}>
                          {copy.dashboard.deadlineNames[shift.deadline] ?? shift.deadline}:{" "}
                          {shift.from
                            ? new Date(shift.from).toLocaleString()
                            : copy.dashboard.deadlineUnset}{" "}
                          → {new Date(shift.to).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="mt-2 text-muted-foreground">{copy.loading}</p>
        )}
      </section>

      <section className="mt-6 mb-8">
        <h2 className="text-base font-bold tracking-tight text-foreground">
          {copy.dashboard.notificationHealth}
        </h2>
        {notifications ? (
          <Card className="mt-2 text-sm">
            <p>
              {copy.dashboard.sentLabel}:{" "}
              {Object.entries(notifications.sent)
                .map(([event, count]) => `${event}: ${count}`)
                .join(", ") || "—"}
            </p>
            <p className="mt-1">
              {copy.dashboard.pendingLabel}: {notifications.pending} · {copy.dashboard.failedLabel}:{" "}
              {notifications.failed}
            </p>
            {/*
              `specs/screens/admin-dashboard.md` § Notification health: the
              team's own mail is the one delivery figure `notified` cannot
              show, because an operator message writes nothing to any
              participation (#74).
            */}
            <p className="mt-1">
              {copy.dashboard.operatorDigestLabel}:{" "}
              {notifications.operator_digest_sent
                ? formatDayStamp(notifications.operator_digest_sent)
                : copy.dashboard.operatorDigestNone}
            </p>
            {/*
              `specs/screens/admin-dashboard.md` § Notification health: a
              non-zero failure count is shown with the failures themselves,
              because the count alone tells the team something is wrong and
              nothing about what (#60).
            */}
            {notifications.failures && notifications.failures.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {notifications.failures.map((failure) => (
                  <li key={`${failure.event}:${failure.person}:${failure.at}`}>
                    <span className="font-semibold text-foreground">{failure.event}</span>
                    {failure.person ? ` · ${failure.person}` : ""}
                    {failure.at ? ` · ${formatAbsolute(failure.at)}` : ""}
                    {failure.error ? (
                      <span className="text-destructive"> — {failure.error}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">{copy.dashboard.sinceRestart}</p>
          </Card>
        ) : (
          <p className="mt-2 text-muted-foreground">{copy.loading}</p>
        )}
      </section>
    </main>
  );
}

const REMIND_WINDOW_MS = 48 * 3_600_000;

/**
 * `specs/screens/admin-dashboard.md` § Dashboard, "Before delivery" and
 * "Remind hint": the dashboard runs neither command; it says what each
 * would do. There is no automatic last call
 * (`specs/behaviors/notifications.md` § Sending), so the remind hint is the
 * only prompt the team gets.
 */
function OperatorHints({ document }: { document: DocumentDetail }): JSX.Element | null {
  const signingPossible = document.phase === "commenting" || document.phase === "signing";
  const beforeDelivery = !document.delivered_at && signingPossible;
  const needsConfirmation = document.counts.needs_confirmation ?? 0;
  const unopened = document.counts.unopened ?? 0;
  const undecided = document.counts.undecided ?? 0;

  // Read once per mount: the hint is a prompt, not a countdown.
  const [now] = useState(() => Date.now());
  const deadline =
    document.phase === "commenting"
      ? { label: "Comments close", at: document.comments_close_at }
      : document.phase === "signing"
        ? { label: "Signing closes", at: document.signing_closes_at }
        : undefined;
  const deadlineSoon =
    deadline?.at !== undefined &&
    new Date(deadline.at).getTime() > now &&
    new Date(deadline.at).getTime() - now <= REMIND_WINDOW_MS;
  const remind = deadlineSoon && unopened + undecided > 0;

  if (!beforeDelivery && !remind) {
    return null;
  }
  return (
    <section className="mt-6 flex flex-col gap-2">
      {remind && deadline ? (
        <p className="rounded-xl border-l-[3px] border-amber bg-amber-soft px-3 py-2.5 text-sm text-foreground">
          {copy.dashboard.remindHint(
            `${deadline.label} ${formatAbsolute(deadline.at)}`,
            unopened,
            undecided,
          )}{" "}
          <code className="rounded bg-card px-1.5 py-0.5">
            {copy.dashboard.remindCommand(document.slug)}
          </code>
        </p>
      ) : null}
      {beforeDelivery ? (
        <div className="rounded-xl border-l-[3px] border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{copy.dashboard.beforeDelivery}</p>
          <p className="mt-1">
            {copy.dashboard.confirmCallCount(needsConfirmation)}
            {needsConfirmation > 0 ? (
              <>
                {" "}
                <code className="rounded bg-card px-1.5 py-0.5">
                  {copy.dashboard.confirmCallCommand(document.slug)}
                </code>
              </>
            ) : null}
          </p>
          {document.phase === "signing" ? (
            <p className="mt-1">
              {copy.dashboard.deliverHint}{" "}
              <code className="rounded bg-card px-1.5 py-0.5">
                {copy.dashboard.deliverCommand(document.slug)}
              </code>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
