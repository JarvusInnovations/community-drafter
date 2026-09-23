import { type FormEvent, useId, useState } from "react";

import { ApiError, patchSignature } from "../api.ts";
import { copy } from "../copy.ts";
import { type DocumentInfo, type SignatureView } from "../types.ts";

/**
 * `specs/screens/document.md` § Actions: "Change how you're listed" — edits
 * display fields on the existing signature.
 *
 * The panel is a real `<form>` whose Save is a `type="submit"` button, and
 * the save happens on submit and nowhere else: a click and a press of Enter
 * take the same path, and no field's blur can consume the press that was
 * meant for Save (issue #62 — the first click did nothing at all, with no
 * error and no saving state).
 *
 * `specs/behaviors/signatures.md` § Changing how a signature is listed:
 * the same facts govern an edit as governed the signature — the who-sees
 * sentence above the fields, the listing choice among them — and changing
 * the *organization* is a new claim of authority, so the attestation comes
 * back unchecked and Save waits for it (issue #70).
 */
export function EditSignatureForm({
  signature,
  document,
  token,
  onSaved,
  onCancel,
}: {
  signature: SignatureView;
  document: DocumentInfo;
  token: string;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [displayName, setDisplayName] = useState(signature.display_name);
  const [descriptor, setDescriptor] = useState(signature.descriptor ?? "");
  const [org, setOrg] = useState(signature.org ?? "");
  const [title, setTitle] = useState(signature.title ?? "");
  const [listed, setListed] = useState(signature.listed);
  const [reattested, setReattested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOfficial = signature.capacity === "official";
  const orgChanged = isOfficial && org.trim() !== (signature.org ?? "").trim();
  const showListingChoice = document.show_signatories === "list";

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);

    if (isOfficial && title.trim().length === 0) {
      setError(copy.signForm.titleError);
      return;
    }
    if (orgChanged && !reattested) {
      setError(copy.signed.reattestError(org));
      return;
    }

    setSaving(true);
    try {
      await patchSignature(token, {
        display_name: displayName,
        // An emptied field is sent empty, never dropped: the server reads an
        // omitted field as "unchanged" and an empty one as "cleared"
        // (`specs/api/participant.md` § PATCH; issue #116).
        descriptor: isOfficial ? undefined : descriptor,
        org: isOfficial ? org : undefined,
        title: isOfficial ? title : undefined,
        listed,
        // Only an organization change re-asserts authority; an unchanged
        // organization sends nothing, so the server can tell the two apart.
        authorized: orgChanged ? reattested : undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
      setSaving(false);
    }
  }

  const formId = useId();

  return (
    <form
      onSubmit={(event) => void handleSave(event)}
      aria-busy={saving}
      className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3"
    >
      <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
        {copy.signForm.nameLabel}
        <input
          type="text"
          id={`${formId}-display-name`}
          name="display_name"
          autoComplete="name"
          autoFocus
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
        />
      </label>
      {isOfficial ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
            {copy.signForm.orgLabel}
            <input
              type="text"
              id={`${formId}-org`}
              name="org"
              autoComplete="organization"
              value={org}
              onChange={(event) => setOrg(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
            {copy.signForm.titleLabel}
            <input
              type="text"
              id={`${formId}-title`}
              name="title"
              autoComplete="organization-title"
              required
              value={title}
              placeholder={copy.signForm.titleHint}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
            />
          </label>
          {orgChanged ? (
            <div className="flex flex-col gap-2 rounded-xl border-l-[3px] border-amber bg-amber-soft px-3 py-2.5 text-sm">
              <p className="text-muted-foreground">{copy.signed.reattestNote(org)}</p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`${formId}-reattested`}
                  name="reattested"
                  checked={reattested}
                  onChange={(event) => setReattested(event.target.checked)}
                  className="mt-0.5"
                />
                <span>{copy.signForm.attestation(org)}</span>
              </label>
            </div>
          ) : null}
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
          {copy.signForm.descriptorLabel}
          <input
            type="text"
            id={`${formId}-descriptor`}
            name="descriptor"
            value={descriptor}
            onChange={(event) => setDescriptor(event.target.value)}
            placeholder={copy.signForm.descriptorHint}
            className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
          />
        </label>
      )}
      <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
        {copy.signForm.whoSees(document.audience, document.addressed_to, document.show_signatories)}
      </p>
      {showListingChoice ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            id={`${formId}-listed`}
            name="listed"
            checked={listed}
            onChange={(event) => setListed(event.target.checked)}
          />
          {copy.signForm.listedLabel(document.audience)}
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {saving ? copy.signed.saving : ""}
      </p>
      <div className="mt-1 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {saving ? copy.signed.saving : copy.signed.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
        >
          {copy.signed.cancel}
        </button>
      </div>
    </form>
  );
}
