import { type ApiError } from "./api.ts";

export const copy = {
  loading: "Loading…",
  genericError: "Something went wrong. Try again.",

  // `specs/screens/admin-dashboard.md` § Design "Phone width": a table
  // wider than its card scrolls inside the card and says so.
  tableScrollHint: "Scroll sideways to see every column.",
  tableScrollRegion: "Table — scrolls sideways",

  // `specs/screens/admin-dashboard.md` § Design "Frame": the top bar shows
  // the resolved site's name, read from `GET /auth/session`'s `site`. This
  // literal is only the fallback for a session that predates that field —
  // the same one the backend uses when `INSTANCE_NAME` is unset
  // (`apps/api/src/sites/site.ts`).
  siteName: "Signatories",

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
    sites: "Sites",
    signOut: "Sign out",
  },

  /**
   * `/admin/sites` — the superadmin Sites page
   * (`specs/screens/admin-dashboard.md` § Sites). It reports what is true
   * and what is missing; nothing on it changes DNS
   * (`specs/behaviors/sites.md` § Principles, "A site record never moves
   * DNS").
   */
  sites: {
    heading: "Sites",
    intro:
      "One hostname each, with the identity its documents carry. Creating and changing a site is CLI-only:",
    createCommand:
      'signatories-axi sites create <slug> --hostname <host> --name "…" --reply-to <email>',
    empty: "No sites yet — every document belongs to this deployment's own site.",
    defaultPill: "this deployment",
    hostnameVerified: "routing here",
    hostnameUnverified: "not verified yet",
    senderVerified: "accepted by the mail provider",
    senderUnverified: "not verified yet",
    senderPlatform: "the platform address",
    dnsHeading: (hostname: string) => `DNS still needed for ${hostname}`,
    columns: {
      site: "Site",
      hostname: "Hostname",
      from: "Mail from",
      operators: "Operators",
      documents: "Documents",
    },
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
    superadminNote:
      "You're a superadmin on this deployment's own site, so this list shows every document on every site.",
    siteColumn: "Site",
    newDocumentHint: "New documents are created from the CLI (you become its first operator):",
    newDocumentCommand:
      'signatories-axi docs create <slug> --title "…" --sender-name … --reply-to …',
  },

  dashboard: {
    /**
     * `specs/screens/admin-dashboard.md` § Dashboard: the audience is the
     * promise the sign card makes to every signer, so the team reads it
     * where they read the rest of the document's settings. It is its own
     * line, separate from "Copy public link", which `public_access` drives
     * and which says only who may read the draft today
     * (`specs/data-model.md` § Audience).
     */
    siteLabel: "Site",
    siteLine: (site: string | undefined, url: string | undefined) =>
      `${site ?? "default"}${url ? ` · links are built on ${url}` : ""}`,
    audienceLabel: "Audience",
    audiencePublic: "Published for anyone to read",
    audienceClosed: "Delivered, not published",
    addressedTo: (recipients: string[]) => `addressed to ${recipients.join(", ")}`,
    extendDeadline: "Extend deadline…",
    copyPublicLink: "Copy public link",
    /**
     * `specs/screens/admin-dashboard.md` § Dashboard: labeled "(draft)"
     * while the deliverable is still the watermarked form, so the team
     * reads what they are about to hand someone before they hand it over.
     */
    downloadPdf: "Download PDF",
    downloadPdfDraft: "Download PDF (draft)",
    downloadPdfUnavailable: "Publish a version before you can download the statement",
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
    /**
     * `specs/screens/admin-dashboard.md` § Funnel: two counts, never one.
     * "REVOKED 1" beside the signature tiles was read as a withdrawn
     * signature when what had been revoked was a personal link (#60).
     */
    revokedSignatures: "Signatures revoked",
    revokedLinks: "Links revoked",
    /**
     * `specs/screens/admin-dashboard.md` § Funnel: the number the team
     * needs before delivering — live signatures still attached
     * to an older version (`specs/behaviors/signatures.md` § A signature
     * belongs to a version).
     */
    behind: "Behind current",
    versions: "Versions",
    publishHint: "Publishing is CLI-only. To publish a new version:",
    publishCommand: (slug: string) =>
      `signatories-axi versions publish ${slug} --file <file.md> --summary "…" [--dispositions d.json --notify-commenters]`,
    /** `specs/screens/admin-dashboard.md` § Dashboard, "Delivered". */
    deliveredLine: (date: string) => `Delivered ${date}`,
    /** § Dashboard, "Before delivery". */
    beforeDelivery: "Before delivery",
    confirmCallCount: (n: number) =>
      n === 0
        ? "Nobody needs to confirm."
        : `${n} ${n === 1 ? "signer" : "signers"} would be asked to confirm (behind the current version or conditional):`,
    confirmCallCommand: (slug: string) => `signatories-axi docs confirm-call ${slug}`,
    deliverHint: "When the statement has been delivered, record it and tell every signer:",
    deliverCommand: (slug: string) => `signatories-axi docs delivered ${slug} --note "…"`,
    /** § Dashboard, "Remind hint". */
    remindHint: (deadline: string, unopened: number, undecided: number) =>
      `${deadline}. ${unopened} unopened and ${undecided} opened but undecided. There is no automatic last call:`,
    remindCommand: (slug: string) =>
      `signatories-axi people remind ${slug} --target unopened|opened-not-acted`,
    activityConfirmCall: (subject: string) => {
      const match = /\((\d+) signers?\)/u.exec(subject);
      const n = match ? Number(match[1]) : 0;
      return `asked ${n} ${n === 1 ? "signer" : "signers"} to confirm`;
    },
    activityDelivered: "delivered",
    recentActivity: "Recent activity",
    noActivity: "No activity yet.",
    /**
     * `specs/screens/admin-dashboard.md` § Recent activity: an extension
     * names each deadline it moved with its old and new time, so nobody has
     * to go looking for what the deadline used to be.
     */
    deadlineNames: {
      comments_close_at: "Comments close",
      signing_closes_at: "Signing closes",
    } as Record<string, string>,
    deadlineUnset: "not set",
    /**
     * `specs/behaviors/operators.md` § Superadmins: an actor who is not one
     * of this document's operators but holds the flag is labeled, so the
     * document's own operators can tell an instance administrator acting
     * with standing from a write that should not have been possible.
     */
    superadminActor: "superadmin",
    notOpenedYet:
      "This document has not been opened, so it has no deadlines to extend. Open it from the CLI:",
    openCommand: (slug: string) =>
      `signatories-axi docs open ${slug} --comments-close "…" --signing-closes "…"`,
    notificationHealth: "Notification health",
    sentLabel: "Sent",
    pendingLabel: "Pending",
    failedLabel: "Failed",
    operatorDigestLabel: "Last operator digest",
    operatorDigestNone: "none yet",
    sinceRestart: "Queued and failed are counted since the process last started.",
  },

  extendDeadline: {
    heading: "Extend deadline",
    commentsLabel: "Comments close at",
    signingLabel: "Signing closes at",
    submit: "Extend",
    submitting: "Extending…",
    cancel: "Cancel",
    success: (commit: string | null) => `Extended. Commit: ${commit ?? "(none)"}`,
    /**
     * `specs/screens/admin-dashboard.md` § Actions: unchecked by default —
     * an extension is announced only when the operator asks
     * (`specs/principles.md` § Operators speak; state changes don't).
     */
    notifyLabel: (n: number) =>
      `Tell the ${n} ${n === 1 ? "person" : "people"} who opened it but haven't signed or declined`,
    notified: (sent: number) => `Told ${sent} ${sent === 1 ? "person" : "people"}.`,
    notNotified: (n: number) =>
      n === 0 ? "Nobody was told." : `Nobody was told (${n} could have been).`,
  },

  people: {
    heading: "People",
    search: "Search name or org…",
    statusLabel: "Status",
    sourceLabel: "Source",
    listingLabel: "Listing",
    allStatuses: "All statuses",
    allSources: "All sources",
    allListings: "Any listing",
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
    /** The version a signature is attached to, and the marker when it is behind. */
    signedVersion: (version: number) => `v${version}`,
    behind: (current: number) => `behind v${current}`,
    /**
     * `specs/screens/admin-dashboard.md` § People: every live signature says
     * whether the signer is on the signatory list.
     */
    listed: "listed",
    notListed: "not listed",
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
      personHint: "Person id…",
      disposition: "Disposition",
      any: "Any",
    },
    empty: "No submissions match these filters.",
    previewLink: "View full submission",
  },

  versions: {
    heading: "Versions",
    /** `specs/screens/admin-dashboard.md` § Versions: the current version is marked. */
    current: "current",
    downloadRaw: "Download raw markdown",
    dispositions: (n: number) => `${n} disposition${n === 1 ? "" : "s"}`,
    /** § Versions: per row (not on v1) and in the page header. */
    compareWithPrevious: "Compare with previous",
    compareVersions: "Compare versions",
    backToVersions: "Versions",
  },

  viewAs: {
    banner: (name: string) => `Viewing as ${name} (read-only)`,
  },

  phaseClosedMessage(err: ApiError): string {
    return err.message || copy.genericError;
  },
};
