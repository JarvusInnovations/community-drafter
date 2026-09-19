import { copy } from "../copy.ts";

/** `specs/screens/document.md` § Display Rules 1: "the generic instance name, small. No navigation to anything else." */
export function InstanceBar({ name }: { name: string }): JSX.Element {
  return (
    <div className="border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground">
      {copy.instanceBar(name)}
    </div>
  );
}
