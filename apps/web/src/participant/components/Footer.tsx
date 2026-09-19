import { Link } from "react-router";

import { copy } from "../copy.ts";

/** `specs/screens/document.md` § Display Rules 8. */
export function Footer({
  token,
  replyTo,
  senderName,
}: {
  token: string;
  replyTo?: string;
  senderName?: string;
}): JSX.Element {
  return (
    <footer className="mx-4 mt-6 mb-8 flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground">
      {replyTo ? (
        <a href={`mailto:${replyTo}`} className="underline">
          {copy.footer.questions}
        </a>
      ) : null}
      <Link to={`/i/${token}/prefs`} className="underline">
        {copy.footer.managePrefs}
      </Link>
      <p>{copy.footer.privateLink(senderName ?? "")}</p>
    </footer>
  );
}
