import { Link } from "react-router";

import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Display Rules 8 and § Design "Footer": one
 * quiet line with the questions and preferences links, then the
 * private-link line; no rule above it. `readOnly` (admin "view as") drops
 * the "manage preferences" link — that screen writes preference changes for
 * the real participant, which a read-only render must never offer a path
 * into.
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
  const links: JSX.Element[] = [];
  if (replyTo) {
    links.push(
      <a
        key="questions"
        href={`mailto:${replyTo}`}
        className="font-medium text-primary hover:underline"
      >
        {copy.footer.questions}
      </a>,
    );
  }
  if (!readOnly) {
    links.push(
      <Link
        key="prefs"
        to={`/i/${token}/prefs`}
        className="font-medium text-primary hover:underline"
      >
        {copy.footer.managePrefs}
      </Link>,
    );
    // A real destination outside the SPA, so a plain anchor rather than a
    // router `Link` — and dropped under `readOnly` for the same reason the
    // preferences link is: nothing on the admin "view as" render issues a
    // request (`specs/screens/admin-dashboard.md` § View as).
    links.push(
      <a
        key="statement-pdf"
        href={`/i/${token}/api/statement.pdf`}
        className="font-medium text-primary hover:underline"
      >
        {copy.footer.downloadStatement}
      </a>,
    );
  }

  return (
    <footer className="mt-9 mb-4 text-sm leading-relaxed text-muted-foreground">
      {links.length > 0 ? (
        <p>
          {links.map((link, index) => (
            <span key={link.key}>
              {index > 0 ? " · " : null}
              {link}
            </span>
          ))}
        </p>
      ) : null}
      <p>{copy.footer.privateLink(senderName ?? "")}</p>
    </footer>
  );
}
