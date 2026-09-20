import { type Bundle } from "../types.ts";

/**
 * A minimal, complete `Bundle` fixture for component tests
 * (`plans/participant-sign-flow.md` § Validation: "Each of the six
 * status-card states renders from fixture bundles"). `overrides` is a deep
 * partial applied over `document`/`signature`/etc. so each test only states
 * what differs from this baseline (an open, commenting-phase document,
 * nobody signed yet).
 */
export function makeBundle(overrides: {
  document?: Partial<Bundle["document"]>;
  version?: Partial<Bundle["version"]>;
  signature?: Bundle["signature"];
  position?: Bundle["position"];
  versions?: Bundle["versions"];
  submissions?: Bundle["submissions"];
  signatories?: Bundle["signatories"];
  prefill?: Partial<Bundle["prefill"]>;
}): Bundle {
  return {
    instance: { name: "Community Drafter" },
    person: { id: "jane-doe", name: "Jane Doe" },
    document: {
      slug: "coalition-charter",
      title: "Save the Academy Coalition Charter",
      state: "open",
      phase: "commenting",
      opened_at: "2026-09-01T00:00:00Z",
      comments_close_at: "2026-09-23T21:00:00Z",
      signing_closes_at: "2026-09-30T21:00:00Z",
      capacities: ["personal", "official"],
      show_signatories: "list",
      audience: "closed",
      addressed_to: [],
      reply_to: "team@example.org",
      sender_name: "The Coalition",
      ...overrides.document,
    },
    version: {
      number: 1,
      summary: "Initial draft.",
      published_at: "2026-09-01T00:00:00Z",
      final: false,
      html: "<p>The charter text.</p>",
      is_current: true,
      ...overrides.version,
    },
    versions: overrides.versions ?? [
      {
        number: 1,
        summary: "Initial draft.",
        published_at: "2026-09-01T00:00:00Z",
        final: false,
        dispositions: 0,
      },
    ],
    signature: overrides.signature ?? null,
    position: overrides.position ?? null,
    submissions: overrides.submissions ?? [],
    signatories: overrides.signatories ?? {
      organizations: 0,
      individuals: 0,
      unlisted: 0,
      list: [],
    },
    prefill: { name: "Jane Doe", suggested_capacity: "personal", ...overrides.prefill },
    notify: {
      channel: "email",
      every_revision: false,
      daily_digest: false,
      phase_changes: true,
      my_comments_addressed: true,
      reminders: true,
      forced: [],
    },
  };
}
