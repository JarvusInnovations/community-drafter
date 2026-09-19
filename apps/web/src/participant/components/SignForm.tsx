import { type FormEvent, useId, useState } from "react";

import { ApiError, postSignature } from "../api.ts";
import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { type Bundle, type Capacity } from "../types.ts";

/**
 * `specs/screens/document.md` § Display Rules 3 (not-signed state) +
 * `specs/behaviors/signatures.md` § Capacity: capacity choice (hidden when
 * only one is offered), prefilled fields, the official-capacity
 * attestation checkbox with its exact required text, and the mandatory
 * reassurance line under the sign button.
 */
export function SignForm({
  bundle,
  token,
  onSigned,
}: {
  bundle: Bundle;
  token: string;
  onSigned: () => void | Promise<void>;
}): JSX.Element {
  const document = bundle.document;
  const prefill = bundle.prefill;
  const capacities = document.capacities;
  const showCapacityChoice = capacities.length > 1;
  const initialCapacity: Capacity = prefill.suggested_capacity ?? capacities[0] ?? "personal";

  const [capacity, setCapacity] = useState<Capacity>(initialCapacity);
  const [displayName, setDisplayName] = useState(prefill.name ?? "");
  const [descriptor, setDescriptor] = useState(prefill.descriptor ?? "");
  const [org, setOrg] = useState(prefill.org ?? "");
  const [title, setTitle] = useState(prefill.role ?? "");
  const [authorized, setAuthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const isOfficial = capacity === "official";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isOfficial && !authorized) {
      setError(copy.signForm.attestation(org));
      return;
    }

    setSubmitting(true);
    try {
      await postSignature(token, {
        capacity,
        display_name: displayName,
        descriptor: isOfficial ? undefined : descriptor || undefined,
        org: isOfficial ? org : undefined,
        title: isOfficial ? title : undefined,
        authorized: isOfficial ? authorized : true,
        version: bundle.version.number,
      });
      await onSigned();
    } catch (err) {
      setError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{copy.signForm.heading}</h2>

      {showCapacityChoice ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-foreground">
            {copy.signForm.capacityLegend}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${formId}-capacity`}
              checked={capacity === "personal"}
              onChange={() => setCapacity("personal")}
            />
            {copy.signForm.capacityPersonal}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${formId}-capacity`}
              checked={capacity === "official"}
              onChange={() => setCapacity("official")}
            />
            {copy.signForm.capacityOfficial}
          </label>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        {copy.signForm.nameLabel}
        <input
          type="text"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded border border-border p-2"
        />
      </label>

      {isOfficial ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {copy.signForm.orgLabel}
            <input
              type="text"
              required
              value={org}
              onChange={(event) => setOrg(event.target.value)}
              className="rounded border border-border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {copy.signForm.titleLabel}
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded border border-border p-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(event) => setAuthorized(event.target.checked)}
              className="mt-0.5"
            />
            <span>{copy.signForm.attestation(org)}</span>
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          {copy.signForm.descriptorLabel}
          <input
            type="text"
            value={descriptor}
            onChange={(event) => setDescriptor(event.target.value)}
            placeholder={copy.signForm.descriptorHint}
            className="rounded border border-border p-2"
          />
        </label>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting || displayName.trim().length === 0}
        className="rounded bg-foreground px-4 py-2 text-sm font-semibold text-background"
      >
        {submitting ? copy.signForm.signing : copy.signForm.signButton(displayName)}
      </button>

      <p className="text-sm text-muted-foreground">
        {copy.signForm.reassurance(formatAbsolute(document.signing_closes_at))}
      </p>
    </form>
  );
}
