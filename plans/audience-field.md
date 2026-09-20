---
status: planned
depends:
  - audience-and-consent
issues: [88]
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

- [ ] A closed letter addressed to "St. Brigid Parish Council" with `public_access = read` shows the closed sentence naming the council, and `docs show` prints `audience: closed`, `addressed_to`, and `public_access: read` side by side.
- [ ] `docs create` without `--audience` is refused with the flag named; `docs update` changes it and the sign card follows.
- [ ] The demo document `keep-the-museum-open` on the live instance reads as `closed` until updated, then `docs update keep-the-museum-open --audience public` makes it public (run by the coordinator after deploy, not by the agent).
- [ ] #88 closed by the PR.

## Risks / unknowns

- `list_visible_to` shipped in #87 hours earlier; no real document has set it, so dropping it is a rename, not a migration. Check the live data repo has none before removing the sheet field (the coordinator will).
- `--audience` becoming required on `docs create` breaks any script that omits it; the pilot has none.

## Notes

(closeout)

## Follow-ups

(closeout)
