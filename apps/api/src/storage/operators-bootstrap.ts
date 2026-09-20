import type { Action } from "@community-drafter/shared";

import type { CommitInput, CommitResult, DataStoreTx } from "./commit.ts";
import type { ReadModel } from "./read-model.ts";
import { uniqueSlug } from "../lib/slug.ts";

type BoundCommit = <T>(
  action: Action,
  input: CommitInput,
  fn: (tx: DataStoreTx) => Promise<T>,
) => Promise<CommitResult<T>>;

export interface BootstrapOptions {
  readModel: ReadModel;
  commit: BoundCommit;
  bootstrapOperatorEmail: string | undefined;
  log: (message: string) => void;
}

/**
 * `specs/behaviors/operators.md` § Bootstrap: "When the `operators` sheet is
 * empty at boot and `BOOTSTRAP_OPERATOR_EMAIL` is set, the service creates
 * that operator (`kind: person`, `active: true`) in a commit attributed to
 * `system`. The variable is otherwise ignored."
 */
export async function bootstrapOperator(opts: BootstrapOptions): Promise<void> {
  const { readModel, commit, bootstrapOperatorEmail, log } = opts;
  if (readModel.operatorCount() > 0 || !bootstrapOperatorEmail) return;

  const email = bootstrapOperatorEmail.trim().toLowerCase();
  const id = uniqueSlug(email.split("@")[0] ?? "operator", () => false);

  await commit(
    "operator-add",
    { actor: { kind: "system" }, subject: `operator-add: ${email} (bootstrap)` },
    async (tx) => {
      await tx.operators.upsert({ id, email, name: email, kind: "person", active: true });
    },
  );
  log(`storage: bootstrapped operator ${email} (operators sheet was empty)`);
}

/**
 * `plans/operators-auth.md`: "A boot-time migration: any existing document
 * lacking `created_by`/`operators` gets both set to the bootstrap
 * operator's email in ONE commit (`Action: settings`, `Actor: system`)."
 * Runs every boot (idempotent — only documents still missing either field
 * are touched) but only once an operator email is known to attribute them
 * to; with no `BOOTSTRAP_OPERATOR_EMAIL` configured, legacy documents are
 * left alone (nothing can authenticate to reach them yet regardless, since
 * the `operators` sheet would also necessarily be empty in that case).
 */
export async function migrateLegacyDocuments(opts: BootstrapOptions): Promise<void> {
  const { readModel, commit, bootstrapOperatorEmail, log } = opts;
  if (!bootstrapOperatorEmail) return;
  const email = bootstrapOperatorEmail.trim().toLowerCase();

  const legacy = readModel
    .listDocuments()
    .filter((entry) => !entry.record.created_by || !entry.record.operators?.length)
    .map((entry) => entry.record.slug);
  if (legacy.length === 0) return;

  await commit(
    "settings",
    {
      actor: { kind: "system" },
      subject: `settings: migrate ${legacy.length} document(s) to operators (${email})`,
    },
    async (tx) => {
      for (const slug of legacy) {
        await tx.documents.patch({ slug }, { created_by: email, operators: [email] });
      }
    },
  );
  // This one commit patches several documents without a single `Document`
  // trailer to key off, so `ReadModel.applyCommit`'s generic dispatch (which
  // reloads by trailer) can't pick them up — refresh each patched slug
  // directly instead of relying on it.
  for (const slug of legacy) await readModel.refreshDocument(slug);
  log(`storage: migrated ${legacy.length} legacy document(s) to created_by/operators=${email}`);
}

/**
 * `specs/behaviors/operators.md` § Superadmins: "At boot the operator named
 * by `BOOTSTRAP_OPERATOR_EMAIL`, if it exists and lacks the flag, is made a
 * superadmin in a commit attributed to `system`, so an instance always has
 * one." Idempotent; a no-op when unset, unknown, or already flagged.
 */
export async function ensureBootstrapSuperadmin(opts: BootstrapOptions): Promise<void> {
  const { readModel, commit, bootstrapOperatorEmail, log } = opts;
  if (!bootstrapOperatorEmail) return;
  const email = bootstrapOperatorEmail.trim().toLowerCase();
  const operator = readModel.getOperatorByEmail(email);
  if (!operator || operator.superadmin === true) return;

  await commit(
    "operator-update",
    { actor: { kind: "system" }, subject: `operator-update: ${email} (superadmin bootstrap)` },
    async (tx) => {
      await tx.operators.patch({ id: operator.id }, { superadmin: true });
    },
  );
  log(`storage: made bootstrap operator ${email} a superadmin`);
}
