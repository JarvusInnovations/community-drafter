import { useEffect, useState } from "react";

import {
  ApiError,
  addDocumentOperator,
  getDocumentOperators,
  listOperators,
  removeDocumentOperator,
} from "../api.ts";
import { copy } from "../copy.ts";
import { quietButtonClass, selectClass } from "../styles.ts";
import { type OperatorRecord } from "../types.ts";
import { Card } from "./Card.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * `specs/screens/admin-dashboard.md` § Dashboard: "Operators of this
 * document: the list with add (choose from active operators) and remove
 * (refused for the last one)". The refusal is the API's own
 * `last_operator` message, shown verbatim rather than re-worded.
 */
export function DocumentOperatorsPanel({ slug }: { slug: string }): JSX.Element {
  const [operators, setOperators] = useState<OperatorRecord[] | null>(null);
  const [activeOperators, setActiveOperators] = useState<OperatorRecord[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<OperatorRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function load(): void {
    Promise.all([getDocumentOperators(slug), listOperators()])
      .then(([docOperators, all]) => {
        setOperators(docOperators);
        setActiveOperators(all.filter((o) => o.active));
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : copy.genericError);
      });
  }

  useEffect(load, [slug]);

  const available = (activeOperators ?? []).filter(
    (o) => !(operators ?? []).some((d) => d.email === o.email),
  );

  async function handleAdd(): Promise<void> {
    if (!selected) {
      return;
    }
    setError(null);
    try {
      await addDocumentOperator(slug, selected);
      setBanner(`Added ${selected}.`);
      setSelected("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.genericError);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!pendingRemove) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await removeDocumentOperator(slug, pendingRemove.email);
      setBanner(`Removed ${pendingRemove.email}.`);
      setPendingRemove(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold tracking-tight text-foreground">
        {copy.documentOperators.heading}
      </h2>
      {banner ? (
        <p
          role="status"
          className="mt-2 rounded-xl bg-ok-soft px-3 py-2 text-sm font-medium text-ok"
        >
          {banner}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {operators === null ? (
        <p className="mt-2 text-muted-foreground">{copy.loading}</p>
      ) : operators.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{copy.documentOperators.empty}</p>
      ) : (
        <Card className="mt-2 p-0">
          <ul className="flex flex-col text-sm">
            {operators.map((operator) => (
              <li
                key={operator.email}
                className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="text-foreground">
                  {operator.name} ({operator.email})
                </span>
                <button
                  type="button"
                  onClick={() => setPendingRemove(operator)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {copy.documentOperators.remove}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          {copy.documentOperators.addLabel}
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className={selectClass}
          >
            <option value="">—</option>
            {available.map((operator) => (
              <option key={operator.email} value={operator.email}>
                {operator.name} ({operator.email})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!selected}
          className={quietButtonClass}
        >
          {copy.documentOperators.add}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {copy.documentOperators.lastOperatorHint}
      </p>

      <ConfirmDialog
        open={pendingRemove !== null}
        heading={copy.documentOperators.remove}
        body={pendingRemove ? copy.documentOperators.confirmRemove(pendingRemove.email) : ""}
        confirmLabel={copy.documentOperators.remove}
        cancelLabel={copy.operators.cancel}
        busyLabel={copy.loading}
        busy={busy}
        error={actionError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => {
          setPendingRemove(null);
          setActionError(null);
        }}
      />
    </section>
  );
}
