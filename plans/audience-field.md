---
status: done
depends:
  - audience-and-consent
issues: [88]
pr: 89
specs:
  - specs/data-model.md
  - specs/behaviors/signatures.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/participant.md
---

# Plan: audience-field

## Scope

Chris's correction of 2026-09-20 to `audience-and-consent` (PR #87): the audience is **a stored field, separate from `public_access`**. Who the finished statement is intended to be published or delivered to — and so who a signer ultimately stands in front of — is a property of the statement; whether anyone with the link may read the *working* document is a property of the drafting process. The two are orthogonal: a letter to a school board can be link-readable while it is drafted, and a public statement can be drafted invitee-only. #87's derivation (`audience` := `public_access` ≠ `none`) is removed, and its `list_visible_to` is replaced by `addressed_to`, which names who the statement goes to under either audience. Out: any change to `public_access` semantics, `show_signatories`, or the sign card's layout beyond the sentence's wording.

## Implements

- `specs/data-model.md` § Audience rewritten: `audience` (`public` | `closed`) is stored on the document; `addressed_to` (array of names — a council, a board, an organization) says who the statement is delivered to and is required when `audience = closed`; `public_access` is documented as drafting-time read access, independent of both. A document written before the field existed reads as `closed` with no `addressed_to` until an operator sets it. `.gitsheets/documents.toml` gains `audience` (enum, optional for old records) and `addressed_to` (array, `sort = true`), and drops `list_visible_to`.
- `specs/behaviors/signatures.md` § Consent at signing: the who-sees sentence is built from `audience`, `addressed_to` and `show_signatories`; it never mentions `public_access`.
- `specs/screens/document.md` § Display Rules 3, *Who sees your name*: public — "This statement and its signatory list will be published for anyone to read." (plus ", addressed to *X* and *Y*" when `addressed_to` is set); closed — "This statement and its signatory list go to *St. Brigid Parish Council*; the people invited to sign can also see the list." `count`/`none` sentences keep their current form with "published" / "delivered" chosen by audience.
- `specs/screens/admin-dashboard.md`: the dashboard header shows the audience and who it is addressed to as its own line, separate from the "Copy public link" affordance that `public_access` drives.
- `specs/api/admin.md`: `POST /documents` requires `audience` and accepts `addressed_to`; `PATCH /documents/:slug` accepts both; 422 when `closed` without `addressed_to`; document shapes return both fields and no longer derive anything.
- `specs/api/admin-cli.md`: `docs create --audience public|closed [--addressed-to "…"]…` (repeatable; `--audience` required), a `docs update <slug>` command carrying the same two flags (settings only, via `PATCH`), `docs show` prints both; `--list-visible-to` removed.
- `specs/api/participant.md`: the bundle's document carries `audience` and `addressed_to` for the sentence.

## Approach

1. Specs first, in one commit, then the sheet config and `packages/shared` record type; remove every trace of `list_visible_to` and the derivation.
2. API: store and validate; the admin document shapes and the participant bundle carry the two fields; the test-support seeders default `audience: "closed"`.
3. Web: the who-sees sentence (sign form and edit form) and the dashboard line; remove the derived helper.
4. CLI: `docs create` flags, new `docs update`, `docs show` output; rebuild the bundle.
5. Tests: sentence per (`audience`, `addressed_to`, `show_signatories`); 422 for `closed` without `addressed_to`; `PATCH` round-trip; old record without the field reads `closed`.

## Validation

- [x] A closed letter addressed to "St. Brigid Parish Council" with `public_access = read` shows the closed sentence naming the council, and `docs show` prints `audience: closed`, `addressed_to`, and `public_access: read` side by side. Checked in a browser at 390 and 1280 against a throwaway data repo (screenshots on PR #89), and asserted in `packages/cli/src/e2e.test.ts`.
- [x] `docs create` without `--audience` is refused with the flag named; `docs update` changes it and the sign card follows. `e2e.test.ts` covers the refusal (exit 2, message names `--audience`) and the `docs update` round-trip; `SignForm.test.tsx` covers the sentence per (`audience`, `addressed_to`, `show_signatories`).
- [x] The demo document `keep-the-museum-open` on the live instance reads as `closed` until updated, then `docs update keep-the-museum-open --audience public` makes it public. Run by the coordinator after deploying `sha-f955240`: read `closed`, updated (commit 6648981), reads `public`; the data repo's `documents` sheet config carried `audience` and `addressed_to` after boot.
- [x] #88 closed by the PR (`Closes #88` in PR #89's body).

## Risks / unknowns

- `list_visible_to` shipped in #87 hours earlier; no real document has set it, so dropping it is a rename, not a migration. Check the live data repo has none before removing the sheet field (the coordinator will).
- `--audience` becoming required on `docs create` breaks any script that omits it; the pilot has none.

## Notes

- **The orthogonality is stated in `specs/data-model.md` § Audience as a table of all four combinations**, because the pair is only comprehensible together: a public statement drafted in private and a letter to a named body drafted in the open are both real, and #87's derivation could express neither.
- **`addressed_to` is required-when-closed in the admin API, not in the sheet schema.** A JSON Schema conditional would reject every record written before the field existed, which is exactly the set the spec says must keep validating. It is a rule about a pair of fields *on a write*, so the write path is where it lives. `PATCH` checks the pair as it will be after the patch, so setting the audience and its recipients in one request works.
- **`--addressed-to` repeats rather than taking a comma-separated list.** The values are proper names, and "Board of Education, District 5" would silently split in two under the `csv()` treatment `--list-visible-to` had. The flag parser gained a `multi` FlagSpec field and a `list()` accessor; `--list-visible-to` is registered as `deprecated` so the old flag names its replacement instead of a bare "unknown flag".
- **A missing `audience` on `POST /documents` is 400 `invalid_request`, not 422.** `specs/api/conventions.md` already routes a missing required body field through Fastify's own schema; only the `addressed_to` pairing rule is a 422 the handler raises. The spec was amended to say so rather than the convention bent to match the plan's wording.
- **The participant bundle deliberately omits `public_access`.** Who may read the draft this week is not a fact a signer is asked to stand behind, and leaving it out of the bundle makes the "never mention `public_access`" rule structural rather than a convention the next sentence-editor has to remember.
- `count` / `none` sentences now pick "published" or "delivered" from the audience, so every branch of the sentence says which of the two things is happening to the statement.

## Follow-ups

- **None.** No live record carried `list_visible_to`, so nothing needed migrating; the one operational step left is the coordinator's third validation box (setting the demo document's audience after deploy), which is that plan item, not a new one.
