import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  ApiError,
  copyPersonalLink,
  getInvitations,
  getSubmissions,
  reissueLink,
  revokeLink,
  revokeSignature,
} from "./api.ts";
import { Card } from "./components/Card.tsx";
import { Pill, type PillTone } from "./components/Pill.tsx";
import { ReasonDialog } from "./components/ReasonDialog.tsx";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { chipClass, inputClass, quietLinkClass, selectClass } from "./styles.ts";
import { type InvitationRow, type ParticipationStatus, type SubmissionView } from "./types.ts";

const STATUSES = [
  "not_sent",
  "unopened",
  "opened",
  "drafting",
  "commented",
  "signed",
  "signed_conditional",
  "declined",
  "revoked",
];
const SOURCES = ["admin", "crm", "public"];

/**
 * `specs/screens/admin-dashboard.md` § Design: "status as small pills
 * (unopened muted, opened blue soft, drafting amber soft, commented blue
 * soft, signed green soft, declined muted, revoked muted with strike)."
 *
 * Takes the raw string rather than the narrower `ParticipationStatus` type
 * so a value this build doesn't know falls back to a plain muted pill
 * instead of throwing. The wire values are snake_case
 * (`specs/data-model.md`); the labels here are what people read.
 */
function statusPill(status: string): { tone: PillTone; strike?: boolean; label: string } {
  switch (status as ParticipationStatus) {
    case "not_sent":
      return { tone: "muted", label: "not sent" };
    case "unopened":
      return { tone: "muted", label: "unopened" };
    case "opened":
      return { tone: "primary", label: "opened" };
    case "drafting":
      return { tone: "amber", label: "drafting" };
    case "commented":
      return { tone: "primary", label: "commented" };
    case "signed":
      return { tone: "ok", label: "signed" };
    case "signed_conditional":
      return { tone: "ok", label: "signed (conditional)" };
    case "declined":
      return { tone: "muted", label: "declined" };
    case "revoked":
      return { tone: "muted", strike: true, label: "revoked" };
    default:
      return { tone: "muted", label: status };
  }
}

