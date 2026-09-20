import { useEffect, useState } from "react";

import { ApiError, listOperators, removeOperator, updateOperator } from "./api.ts";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { OperatorFormDialog } from "./components/OperatorFormDialog.tsx";
import { copy } from "./copy.ts";
import { useAdminSession } from "./SessionContext.tsx";
import { type OperatorRecord } from "./types.ts";

type PendingAction =
  | { kind: "deactivate"; operator: OperatorRecord }
  | { kind: "remove"; operator: OperatorRecord };

/** `/admin/operators` — `specs/screens/admin-dashboard.md` § "Operators". */
export function OperatorsScreen(): JSX.Element {
  const { session } = useAdminSession();
  const [operators, setOperators] = useState<OperatorRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<"add" | OperatorRecord | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(): void {
    listOperators()
      .then(setOperators)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : copy.genericError);
      });
  }

  useEffect(load, []);

  const isSelf = (operator: OperatorRecord) =>
    operator.email.toLowerCase() === session.email.toLowerCase();

  async function confirmPending(): Promise<void> {
    if (!pending) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (pending.kind === "deactivate") {
        const result = await updateOperator(pending.operator.email, { active: false });
        setBanner(copy.operators.success(result.commit ?? null));
      } else {
        const result = await removeOperator(pending.operator.email);
        setBanner(copy.operators.success(result.commit ?? null));
      }
      setPending(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function reactivate(operator: OperatorRecord): Promise<void> {
    try {
      const result = await updateOperator(operator.email, { active: true });
      setBanner(copy.operators.success(result.commit ?? null));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.genericError);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{copy.operators.heading}</h1>
        <button
          type="button"
          onClick={() => setFormTarget("add")}
          className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background"
        >
          {copy.operators.add}
        </button>
      </div>

      {banner ? (
        <p role="status" className="mt-3 rounded border border-border bg-muted p-2 text-sm">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      ) : null}

      {operators === null && !error ? (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      ) : null}
      {operators && operators.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.operators.empty}</p>
      ) : null}

      {operators && operators.length > 0 ? (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2">Name</th>
              <th className="py-2">Email</th>
              <th className="py-2">Kind</th>
              <th className="py-2">Active</th>
              <th className="py-2">Title</th>
              <th className="py-2">Org</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {operators.map((operator) => (
              <tr key={operator.email} className="border-b border-border">
                <td className="py-2">{operator.name}</td>
                <td className="py-2">{operator.email}</td>
                <td className="py-2">{operator.kind}</td>
                <td className="py-2">{operator.active ? "active" : "inactive"}</td>
                <td className="py-2">{operator.title ?? ""}</td>
                <td className="py-2">{operator.org ?? ""}</td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFormTarget(operator)}
                      className="rounded border border-border px-2 py-1 text-xs"
                    >
                      {copy.operators.edit}
                    </button>
                    {operator.active ? (
                      <button
                        type="button"
                        onClick={() => setPending({ kind: "deactivate", operator })}
                        disabled={isSelf(operator)}
                        title={isSelf(operator) ? copy.operators.cannotSelf : undefined}
                        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                      >
                        {copy.operators.deactivate}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void reactivate(operator)}
                        className="rounded border border-border px-2 py-1 text-xs"
                      >
                        {copy.operators.reactivate}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "remove", operator })}
                      disabled={isSelf(operator)}
                      title={isSelf(operator) ? copy.operators.cannotSelf : undefined}
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      {copy.operators.remove}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <OperatorFormDialog
        open={formTarget !== null}
        operator={formTarget && formTarget !== "add" ? formTarget : undefined}
        onClose={() => setFormTarget(null)}
        onSaved={(commit) => {
          setFormTarget(null);
          setBanner(copy.operators.success(commit));
          load();
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        heading={pending?.kind === "deactivate" ? copy.operators.deactivate : copy.operators.remove}
        body={
          pending
            ? pending.kind === "deactivate"
              ? copy.operators.confirmDeactivate(pending.operator.email)
              : copy.operators.confirmRemove(pending.operator.email)
            : ""
        }
        confirmLabel={
          pending?.kind === "deactivate" ? copy.operators.deactivate : copy.operators.remove
        }
        cancelLabel={copy.operators.cancel}
        busyLabel={copy.loading}
        busy={busy}
        error={actionError}
        onConfirm={() => void confirmPending()}
        onCancel={() => {
          setPending(null);
          setActionError(null);
        }}
      />
    </main>
  );
}
