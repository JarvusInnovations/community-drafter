---
status: done
depends:
  - signature-version
specs:
  - specs/data-model.md
  - specs/behaviors/signatures.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/participant.md
  - specs/behaviors/notifications.md
issues: [70, 57]
pr: 87
---

# Plan: audience-and-consent

## Scope

Decisions 2 and 4 of 2026-09-20 plus the official-capacity gaps (#70, #57). A document declares its **audience** up front: `public` (anyone with the link can read; the signatory list is public per `show_signatories`) or `closed` (invitees only; the list is shown to invitees and, optionally, to named organizations). The sign card says in one sentence who will see the name, and carries the "List my name publicly" choice before signing. Changing the organization after signing requires the attestation again; any listing edit sends a confirmation email. Official capacity names the organization in the button, the confirmation and the email; title is required; suggested capacity preselects. Conditional signatures are marked for the team and for the signer, not the public. Depends on `signature-version` because both rewrite the signed-state card.

## Implements

- `specs/data-model.md` — `documents.audience` (`public` | `closed`, default `closed`), `documents.list_visible_to` (`invitees` | `invitees_and_orgs` with a list of org names) ; `public_access` becomes derived from `audience` for the read view (keep the field, document the relationship).
- `specs/behaviors/signatures.md` — consent at signing; re-attestation on organization change; listing-edit confirmation; conditional marker rule (team and signer see it; public does not).
- `specs/screens/document.md` — the who-sees sentence; the listing checkbox on the sign form; "Sign for <Organization>" button label; confirmation and receipt name organization and title; conditional badge on the signer's own card.
- `specs/screens/admin-dashboard.md` — people table conditional pill (exists) and the audience shown on the dashboard.
- `specs/api/admin.md`, `specs/api/admin-cli.md` — `docs create --audience public|closed [--list-visible-to …]`, `docs show` prints it.
- `specs/behaviors/notifications.md` — `listing-changed-<ts>` transactional message.

## Approach

1. Data model and CLI flags; `docs create` defaults to `closed`; existing documents derive `audience` from `public_access` (read → public).
2. Sign form: the sentence ("Your name will appear on the list that <audience sentence>."), the checkbox (default on, per `show_signatories`), the organization in the button and title required when official; `suggested_capacity` preselects.
3. Edit form: attestation shown again whenever the organization or capacity changes; save sends `listing-changed`.
4. Conditional marker on the signer's card and the team's views; public list unchanged.
5. Tests for each rule; browser check at 390 and 1280.

## Validation

- [x] The parish signer's scenario: organization change requires re-attestation and produces an email; the button reads "Sign for St. Brigid Parish Council".
- [x] The skeptic's scenario: the who-sees sentence and the listing choice are visible before signing.
- [x] #70 and #57 closed by the PR.

## Risks / unknowns

- `audience` overlaps `public_access`; keep one source of truth in the record and document the derivation, or the CLI and dashboard will disagree.

## Notes

- **The audience is derived, not stored.** The plan listed `documents.audience` as a
  field and, in the same breath, named the overlap with `public_access` as its risk.
  `public` / `closed` is exactly the partition `public_access` already draws, so storing
  both would have been two fields encoding one fact — the drift the risk warned about.
  `--audience` writes `public_access`; every surface derives the word from it
  (`specs/data-model.md` § Audience). Consequence worth remembering: no migration was
  needed, and a document created before the word existed already has an audience.
- **`list_visible_to` is a disclosure, not a permission.** Phase 1 has no way to
  authenticate an organization, so naming one there changes the sentence the signer
  reads and the line the dashboard shows, and nothing else. Specifying it that way is
  what keeps the sign card's promise honest; if a phase-2 organization sign-in ever
  lands, the field is already the right shape to gate on.
- **Title required in official capacity** resolves the first judgement call in #81
  (decided 2026-09-20). The field carries `required`, so the empty case never reaches
  the submit handler — the trim check exists for whitespace, which `required` lets past.
- `.gitsheets/documents.toml` changed (optional `list_visible_to`); production's data
  repo receives it through `syncSheetConfigs` at boot, so the next deploy is worth
  watching. Existing records still validate.
- The re-attestation gate keys on `org` alone. Capacity cannot change through PATCH —
  changing capacity replaces the signature and goes through `POST /signature`, which has
  always required the attestation — so there was nothing to add for the capacity half of
  the rule beyond writing it down.

## Follow-ups

- Issue [#81](https://github.com/JarvusInnovations/community-drafter/issues/81) — its
  second observation (a preferences link on transactional messages) is untouched and the
  issue stays open. The plan resolved only the title half, as scoped.
- None other. The conditional marker for the team (people-table pill, dashboard tile)
  already existed from earlier plans and needed no work.