function DraftRow({ slug, person }: { slug: string; person: string }): JSX.Element {
  const [draft, setDraft] = useState<SubmissionView | null | undefined>(undefined);

  useEffect(() => {
    getSubmissions(slug, { state: "draft", person })
      .then((rows) => setDraft(rows[0] ?? null))
      .catch(() => setDraft(null));
  }, [slug, person]);

  if (draft === undefined) {
    return <p className="text-muted-foreground">{copy.loading}</p>;
  }
  if (!draft) {
    return <p className="text-muted-foreground">No draft found.</p>;
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {copy.people.unsubmitted}
      </p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {draft.comments.map((comment) => (
          <li key={comment.id}>{comment.body}</li>
        ))}
        {draft.comments.length === 0 ? (
          <li className="text-muted-foreground">No comments yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

/** `/admin/d/:slug/people` — `specs/screens/admin-dashboard.md` § "People". */
export function PeopleScreen(): JSX.Element {
  const { document } = useAdminDocument();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<InvitationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = searchParams.get("status") ?? "";
  const source = searchParams.get("source") ?? "";
  const q = searchParams.get("q") ?? "";

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function load() {
    getInvitations(document.slug, {
      status: status || undefined,
      source: source || undefined,
      q: q || undefined,
    })
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : copy.genericError));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.slug, status, source, q]);

  async function handleCopyLink(person: string) {
    const { link } = await copyPersonalLink(document.slug, person);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // ignore — the link is still shown in the banner below.
    }
    setBanner(copy.people.linkCopied(link));
  }

  async function handleRevokeLink(person: string) {
    await revokeLink(document.slug, person);
    setBanner("Link revoked.");
    load();
  }

  async function handleReissueLink(person: string) {
    const { link } = await reissueLink(document.slug, person);
    setBanner(copy.people.linkReissued(link));
    load();
  }

  async function handleRevokeSignature(reason: string) {
    if (!revokeTarget) {
      return;
    }
    setBusy(true);
    try {
      await revokeSignature(document.slug, revokeTarget, reason);
      setBanner("Signature revoked.");
      setRevokeTarget(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  const activeFilters = [
    status ? { key: "status", label: `Status: ${status}` } : null,
    source ? { key: "source", label: `Source: ${source}` } : null,
    q ? { key: "q", label: `Search: ${q}` } : null,
  ].filter((f): f is { key: string; label: string } => f !== null);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{copy.people.heading}</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => updateParam("status", e.target.value)}
          className={selectClass}
          aria-label={copy.people.statusLabel}
        >
          <option value="">{copy.people.allStatuses}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => updateParam("source", e.target.value)}
          className={selectClass}
          aria-label={copy.people.sourceLabel}
        >
          <option value="">{copy.people.allSources}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => updateParam("q", e.target.value)}
          placeholder={copy.people.search}
          className={`${inputClass} w-56`}
        />
      </div>

      {activeFilters.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => updateParam(filter.key, "")}
              className={chipClass}
            >
              {filter.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

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

      {rows && rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.people.empty}</p>
      ) : null}

      {rows ? (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">First opened</th>
                <th className="px-4 py-2.5">Last seen</th>
                <th className="px-4 py-2.5">Opens</th>
                <th className="px-4 py-2.5">Signature</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pill = statusPill(row.status);
                return (
                  <Fragment key={row.person}>
                    <tr className="border-b border-border align-top last:border-0">
                      <td className="px-4 py-2.5 font-semibold text-foreground">{row.name}</td>
                      <td className="px-4 py-2.5">
                        <Pill tone={pill.tone} strike={pill.strike}>
                          {pill.label}
                        </Pill>
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{row.source}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {row.opened_at ? new Date(row.opened_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{row.opens}</td>
                      <td className="px-4 py-2.5 text-foreground">
                        {row.signature
                          ? `${row.signature.capacity}${row.signature.conditional ? " (conditional)" : ""}${row.signature.revoked ? " (revoked)" : ""}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <button
                            type="button"
                            className={quietLinkClass}
                            onClick={() => void handleCopyLink(row.person)}
                          >
                            {copy.people.copyLink}
                          </button>
                          <button
                            type="button"
                            className={quietLinkClass}
                            onClick={() => void handleRevokeLink(row.person)}
                          >
                            {copy.people.revokeLink}
                          </button>
                          <button
                            type="button"
                            className={quietLinkClass}
                            onClick={() => void handleReissueLink(row.person)}
                          >
                            {copy.people.reissueLink}
                          </button>
                          <Link
                            to={`/admin/d/${document.slug}/view-as/${row.person}`}
                            className={quietLinkClass}
                          >
                            {copy.people.viewAs}
                          </Link>
                          {row.signature && !row.signature.revoked ? (
                            <button
                              type="button"
                              className={quietLinkClass}
                              onClick={() => setRevokeTarget(row.person)}
                            >
                              {copy.people.revokeSignature}
                            </button>
                          ) : null}
                          {row.status === "drafting" ? (
                            <button
                              type="button"
                              className={quietLinkClass}
                              onClick={() =>
                                setExpanded(expanded === row.person ? null : row.person)
                              }
                            >
                              {expanded === row.person ? "Hide draft" : "Show draft"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded === row.person ? (
                      <tr className="border-b border-border bg-muted last:border-0">
                        <td colSpan={8} className="px-4 py-3">
                          <DraftRow slug={document.slug} person={row.person} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      <ReasonDialog
        open={revokeTarget !== null}
        heading={copy.people.revokeSignature}
        body="This revokes the person's signature and emails them a confirmation."
        reasonLabel={copy.people.revokeSignatureReason}
        confirmLabel={copy.people.revokeSignature}
        cancelLabel="Cancel"
        busyLabel="Revoking…"
        busy={busy}
        onConfirm={(reason) => void handleRevokeSignature(reason)}
        onCancel={() => setRevokeTarget(null)}
      />
    </main>
  );
}
