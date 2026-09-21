import {
  DocumentRecordSchema,
  OperatorRecordSchema,
  ParticipationRecordSchema,
  PersonRecordSchema,
  SiteRecordSchema,
  SubmissionRecordSchema,
} from "@community-drafter/shared";
import type { Store } from "gitsheets";

/**
 * The validator map passed to `openStore`. One entry per `specs/data-model.md`
 * sheet; keys must match the `.gitsheets/<name>.toml` sheet names exactly.
 */
export const validators = {
  documents: DocumentRecordSchema,
  operators: OperatorRecordSchema,
  people: PersonRecordSchema,
  participations: ParticipationRecordSchema,
  submissions: SubmissionRecordSchema,
  // `specs/behaviors/sites.md`: the sixth sheet. The default site is not a
  // record here — it is derived from the deployment's configuration.
  sites: SiteRecordSchema,
} as const;

export type DataStore = Store<typeof validators>;

/** `<root>` + storage extension per sheet, for building git-relative file paths. */
export const SHEET_LOCATIONS = {
  documents: { root: "documents", ext: "md" },
  operators: { root: "operators", ext: "toml" },
  people: { root: "people", ext: "toml" },
  participations: { root: "participations", ext: "toml" },
  submissions: { root: "submissions", ext: "toml" },
  sites: { root: "sites", ext: "toml" },
} as const;

export type SheetName = keyof typeof validators;
