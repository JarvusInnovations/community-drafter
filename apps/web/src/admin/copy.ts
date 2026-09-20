import { type ApiError } from "./api.ts";

export const copy = {
  loading: "Loading…",
  genericError: "Something went wrong. Try again.",

  // `specs/screens/admin-dashboard.md` § Design "Frame": the top bar shows
  // the configured instance name, read from `GET /auth/session`'s
  // `instance_name`. This literal is only the fallback for a session that
  // predates that field — the same one the backend uses when
  // `INSTANCE_NAME` is unset (`apps/api/src/auth/routes.ts`).
  instanceName: "Community Drafter",

  signIn: {
    heading: "Sign in",
    body: "Enter your operator email address and we'll send you a sign-in link.",
    emailLabel: "Email address",
    submit: "Send sign-in link",
    submitting: "Sending…",
    // `specs/screens/admin-dashboard.md` § Sign-in: "always ... No other
    // text" — this exact sentence is shown whether or not the address
    // belongs to an operator, so the page can never be used to enumerate
    // operators.
    sent: "If that address belongs to an operator, a sign-in link is on its way.",
  },

  device: {
    heading: "Approve this device",
    body: (code: string) => `A command-line sign-in is waiting for the code ${code}.`,
    signedInAs: (email: string) => `Signed in as ${email}`,
    approve: "Approve this device",
    notMe: "Not me",
    approved: "You can close this page; the command line will finish signing in.",
    invalidCode: "This device code is missing, unknown, or has expired.",
  },

  nav: {
    operators: "Operators",
    signOut: "Sign out",
  },

  operators: {
    heading: "Operators",
    empty: "No operators yet.",
    superadminPill: "superadmin",
    add: "Add operator",
    edit: "Edit",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    remove: "Remove",
    cannotSelf: "You cannot deactivate or remove your own operator account here.",
    confirmDeactivate: (email: string) => `Deactivate ${email}?`,
    confirmRemove: (email: string) => `Remove ${email}? This cannot be undone.`,
    nameLabel: "Name",
    emailLabel: "Email",
    kindLabel: "Kind",
    titleLabel: "Title",
    orgLabel: "Organization",
    save: "Save",
    cancel: "Cancel",
    success: (commit: string | null) => `Saved. Commit: ${commit ?? "(none)"}`,
  },

  documentOperators: {
    heading: "Operators of this document",
    addLabel: "Add an operator",
    add: "Add",
    remove: "Remove",
    confirmRemove: (email: string) => `Remove ${email} from this document?`,
    lastOperatorHint: "A document always keeps at least one operator.",
    empty: "No operators on this document yet.",
  },

  documentList: {
    heading: "Documents",
    empty: "No documents yet.",
    superadminNote: "You're a superadmin, so this list shows every document on this instance.",
    newDocumentHint: "New documents are created from the CLI (you become its first operator):",
    newDocumentCommand: 'drafter-axi docs create <slug> --title "…" --sender-name … --reply-to …',
  },

  dashboard: {
    extendDeadline: "Extend deadline…",
    copyPublicLink: "Copy public link",
    exportFeedback: "Export feedback",
    exportLinks: "Export links",
    funnel: "Funnel",
    invited: "Invited",
    sent: "Sent",
    opened: "Opened",
    acted: "Acted",
    organizations: "Organizations",
    individuals: "Individuals",
    conditional: "Conditional",
    revoked: "Revoked",
    versions: "Versions",
    publishHint: "Publishing is CLI-only. To publish a new version:",
    publishCommand: (slug: string) =>
      `drafter-axi versions publish ${slug} --body <file.md> --summary "…"`,
    recentActivity: "Recent activity",
    noActivity: "No activity yet.",
    /**
     * `specs/behaviors/operators.md` § Superadmins: an actor who is not one
     * of this document's operators but holds the flag is labeled, so the
     * document's own operators can tell an instance administrator acting
     * with standing from a write that should not have been possible.
     */
    superadminActor: "superadmin",
    notificationHealth: "Notification health",
    sentLabel: "Sent",
    pendingLabel: "Pending",
    failedLabel: "Failed",
  },

  extendDeadline: {
    heading: "Extend deadline",
    commentsLabel: "Comments close at",
    signingLabel: "Signing closes at",
    submit: "Extend",
    submitting: "Extending…",
    cancel: "Cancel",
    success: (commit: string | null) => `Extended. Commit: ${commit ?? "(none)"}`,
  },

  people: {
    heading: "People",
    search: "Search name or org…",
    statusLabel: "Status",
    sourceLabel: "Source",
    allStatuses: "All statuses",
    allSources: "All sources",
    unsubmitted: "Unsubmitted",
    copyLink: "Copy personal link",
    revokeLink: "Revoke link",
    reissueLink: "Reissue link",
    viewAs: "View as",
    revokeSignature: "Revoke signature",
    linkCopied: (link: string) => `Link copied: ${link}`,
    linkReissued: (link: string) => `New link (shown once): ${link}`,
    reasonRequired: "A reason is required.",
    revokeSignatureReason: "Reason for revoking this signature",
    empty: "No participations match these filters.",
  },

  submissions: {
    heading: "Submissions",
    whole: "By submission",
    byPassage: "By passage",
    unsubmittedGroup: "Unsubmitted (drafts)",
    submittedGroup: "Submitted",
    unsubmittedBadge: "unsubmitted",
    pending: "pending",
    unanswered: "unanswered",
    filters: {
      version: "Version",
      judgement: "Judgement",
      person: "Person",
      disposition: "Disposition",
    },
    empty: "No submissions match these filters.",
    previewLink: "View full submission",
  },

  versions: {
    heading: "Versions",
    downloadRaw: "Download raw markdown",
    dispositions: (n: number) => `${n} disposition${n === 1 ? "" : "s"}`,
  },

  viewAs: {
    banner: (name: string) => `Viewing as ${name} (read-only)`,
  },

  phaseClosedMessage(err: ApiError): string {
    return err.message || copy.genericError;
  },
};
