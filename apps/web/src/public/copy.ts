/**
 * Copy for the `/d/:slug/*` public and embed routes. Reuses the participant
 * module's strings wherever the wording is identical (phase labels, the
 * version-label line, history/compare copy, the signatory count/unlisted
 * sentences from `specs/behaviors/signatures.md` § Display) so the two
 * surfaces never drift apart; adds only what's new here — the "ask the
 * team" card (`specs/screens/public-and-embed.md` § Display Rules, quoted
 * verbatim) and the embed footer.
 */
import { copy as participantCopy } from "../participant/copy.ts";

export const copy = {
  loading: participantCopy.loading,
  genericError: participantCopy.genericError,
  notFound: participantCopy.notFound,
  phase: participantCopy.phase,
  versionLabel: participantCopy.versionLabel,
  history: participantCopy.history,
  compare: participantCopy.compare,
  signatories: participantCopy.signatories,
  submissions: { versionLabel: participantCopy.submissions.versionLabel },

  askTeam: {
    heading: "Want to add your name?",
    intro: "This document is open to invited signers. Ask the team for your personal link:",
    fallback: "Ask the team that shared this link with you for your personal link.",
  },

  embed: {
    readFullPage: "Read the full page",
  },

  footer: {
    downloadStatement: participantCopy.footer.downloadStatement,
  },

  signatoriesPage: {
    updatedAt: (absolute: string) => `Last updated ${absolute}`,
  },
};
