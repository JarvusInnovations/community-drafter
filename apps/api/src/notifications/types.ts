export interface TemplateResult {
  subject: string;
  text: string;
  html: string;
}

/**
 * Everything every template needs regardless of event key
 * (`specs/behaviors/notifications.md` § Content rules: "Every message names
 * the document, states the current phase and its next deadline ..., and
 * links to the personal link"; § "Shape": greeting by first name, the
 * sender's voice, the clock as one sentence) plus the two
 * subscription-message footer links. Built once per recipient by
 * `context.ts`'s `buildRecipientContext` so no template touches the read
 * model directly — which is also what structurally prevents a template from
 * ever pulling in another participant's data (the plan's leakage validation
 * criterion).
 */
export interface RecipientContext {
  instanceName: string;
  documentTitle: string;
  personName: string;
  /** "Jane" — the greeting name (`shell.ts` `firstName`). */
  firstName: string;
  personEmail: string;
  /** Who the message speaks as: `documents.sender_name`, else the instance name. */
  senderName: string;
  /** "Comments close Thu, Sep 24 · 5:00 PM EDT, and signatures are due …" — absent when the document is not open. */
  clockLine?: string;
  personalLink: string;
  prefsLink: string;
  stopOptionalLink: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
}
