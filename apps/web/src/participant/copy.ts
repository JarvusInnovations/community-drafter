/**
 * Every user-facing string for the participant routes lives here, per
 * `plans/participant-sign-flow.md` § Approach: "all copy strings in one
 * module so the reassurance line and deadline phrasing are reviewable."
 * Strings quoted verbatim in `specs/screens/document.md` and
 * `specs/behaviors/signatures.md` (the reassurance line, the attestation
 * text, action labels, the descriptor prompt) are reproduced exactly;
 * everything else is this plan's best-effort wording for a declarative
 * spec rule, written to match the spec's tone.
 */
import { type ApiError } from "./api.ts";
import { formatAbsolute } from "./format.ts";
import { type DiffSummaryItem, type Phase, type SignatureView } from "./types.ts";

/** Just the fields the signed-state line reads off a signature. */
export type SignedWho = Pick<
  SignatureView,
  "capacity" | "display_name" | "descriptor" | "org" | "title"
>;

export const copy = {
  instanceBar: (name: string) => name,

  skipToDocument: "Skip to document",

  notFound: {
    heading: "This link isn't available",
    body: "If you believe this is a mistake, please contact the team that sent it to you.",
  },

  loading: "Loading…",

  identity: {
    prefix: "You're here as",
    notYou: "Not you?",
    notYouHeading: "Not you?",
    notYouBody:
      "This is a private link made for one person. If you're not the person named above, please don't sign or comment — ask whoever sent you this link to send you your own copy instead.",
  },

  phase: {
    label(phase: Phase): string {
      switch (phase) {
        case "commenting":
          return "Comment period";
        case "signing":
          return "Signing period";
        case "closed":
          return "Closed";
        case "withdrawn":
          return "Withdrawn";
        case "draft":
          return "Not yet open";
      }
    },
    closesLine(label: string, absolute: string, relativeLabel: string): string {
      if (!relativeLabel) {
        return `${label} · closes ${absolute}`;
      }
      return `${label} · closes ${absolute} · in ${relativeLabel}`;
    },
    laterDeadline: (absolute: string) => `Signatures and removals until ${absolute}`,
    pill: (label: string, relative: string) =>
      relative ? `${label} · closes in ${relative}` : label,
    closedLine: (absolute: string) => `The signatory list closed ${absolute}.`,
    withdrawnLine: "This document was withdrawn.",
  },

  stickyBar: {
    label: "Add your name",
    button: "Sign",
  },

  timeline: {
    ariaLabel: "Timeline: when comments close and when signatures are due",
    opened: "Opened",
    commentsClose: "Comments close",
    commentsClosed: "Comments closed",
    signaturesDue: "Signatures due",
    signingClosed: "Signing closed",
    notOpen: "Not yet open",
    now: "today",
    inLabel: (relative: string) => (relative ? `in ${relative}` : "now"),
    nowSr(phase: Phase): string {
      switch (phase) {
        case "commenting":
          return "Right now: the comment period.";
        case "signing":
          return "Right now: the signing period.";
        case "closed":
          return "Right now: closed.";
        default:
          return "";
      }
    },
  },

  signForm: {
    heading: "Add your name",
    sub: "Takes ten seconds. You can always change or remove it.",
    /** `specs/screens/document.md` § Actions: "Remove my name → ... card switches to *Not signed* with 'You removed your name on Sep 21'." */
    removedOn: (date: string) => `You removed your name on ${date}.`,
    capacityLegend: "How are you signing?",
    capacityPersonal: "As myself",
    capacityOfficial: "On behalf of an organization",
    nameLabel: "Your name",
    descriptorLabel: "How would you like to be described? (optional)",
    descriptorHint: "your neighborhood, profession, or organization",
    orgLabel: "Organization",
    titleLabel: "Your title (optional)",
    attestation: (org: string) =>
      `I am authorized to sign this on behalf of ${org || "this organization"}.`,
    listedLabel: "List my name publicly",
    signButton: (name: string) => `Sign as ${name || "…"}`,
    /**
     * `specs/screens/document.md` § Display Rules 3: in official capacity
     * "the sign button reads 'Sign for St. Brigid Parish Council'" — the
     * signature is the organization's, and the button should say so.
     */
    signButtonOfficial: (org: string) => `Sign for ${org || "your organization"}`,
    /**
     * The attestation gate used to echo the checkbox label back at the
     * signer, which said nothing about what had gone wrong (issue #73).
     */
    attestationError: (org: string) =>
      `Check the box confirming you're authorized to sign for ${org || "this organization"} before adding your name.`,
    reassurance: (deadline: string) =>
      `You can remove your name any time until ${deadline}. We'll email you when the final version is published.`,
    declineLink: "I'd rather not sign",
    commentLink: "I have comments first",
    signing: "Signing…",
  },

  signed: {
    /**
     * `specs/screens/document.md` § Display Rules 3 (*Signed*). The date is
     * the signature currently in force; in official capacity the line names
     * the organization the signature belongs to.
     */
    heading(date: string, who: SignedWho): string {
      const detail = who.capacity === "official" ? who.title : who.descriptor;
      const named = detail ? `${who.display_name}, ${detail}` : who.display_name;
      return who.capacity === "official" && who.org
        ? `You signed on ${date} for ${who.org} as ${named}.`
        : `You signed on ${date} as ${named}.`;
    },
    changeListing: "Change how you're listed",
    remove: "Remove my name",
    addComments: "Add comments",
    conditionalNote:
      "You signed conditionally; we'll show you what changed when the final version is published.",
    finalPublished: (date: string) => `The final text was published ${date}.`,
    confirmButton: "Confirm my signature",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving…",
  },

  declined: {
    heading: "You told us you won't be signing.",
    changedMind: "Changed your mind?",
    signAs: (name: string) => `Sign as ${name}`,
  },

  closedCard: {
    heading: (absolute: string) => `The signatory list closed ${absolute}.`,
    ownSigned: (date: string, name: string) => `You signed on ${date} as ${name}.`,
    ownDeclined: "You told us you wouldn't be signing.",
    ownNotSigned: "You didn't sign this document.",
  },

  draftLine: (version: number) => `You have unsent comments on v${version}`,
  continueLink: "Continue",

  removeDialog: {
    heading: "Remove your name?",
    body: "This removes your signature from the public list right away. You can sign again later if signing is still open.",
    reasonLabel: "Reason (optional, private to the team)",
    confirm: "Remove my name",
    cancel: "Never mind",
    removing: "Removing…",
  },

  declineDialog: {
    heading: "You'd rather not sign?",
    body: "We'll record that you don't plan to sign right now. You can change your mind any time while signing is open.",
    reasonLabel: "Reason (optional, private to the team)",
    confirm: "Confirm — I'd rather not sign",
    cancel: "Never mind",
    declining: "Recording…",
  },

  versionLabel: {
    line: (number: number, absolute: string, summary: string) =>
      `Version ${number} · published ${absolute} · ${summary}`,
    seeWhatChanged: "See what changed",
    chip: (number: number, isCurrent: boolean) =>
      isCurrent ? `Version ${number} · current` : `Version ${number}`,
    rest: (absolute: string, summary: string) => `${absolute} · ${summary}`,
    allVersions: "All versions",
  },

  olderVersionBanner: {
    reading: (n: number) => `You're reading version ${n}.`,
    readCurrent: (n: number) => `Read the current version (${n})`,
  },

  submissions: {
    heading: "Your submissions",
    empty: "You haven't submitted anything yet.",
    versionLabel: (n: number) => `Version ${n}`,
    judgementLabel(judgement: string | null): string {
      switch (judgement) {
        case "sign":
          return "Signed";
        case "sign_conditional":
          return "Signed conditionally";
        case "decline":
          return "Declined";
        default:
          return "Submitted";
      }
    },
    dispositionLabel(outcome: string): string {
      switch (outcome) {
        case "accepted":
          return "Accepted";
        case "partial":
          return "Partly addressed";
        case "declined":
          return "Declined";
        case "noted":
          return "Noted";
        default:
          return outcome;
      }
    },
  },

  signatories: {
    heading: "Signatories",
    counts(organizations: number, individuals: number): string {
      const orgPart = `${organizations} organization${organizations === 1 ? "" : "s"}`;
      const peoplePart = `${individuals} individual${individuals === 1 ? "" : "s"}`;
      return `Signed by ${orgPart} and ${peoplePart}`;
    },
    unlisted: (n: number) => `and ${n} other${n === 1 ? "" : "s"} who asked not to be listed`,
    showAll: "Show all",
    showFewer: "Show fewer",
    hidden: "Signatories are not shown for this document.",
    countsOnly: "Counts only are shown for this document.",
  },

  footer: {
    questions: "Questions? Email the team",
    managePrefs: "Manage how we contact you",
    privateLink: (senderName: string) =>
      `This is a private link made for you by ${senderName || "the team"}.`,
  },

  history: {
    title: "Version history",
    explainer:
      "Each version is the full text as published on that date. The one-line note says what changed.",
    current: "current",
    finalBadge: "final text",
    answeredComments: (n: number) => `answered ${n} comment${n === 1 ? "" : "s"}`,
    read: "Read",
    compareWithPrevious: "Compare with previous",
    backToDocument: "Back to the document",
  },

  compare: {
    title: (from: number, to: number) => `What changed from version ${from} to version ${to}`,
    /**
     * `specs/behaviors/versioning.md` § Diff: the summary names the kinds
     * involved ("2 paragraphs changed, 1 table changed") rather than
     * reporting bare totals, and reads "No changes" when the two versions
     * render identically.
     */
    summary(items: DiffSummaryItem[]): string {
      if (items.length === 0) {
        return "No changes";
      }
      return items
        .map((item) => `${item.count} ${item.kind}${item.count === 1 ? "" : "s"} ${item.change}`)
        .join(", ");
    },
    legend: "Struck-through, colored text was removed; underlined, colored text was added.",
    sameVersion: "This is the only version so far, so there is nothing to compare yet.",
    hideUnchanged: "Hide unchanged paragraphs",
    fromLabel: "From",
    toLabel: "To",
    noChanges: "No changes between these two versions.",
  },

  commentMode: {
    backToDocument: "Back to document",
    commentButton: "Comment",
    composerDialogLabel: "Comment on selected passage",
    composerFieldLabel: "Your comment on this passage",
    composerAdd: "Add",
    composerCancel: "Cancel",
    generalLabel: "Anything about the document as a whole",
    generalPlaceholder: "Add a general note about the whole document (optional)",
    deleteComment: "Delete",
    editingHeading: "Edit comment",
    unplacedBadge: (version: number) => `written on v${version} · passage changed`,
    itemState: {
      saved: "Saved",
      saving: "Saving…",
      retrying: "Not saved, retrying",
      restored: "Restored from this device",
      error: "Not saved, retrying",
    },
    trayHeading: (version: number) => `Your submission on v${version}`,
    traySummary: (n: number) => `${n} comment${n === 1 ? "" : "s"} saved, not yet sent`,
    trayEmpty: "Nothing saved yet — select text in the document or write a general note.",
    trayExpand: "Open",
    trayCollapse: "Hide",
    quoteExpand: "Show more",
    quoteCollapse: "Show less",
    judgement: {
      legend: "Where do you stand?",
      notSigned: {
        sign: "Sign — add my name",
        sign_conditional: "Sign conditionally — add my name; I want to see my comments addressed",
        comment: "Comment without signing",
        decline: "Decline — I won't be signing",
      },
      currentlySigned: {
        sign: "Keep my signature",
        sign_conditional: "Make my signature conditional on my comments",
        comment: "Comment without signing",
        decline: "Remove my signature",
      },
      explanation: {
        sign: "Adds your name to the signatory list right away.",
        sign_conditional:
          "Adds your name now; you'll be asked to confirm or remove it once the final text is published.",
        comment: "Sends your comments without changing your signature.",
        decline: "Records that you won't be signing this document.",
      },
      conditionalDisabledHint: "Add at least one comment to sign conditionally.",
    },
    submitButton: {
      sign: "Sign and send comments",
      sign_conditional: "Sign conditionally and send comments",
      comment: "Send comments",
      decline: "Send and decline",
    },
    submitDisabledReason: {
      phaseClosed: "Comments are closed; you can't submit right now.",
      noJudgement: "Choose where you stand before submitting.",
      nothingChanged: "Nothing has changed since your last submission.",
      unsaved: "Some comments are still saving — wait a moment before submitting.",
      needsSignature: "Add your name to sign.",
      /** `specs/screens/comment-mode.md` § Review tray: official capacity without the attestation. */
      needsAttestation: "Check the box confirming you're authorized to sign for your organization.",
    },
    confirmation: {
      heading: "Sent.",
      body(judgementLabel: string): string {
        return `${judgementLabel} You'll hear back when a new version is published.`;
      },
      backToDocument: "Back to document",
    },
    mismatch: {
      message: (draftVersion: number, currentVersion: number) =>
        `You're commenting on v${draftVersion}; v${currentVersion} is now current.`,
      keep: (draftVersion: number) => `Keep commenting on v${draftVersion}`,
      move: (currentVersion: number) => `Move my comments to v${currentVersion}`,
    },
    phaseClosed: {
      message: (absolute: string) =>
        `Comments closed ${absolute}. Your unsent comments are kept here.`,
    },
    earlierSubmissions: {
      heading: "Your earlier submissions",
    },
    navigationWarning: "You have unsaved comments. Leave anyway?",
    signatureFieldsHeading: "Add your name",
  },

  prefsPlaceholder: {
    heading: "Notification preferences",
    body: "Managing how we contact you is coming soon. For now, every message includes a link to stop optional messages.",
    back: "Back to the document",
  },

  /**
   * `specs/api/conventions.md` § Responses: the server's `message` is
   * already human-readable; this only appends the deadline named in
   * `details` when one is present, per the plan's "shown with the deadline
   * from `details`" requirement.
   */
  phaseClosedMessage(err: ApiError): string {
    const deadline =
      (err.details.signing_closes_at as string | undefined) ??
      (err.details.comments_close_at as string | undefined);
    if (!deadline) {
      return err.message;
    }
    return `${err.message} (${formatAbsolute(deadline)})`;
  },

  genericError: "Something went wrong. Please try again.",
};
