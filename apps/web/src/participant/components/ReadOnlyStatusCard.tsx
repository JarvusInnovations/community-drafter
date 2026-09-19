import { computeCardState } from "../cardState.ts";
import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { type Bundle } from "../types.ts";

/**
 * The status card's read-only twin, used only by admin "view as"
 * (`specs/screens/admin-dashboard.md`: "renders the participant document
 * screen for that person read-only ... every action control is disabled").
 * Rather than thread a `disabled` flag through `StatusCard`'s forms and
 * dialogs, this shows the same headline text with zero interactive
 * elements — simplest way to guarantee nothing here can mutate state.
 */
export function ReadOnlyStatusCard({ bundle }: { bundle: Bundle }): JSX.Element {
  const state = computeCardState(bundle);
  const signature = bundle.signature;

  let text: string;
  switch (state) {
    case "not_signed":
      text = copy.closedCard.ownNotSigned;
      break;
    case "declined":
      text = copy.declined.heading;
      break;
    case "signed":
    case "signed_conditional":
    case "signed_final_pending":
      text = signature
        ? copy.signed.heading(
            formatAbsolute(signature.signed_at ?? signature.resigned_at),
            signature.display_name,
            signature.descriptor,
          )
        : copy.closedCard.ownNotSigned;
      break;
    case "closed":
      text = copy.closedCard.heading(formatAbsolute(bundle.document.signing_closes_at));
      break;
    default:
      text = copy.closedCard.ownNotSigned;
  }

  return (
    <section
      className="mx-4 mt-4 rounded-lg border border-border p-4"
      aria-label={copy.signForm.heading}
    >
      <p className="text-foreground">{text}</p>
    </section>
  );
}
