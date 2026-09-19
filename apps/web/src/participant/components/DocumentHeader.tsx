import { IdentityLine } from "./IdentityLine.tsx";
import { Timeline } from "./Timeline.tsx";
import { type DocumentInfo, type PersonInfo } from "../types.ts";

/** `specs/screens/document.md` § Display Rules 2: title, timeline, identity line. */
export function DocumentHeader({
  document,
  person,
  readOnly = false,
}: {
  document: DocumentInfo;
  person: PersonInfo;
  readOnly?: boolean;
}): JSX.Element {
  return (
    <header className="px-4 pt-4">
      <h1 className="text-2xl font-bold text-foreground">{document.title}</h1>
      <Timeline document={document} />
      <IdentityLine name={person.name} readOnly={readOnly} />
    </header>
  );
}
