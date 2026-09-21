/**
 * Every string that reaches the printed page (`specs/screens/deliverable.md`
 * § Display Rules). Server-side by necessity — the deliverable is rendered
 * by the API, not by the SPA — so the participant screen's own `copy.ts`
 * cannot be imported here. The two sentences that must agree word for word
 * with the screen (the counts line and its unlisted clause) are duplicated
 * deliberately and are asserted against each other in the tests.
 */
export const deliverableCopy = {
  addressedTo: (names: string[]): string => `To: ${joinNames(names)}`,
  meta: (version: number, date: string, final: boolean): string =>
    `Version ${version} · ${date}${final ? " · final text" : ""}`,
  draftNote: (version: number): string =>
    `Draft of version ${version} — the text and the signatory list may still change.`,
  watermark: "DRAFT",
  footerDraft: (version: number): string => `DRAFT · version ${version}`,

  signatories: {
    heading: "Signatories",
    organizations: "Organizations",
    individuals: "Individuals",
    none: "No signatories yet.",
    counts(organizations: number, individuals: number): string {
      const orgPart = `${organizations} organization${organizations === 1 ? "" : "s"}`;
      const peoplePart = `${individuals} individual${individuals === 1 ? "" : "s"}`;
      return `Signed by ${orgPart} and ${peoplePart}`;
    },
    unlisted: (n: number): string =>
      `and ${n} other${n === 1 ? "" : "s"} who asked not to be listed`,
  },
} as const;

/**
 * `specs/screens/document.md` § Display Rules 3: "Several names are joined
 * with commas and a final 'and'." The same list the sign card's who-sees
 * sentence builds, printed in the deliverable's title block.
 */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The full counts sentence, including the trailing unlisted clause when there is one. */
export function countsSentence(summary: {
  organizations: number;
  individuals: number;
  unlisted: number;
}): string {
  const base = deliverableCopy.signatories.counts(summary.organizations, summary.individuals);
  if (summary.unlisted <= 0) return `${base}.`;
  return `${base}, ${deliverableCopy.signatories.unlisted(summary.unlisted)}.`;
}
