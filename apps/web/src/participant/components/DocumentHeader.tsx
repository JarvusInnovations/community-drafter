import { IdentityLine } from "./IdentityLine.tsx";
import { Timeline } from "./Timeline.tsx";
import { type DocumentInfo, type PersonInfo } from "../types.ts";

/**
 * `specs/screens/document.md` § Display Rules 2 and § Design "Header": title,
 * identity line, timeline. Under admin "view as" (`readOnly`) the admin
 * document layout already owns the page's `h1` (title + tabs), so the title
 * here steps down to `h2` — `specs/screens/admin-dashboard.md` § View as:
 * "The page has exactly one `h1`" (#72).
 */
export function DocumentHeader({
  document,
  person,
  readOnly = false,
}: {
  document: DocumentInfo;
  person: PersonInfo;
  readOnly?: boolean;
}): JSX.Element {
  const Title = readOnly ? "h2" : "h1";
  return (
    <header className="pt-6">
      <Title className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
        {document.title}
      </Title>
      <IdentityLine
        name={person.name}
        senderName={document.sender_name}
        replyTo={document.reply_to}
        readOnly={readOnly}
      />
      <Timeline document={document} />
    </header>
  );
}
