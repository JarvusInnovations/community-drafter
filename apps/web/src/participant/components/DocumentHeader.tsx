import { IdentityLine } from "./IdentityLine.tsx";
import { PhaseLine } from "./PhaseLine.tsx";
import { type DocumentInfo, type PersonInfo } from "../types.ts";

/** `specs/screens/document.md` § Display Rules 2: title, phase line, identity line. */
export function DocumentHeader({
  document,
  person,
}: {
  document: DocumentInfo;
  person: PersonInfo;
}): JSX.Element {
  return (
    <header className="px-4 pt-4">
      <h1 className="text-2xl font-bold text-foreground">{document.title}</h1>
      <PhaseLine document={document} />
      <IdentityLine name={person.name} />
    </header>
  );
}
