import { useState } from "react";

import { ApiError, patchSignature } from "../api.ts";
import { copy } from "../copy.ts";
import { type SignatureView } from "../types.ts";

/** `specs/screens/document.md` § Actions: "Change how you're listed" — edits display fields on the existing signature. */
export function EditSignatureForm({
  signature,
  token,
  onSaved,
  onCancel,
}: {
  signature: SignatureView;
  token: string;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [displayName, setDisplayName] = useState(signature.display_name);
  const [descriptor, setDescriptor] = useState(signature.descriptor ?? "");
  const [org, setOrg] = useState(signature.org ?? "");
  const [title, setTitle] = useState(signature.title ?? "");
  const [listed, setListed] = useState(signature.listed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOfficial = signature.capacity === "official";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await patchSignature(token, {
        display_name: displayName,
        descriptor: isOfficial ? undefined : descriptor || undefined,
        org: isOfficial ? org : undefined,
        title: isOfficial ? title : undefined,
        listed,
        authorized: isOfficial ? true : undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3">
      <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
        {copy.signForm.nameLabel}
        <input
          type="text"
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
              value={org}
              onChange={(event) => setOrg(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
            {copy.signForm.titleLabel}
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
          {copy.signForm.descriptorLabel}
          <input
            type="text"
            value={descriptor}
            onChange={(event) => setDescriptor(event.target.value)}
            placeholder={copy.signForm.descriptorHint}
            className="rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground"
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={listed}
          onChange={(event) => setListed(event.target.checked)}
        />
        {copy.signForm.listedLabel}
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
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
    </div>
  );
}
