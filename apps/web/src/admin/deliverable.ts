/**
 * `specs/screens/deliverable.md` § Draft and clean: "draft until the
 * document has a version marked `final` **and** signing has closed."
 *
 * The server decides this for the file itself, and the filename the
 * download carries (`-draft` or not) is always the authority. The same two
 * conditions are read here only to label the link, so the team reads what
 * they are about to hand someone before they hand it over
 * (`specs/screens/admin-dashboard.md` § Dashboard).
 */
export function deliverableIsDraft(document: {
  phase: string;
  versions: { final: boolean }[];
}): boolean {
  return !(document.versions.some((version) => version.final) && document.phase === "closed");
}
