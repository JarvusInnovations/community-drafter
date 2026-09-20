import { IdentityLine } from "./IdentityLine.tsx";
import { Timeline } from "./Timeline.tsx";
import { type DocumentInfo, type PersonInfo } from "../types.ts";

/** `specs/screens/document.md` § Display Rules 2 and § Design "Header": title, identity line, timeline. */
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
    <header className="pt-6">
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
        {document.title}
      </h1>
      <IdentityLine name={person.name} readOnly={readOnly} />
      <Timeline document={document} />
    </header>
  );
}
