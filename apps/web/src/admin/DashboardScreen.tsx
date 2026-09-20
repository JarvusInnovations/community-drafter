import { useEffect, useState } from "react";

import {
  ApiError,
  exportLinks,
  feedbackExportUrl,
  getActivity,
  getInvitations,
  getNotifications,
} from "./api.ts";
import { copy } from "./copy.ts";
import { Card } from "./components/Card.tsx";
import { DocumentOperatorsPanel } from "./components/DocumentOperatorsPanel.tsx";
import { ExtendDeadlineDialog } from "./components/ExtendDeadlineDialog.tsx";
import { FunnelBar, StatTile } from "./components/Funnel.tsx";
import { useAdminDocument } from "./DocumentContext.tsx";
import { quietButtonClass } from "./styles.ts";
import { type ActivityEntry, type InvitationRow, type NotificationsHealth } from "./types.ts";
import { Timeline } from "../participant/components/Timeline.tsx";

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
  revoked: number;
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
    revoked: 0,
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
    if (row.status === "revoked" || row.link_revoked) {
      funnel.revoked += 1;
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
    const link = `${window.location.origin}/d/${document.slug}`;
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

      <Timeline document={document} />

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setExtendOpen(true)} className={quietButtonClass}>
          {copy.dashboard.extendDeadline}
        </button>
        {document.public_access && document.public_access !== "none" ? (
          <button
            type="button"
            onClick={() => void handleCopyPublicLink()}
            className={quietButtonClass}
          >
            {copy.dashboard.copyPublicLink}
          </button>
        ) : null}
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

      <ExtendDeadlineDialog
        open={extendOpen}
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
                currentVersion > 1 ? "sm:grid-cols-5" : "sm:grid-cols-4"
              }`}
            >
              <StatTile label={copy.dashboard.organizations} value={funnel.organizations} />
              <StatTile label={copy.dashboard.individuals} value={funnel.individuals} />
              <StatTile
                label={copy.dashboard.conditional}
                value={funnel.conditional}
                tone="muted"
              />
              <StatTile label={copy.dashboard.revoked} value={funnel.revoked} tone="muted" />
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
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Published</th>
                <th className="px-4 py-2.5">Summary</th>
                <th className="px-4 py-2.5">Dispositions</th>
                <th className="px-4 py-2.5">Final</th>
              </tr>
            </thead>
            <tbody>
              {document.versions.map((v) => (
                <tr key={v.number} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{v.number}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(v.published_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{v.summary}</td>
                  <td className="px-4 py-2.5 text-foreground">{v.dispositions}</td>
                  <td className="px-4 py-2.5">{v.final ? "final" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
                <li key={entry.commit} className="border-b border-border px-4 py-2.5 last:border-0">
                  <span className="text-muted-foreground">
                    {new Date(entry.date).toLocaleString()}
                  </span>{" "}
                  — {entry.subject}
                  {entry.actor ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({entry.actor}
                      {entry.actor_superadmin ? ` · ${copy.dashboard.superadminActor}` : ""})
                    </span>
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
          </Card>
        ) : (
          <p className="mt-2 text-muted-foreground">{copy.loading}</p>
        )}
      </section>
    </main>
  );
}
