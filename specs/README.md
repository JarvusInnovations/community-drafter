# Specs

`specs/` declares the complete desired state of Signatories: what *should be true* of the running software. Implementation follows spec; spec↔code drift is a bug. The methodology (spec-first flow, plans DAG, draft planning PRs, closeout ritual) is carried by the vendored **specops** skill at `.agents/skills/specops/`.

## What this system is

Signatories is a single-instance web service that lets a small core team publish a draft statement, letter, or charter to an invited community, collect comments and signatures against a visible clock, publish revisions as plain-numbered versions (v1, v2, v3) with a one-line changelog, and come out the other side with a final text and a truthful signatory list.

It exists so that a coalition can say "the community saw this and could object" and mean it, without the statement dying in committee. The tool is generic: one instance serves any number of organizations and documents. The **pilot** is the Save the Academy Coalition, whose draft charter (September 2026) is the concrete process the first release must serve: draft → open window with a real deadline → signatories added by name → a record the press can ask about. Where a spec uses the pilot as an example it says so; nothing in the desired state is specific to it.

## Layout

```
specs/
├── README.md                     this file
├── principles.md                 project-wide decisive rules
├── architecture.md               stack, storage, deployment, module boundaries
├── data-model.md                 sheets, records, fields, relationships
├── behaviors/
│   ├── document-lifecycle.md     phases, the clock, transitions
│   ├── access-and-identity.md    personal links, tokens, public links
│   ├── operators.md              operators, magic-link sign-in, sessions, device-code CLI auth, refresh webhook
│   ├── sites.md                  hostnames, per-site identity, tenancy, per-site mail
│   ├── versioning.md             versions, changelog, diffs, rendering
│   ├── inline-comments.md        anchoring comments to text across versions
│   ├── review-and-judgement.md   drafts, submission, judgements, dispositions
│   ├── signatures.md             capacity, display, conditional, revocation
│   └── notifications.md          events, channels, subscriptions, sending
├── screens/
│   ├── document.md               the participant page: read + sign
│   ├── comment-mode.md           PR-review-style commenting
│   ├── version-history.md        versions list and diff view
│   ├── preferences.md            notification preferences
│   ├── public-and-embed.md       anyone-with-the-link views and embeds
│   └── admin-dashboard.md        per-document progress view
└── api/
    ├── conventions.md            URL scheme, auth, errors, content types
    ├── auth.md                   magic link, session, device code, refresh, logout
    ├── participant.md            endpoints behind a personal link
    ├── admin.md                  endpoints behind the admin token
    └── admin-cli.md              the agent-facing CLI over the admin API
```

## Conventions

- Specs say **what** must be true, not **how**. Widget trees, file names and variable names are implementation.
- Each screen/behavior/API spec may carry a `## Principles` section: **Inherited** links into `principles.md`; **Local** principles are owned by that spec and promoted when they spread.
- Phase markers: a rule tagged **[phase 2]** is specified now so phase-1 implementers leave room for it, but no phase-1 plan implements it. Unmarked rules are phase 1.
- Open design questions are tagged **[decide]** inline. A spec with `[decide]` tags is still in design and lives on the draft planning PR, not the main branch.

## Workflow

1. Change the spec first, on a branch. Get it accepted.
2. Author or update the plan(s) in `plans/` that bring code into conformance.
3. Implement; verify against the spec; close the plan out.

Query the plans DAG: `.agents/skills/specops/scripts/specops next` and `.agents/skills/specops/scripts/specops dag`.
