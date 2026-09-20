import { useEffect, useState } from "react";

import { ApiError, listOperators, removeOperator, updateOperator } from "./api.ts";
import { Card } from "./components/Card.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { OperatorFormDialog } from "./components/OperatorFormDialog.tsx";
import { Pill } from "./components/Pill.tsx";
import { copy } from "./copy.ts";
import { useAdminSession } from "./SessionContext.tsx";
import { primaryButtonClass, quietLinkClass } from "./styles.ts";
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
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          {copy.operators.heading}
        </h1>
        <button type="button" onClick={() => setFormTarget("add")} className={primaryButtonClass}>
          {copy.operators.add}
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

      {operators === null && !error ? (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      ) : null}
      {operators && operators.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.operators.empty}</p>
      ) : null}

      {operators && operators.length > 0 ? (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Active</th>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5">Org</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {operators.map((operator) => (
                <tr key={operator.email} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{operator.name}</td>
                  <td className="px-4 py-2.5 text-foreground">{operator.email}</td>
                  <td className="px-4 py-2.5 text-foreground">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {operator.kind}
                      {operator.superadmin ? (
                        <Pill tone="primary">{copy.operators.superadminPill}</Pill>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Pill tone={operator.active ? "ok" : "muted"}>
                      {operator.active ? "active" : "inactive"}
                    </Pill>
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{operator.title ?? ""}</td>
                  <td className="px-4 py-2.5 text-foreground">{operator.org ?? ""}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => setFormTarget(operator)}
                        className={quietLinkClass}
                      >
                        {copy.operators.edit}
                      </button>
                      {operator.active ? (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "deactivate", operator })}
                          disabled={isSelf(operator)}
                          title={isSelf(operator) ? copy.operators.cannotSelf : undefined}
                          className={quietLinkClass}
                        >
                          {copy.operators.deactivate}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void reactivate(operator)}
                          className={quietLinkClass}
                        >
                          {copy.operators.reactivate}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPending({ kind: "remove", operator })}
                        disabled={isSelf(operator)}
                        title={isSelf(operator) ? copy.operators.cannotSelf : undefined}
                        className={quietLinkClass}
                      >
                        {copy.operators.remove}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
