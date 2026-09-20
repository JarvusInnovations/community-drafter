import { type FormEvent, type RefObject, useId, useState } from "react";

import { cn } from "../../lib/utils.ts";
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
 *
 * `readOnly` is admin view-as (`specs/screens/admin-dashboard.md` § "View
 * as"): the operator is checking the exact card a participant will be
 * sent — capacity choice, prefill, the attestation's wording — so the card
 * renders whole with every control disabled rather than being replaced by
 * a summary sentence. Nothing here issues a request in that mode.
 */
const FIELD =
  "rounded-xl border border-border bg-card px-3 py-2.5 font-normal text-foreground disabled:opacity-60";
const CAPACITY_OPTION =
  "rounded-lg px-3 py-2 text-center text-sm font-semibold text-muted-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-sm has-disabled:opacity-70 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2";

export function SignForm({
  bundle,
  token,
  onSigned,
  readOnly = false,
  headingRef,
}: {
  bundle: Bundle;
  token: string;
  onSigned: () => void | Promise<void>;
  readOnly?: boolean;
  /** Focus target for `StatusCard`'s post-action focus management (`## Principles`: "every action moves focus somewhere sensible"). */
  headingRef?: RefObject<HTMLHeadingElement | null>;
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
    if (readOnly) return;
    setError(null);

    if (isOfficial && !authorized) {
      setError(copy.signForm.attestationError(org));
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
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-bold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {copy.signForm.heading}
      </h2>
      <p className="-mt-2 text-sm text-muted-foreground">{copy.signForm.sub}</p>

      {showCapacityChoice ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">{copy.signForm.capacityLegend}</legend>
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
            <label className={cn(CAPACITY_OPTION, readOnly ? "cursor-default" : "cursor-pointer")}>
              <input
                type="radio"
                name={`${formId}-capacity`}
                className="sr-only"
                checked={capacity === "personal"}
                disabled={readOnly}
                onChange={() => setCapacity("personal")}
              />
              {copy.signForm.capacityPersonal}
            </label>
            <label className={cn(CAPACITY_OPTION, readOnly ? "cursor-default" : "cursor-pointer")}>
              <input
                type="radio"
                name={`${formId}-capacity`}
                className="sr-only"
                checked={capacity === "official"}
                disabled={readOnly}
                onChange={() => setCapacity("official")}
              />
              {copy.signForm.capacityOfficial}
            </label>
          </div>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
        {copy.signForm.nameLabel}
        <input
          type="text"
          required
          value={displayName}
          disabled={readOnly}
          onChange={(event) => setDisplayName(event.target.value)}
          className={FIELD}
        />
      </label>

      {isOfficial ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
            {copy.signForm.orgLabel}
            <input
              type="text"
              required
              value={org}
              disabled={readOnly}
              onChange={(event) => setOrg(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
            {copy.signForm.titleLabel}
            <input
              type="text"
              value={title}
              disabled={readOnly}
              onChange={(event) => setTitle(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={authorized}
              disabled={readOnly}
              onChange={(event) => setAuthorized(event.target.checked)}
              className="mt-0.5"
            />
            <span>{copy.signForm.attestation(org)}</span>
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
          {copy.signForm.descriptorLabel}
          <input
            type="text"
            value={descriptor}
            disabled={readOnly}
            onChange={(event) => setDescriptor(event.target.value)}
            placeholder={copy.signForm.descriptorHint}
            className={FIELD}
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
        disabled={readOnly || submitting || displayName.trim().length === 0}
        className="rounded-xl bg-primary px-4 py-3.5 text-base font-bold text-white shadow-[0_8px_18px_rgba(36,87,245,0.28)] disabled:opacity-60"
      >
        {submitting
          ? copy.signForm.signing
          : isOfficial
            ? copy.signForm.signButtonOfficial(org)
            : copy.signForm.signButton(displayName)}
      </button>

      <p className="rounded-xl border-l-[3px] border-amber bg-amber-soft px-3 py-2.5 text-sm text-muted-foreground">
        {copy.signForm.reassurance(formatAbsolute(document.signing_closes_at))}
      </p>
    </form>
  );
}
