import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Display Rules 5, *Sources as footnotes*: a
 * quiet per-reader toggle on the document card, off by default. It changes
 * how the text is presented and nothing else — no state is written, nothing
 * is sent, and a reader who never touches it sees exactly today's page.
 *
 * A plain checkbox rather than a switch: it is one of the version label's
 * quiet controls, and it has to read as a reading preference and not as an
 * action on the document.
 */
export function CitationsToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label
      className={
        "inline-flex min-h-8 items-center gap-1.5 font-medium " +
        (disabled ? "text-muted-foreground opacity-60" : "cursor-pointer text-primary")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-primary"
      />
      {copy.citations.toggle}
    </label>
  );
}
