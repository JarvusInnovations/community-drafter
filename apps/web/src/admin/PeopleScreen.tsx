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
import { copy } from "./copy.ts";
import { ReasonDialog } from "./components/ReasonDialog.tsx";
import { useAdminDocument } from "./DocumentContext.tsx";
import { type InvitationRow, type SubmissionView } from "./types.ts";

const STATUSES = [
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
      <p className="text-xs font-semibold uppercase text-muted-foreground">
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

  return (
    <main className="p-4">
      <h2 className="font-semibold">{copy.people.heading}</h2>

      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <select
          value={status}
          onChange={(e) => updateParam("status", e.target.value)}
          className="rounded border border-border px-2 py-1"
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
          className="rounded border border-border px-2 py-1"
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
          className="rounded border border-border px-2 py-1"
        />
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

      {rows && rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.people.empty}</p>
      ) : null}

      {rows ? (
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1">Name</th>
              <th className="py-1">Status</th>
              <th className="py-1">Source</th>
              <th className="py-1">First opened</th>
              <th className="py-1">Last seen</th>
              <th className="py-1">Opens</th>
              <th className="py-1">Signature</th>
              <th className="py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.person}>
                <tr className="border-b border-border align-top">
                  <td className="py-1">{row.name}</td>
                  <td className="py-1">{row.status}</td>
                  <td className="py-1">{row.source}</td>
                  <td className="py-1">
                    {row.opened_at ? new Date(row.opened_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-1">
                    {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-1">{row.opens}</td>
                  <td className="py-1">
                    {row.signature
                      ? `${row.signature.capacity}${row.signature.conditional ? " (conditional)" : ""}${row.signature.revoked ? " (revoked)" : ""}`
                      : "—"}
                  </td>
                  <td className="py-1">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void handleCopyLink(row.person)}
                      >
                        {copy.people.copyLink}
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void handleRevokeLink(row.person)}
                      >
                        {copy.people.revokeLink}
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void handleReissueLink(row.person)}
                      >
                        {copy.people.reissueLink}
                      </button>
                      <Link
                        to={`/admin/d/${document.slug}/view-as/${row.person}`}
                        className="underline"
                      >
                        {copy.people.viewAs}
                      </Link>
                      {row.signature && !row.signature.revoked ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setRevokeTarget(row.person)}
                        >
                          {copy.people.revokeSignature}
                        </button>
                      ) : null}
                      {row.status === "drafting" ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setExpanded(expanded === row.person ? null : row.person)}
                        >
                          {expanded === row.person ? "Hide draft" : "Show draft"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expanded === row.person ? (
                  <tr className="border-b border-border bg-muted">
                    <td colSpan={8} className="p-2">
                      <DraftRow slug={document.slug} person={row.person} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
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
