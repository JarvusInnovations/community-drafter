export interface TemplateResult {
  subject: string;
  text: string;
  html: string;
}

/**
 * Everything every template needs regardless of event key
 * (`specs/behaviors/notifications.md` § Content rules: "Every message names
 * the document, states the current phase and its next deadline ..., and
 * links to the personal link.") plus the two subscription-message footer
 * links. Built once per recipient by `context.ts`'s `buildRecipientContext`
 * so no template touches the read model directly — which is also what
 * structurally prevents a template from ever pulling in another
 * participant's data (the plan's leakage validation criterion).
 */
export interface RecipientContext {
  instanceName: string;
  documentTitle: string;
  personName: string;
  personEmail: string;
  phaseLabel: string;
  nextDeadline?: string;
  personalLink: string;
  prefsLink: string;
  stopOptionalLink: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
}
