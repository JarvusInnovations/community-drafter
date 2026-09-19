import { type ApiError } from "./api.ts";

export const copy = {
  loading: "Loading…",
  genericError: "Something went wrong. Try again.",

  signIn: {
    heading: "Sign in",
    body: "Sign in with your Google account to open the admin dashboard.",
    button: "Sign in with Google",
    notConfigured:
      "Google sign-in isn't configured for this instance yet. Ask an operator to set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / COOKIE_SECRET, or DEV_ADMIN_EMAIL for local development.",
  },

  nav: {
    documents: "Documents",
    signOut: "Sign out",
  },

  documentList: {
    heading: "Documents",
    empty: "No documents yet.",
    newDocumentHint: "New documents are created from the CLI:",
    newDocumentCommand:
      'drafter-axi documents create <slug> --title "…" --owner … --sender-name … --reply-to …',
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
