import { Link } from "react-router";

import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Display Rules 8. `readOnly` (admin
 * "view as") drops the "manage preferences" link — that screen writes
 * preference changes for the real participant, which a read-only render
 * must never offer a path into.
 */
export function Footer({
  token,
  replyTo,
  senderName,
  readOnly = false,
}: {
  token: string;
  replyTo?: string;
  senderName?: string;
  readOnly?: boolean;
}): JSX.Element {
  return (
    <footer className="mx-4 mt-6 mb-8 flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground">
      {replyTo ? (
        <a href={`mailto:${replyTo}`} className="underline">
          {copy.footer.questions}
        </a>
      ) : null}
      {readOnly ? null : (
        <Link to={`/i/${token}/prefs`} className="underline">
          {copy.footer.managePrefs}
        </Link>
      )}
      <p>{copy.footer.privateLink(senderName ?? "")}</p>
    </footer>
  );
}
