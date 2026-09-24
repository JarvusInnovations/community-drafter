/**
 * `specs/screens/deliverable.md` § Draft and clean: draft until signing
 * has closed or the document has been delivered, whichever comes first.
 *
 * The server decides this for the file itself, and the filename the
 * download carries (`-draft` or not) is always the authority. The same
 * conditions are read here only to label the link, so the team reads what
 * they are about to hand someone before they hand it over
 * (`specs/screens/admin-dashboard.md` § Dashboard).
 */
export function deliverableIsDraft(document: { phase: string; delivered_at?: string }): boolean {
  return !(document.phase === "closed" || Boolean(document.delivered_at));
}
