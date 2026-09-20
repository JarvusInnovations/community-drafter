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
import { DocumentOperatorsPanel } from "./components/DocumentOperatorsPanel.tsx";
import { ExtendDeadlineDialog } from "./components/ExtendDeadlineDialog.tsx";
import { useAdminDocument } from "./DocumentContext.tsx";
import { type ActivityEntry, type InvitationRow, type NotificationsHealth } from "./types.ts";

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
}

function computeFunnel(rows: InvitationRow[]): Funnel {
  const funnel: Funnel = {
    invited: rows.length,
    sent: 0,
    opened: 0,
    acted: 0,
    organizations: 0,
    individuals: 0,
    conditional: 0,
    revoked: 0,
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

  const funnel = invitations ? computeFunnel(invitations) : null;

  return (
    <main className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded border border-border px-2 py-1">
          {document.state} / {document.phase}
        </span>
        <span className="text-muted-foreground">
          Comments close:{" "}
          {document.comments_close_at ? new Date(document.comments_close_at).toLocaleString() : "—"}
        </span>
        <span className="text-muted-foreground">
          Signing closes:{" "}
          {document.signing_closes_at ? new Date(document.signing_closes_at).toLocaleString() : "—"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExtendOpen(true)}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {copy.dashboard.extendDeadline}
        </button>
        {document.public_access && document.public_access !== "none" ? (
          <button
            type="button"
            onClick={() => void handleCopyPublicLink()}
            className="rounded border border-border px-3 py-1.5 text-sm"
          >
            {copy.dashboard.copyPublicLink}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleExportFeedback()}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {copy.dashboard.exportFeedback}
        </button>
        <button
          type="button"
          onClick={() => void handleExportLinks()}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {copy.dashboard.exportLinks}
        </button>
      </div>

      {banner ? (
        <p role="status" className="mt-2 rounded border border-border bg-muted p-2 text-sm">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
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
        <h2 className="font-semibold">{copy.dashboard.funnel}</h2>
        {funnel ? (
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.invited}</dt>
              <dd className="text-lg font-semibold">{funnel.invited}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.sent}</dt>
              <dd className="text-lg font-semibold">{funnel.sent}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.opened}</dt>
              <dd className="text-lg font-semibold">{funnel.opened}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.acted}</dt>
              <dd className="text-lg font-semibold">{funnel.acted}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.organizations}</dt>
              <dd>{funnel.organizations}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.individuals}</dt>
              <dd>{funnel.individuals}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.conditional}</dt>
              <dd>{funnel.conditional}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.dashboard.revoked}</dt>
              <dd>{funnel.revoked}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">{copy.loading}</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{copy.dashboard.versions}</h2>
        <p className="mt-1 rounded border border-border bg-muted p-2 text-sm text-muted-foreground">
          {copy.dashboard.publishHint}{" "}
          <code className="rounded bg-background px-1.5 py-0.5">
            {copy.dashboard.publishCommand(document.slug)}
          </code>
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1">#</th>
              <th className="py-1">Published</th>
              <th className="py-1">Summary</th>
              <th className="py-1">Dispositions</th>
              <th className="py-1">Final</th>
            </tr>
          </thead>
          <tbody>
            {document.versions.map((v) => (
              <tr key={v.number} className="border-b border-border">
                <td className="py-1">{v.number}</td>
                <td className="py-1">{new Date(v.published_at).toLocaleString()}</td>
                <td className="py-1">{v.summary}</td>
                <td className="py-1">{v.dispositions}</td>
                <td className="py-1">{v.final ? "final" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{copy.dashboard.recentActivity}</h2>
        {activity && activity.length === 0 ? (
          <p className="text-muted-foreground">{copy.dashboard.noActivity}</p>
        ) : null}
        {activity ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {activity.map((entry) => (
              <li key={entry.commit} className="border-b border-border pb-1">
                <span className="text-muted-foreground">
                  {new Date(entry.date).toLocaleString()}
                </span>{" "}
                — {entry.subject}
                {entry.actor ? (
                  <span className="text-muted-foreground"> ({entry.actor})</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{copy.loading}</p>
        )}
      </section>

      <section className="mt-6 mb-8">
        <h2 className="font-semibold">{copy.dashboard.notificationHealth}</h2>
        {notifications ? (
          <div className="mt-2 text-sm">
            <p>
              {copy.dashboard.sentLabel}:{" "}
              {Object.entries(notifications.sent)
                .map(([event, count]) => `${event}: ${count}`)
                .join(", ") || "—"}
            </p>
            <p>
              {copy.dashboard.pendingLabel}: {notifications.pending} · {copy.dashboard.failedLabel}:{" "}
              {notifications.failed}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">{copy.loading}</p>
        )}
      </section>
    </main>
  );
}
