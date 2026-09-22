---
status: done
depends: []
issues: []
pr: 113
specs:
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
---

# Plan: people-listed-pill

## Scope

The People table shows everything about a signature except the one fact the team has
to honour by hand: whether the signer asked not to be named. A real signer asked to be
certain he is not on the list, and the only way to answer him was to open the record.

**In:** a listing pill on every people row with a live signature; a Listing filter in
the toolbar and in the URL; the same filter on the invitations endpoint; a `listed`
column on `signatories-axi signatures list`.

**Out:** any change to how unlisted signers are counted or displayed in public
(`specs/behaviors/signatures.md` § Display already says counted once, never named, and
the funnel and deliverable already obey it); editing `listed` from the admin surface —
the listing choice stays the signer's, made on their own card.

## Implements

- `specs/screens/admin-dashboard.md` § People — the listing pill on a live signature,
  nothing on a revoked one, and the Listing filter beside status and source; § Design
  "Tables" — the two pill tones.
- `specs/api/admin.md` § People and invitations — `listed` joins the invitation
  filters; § Signatures — the row states the listing choice.
- `specs/api/admin-cli.md` — `signatures list` carries the `listed` column.

## Approach

1. Spec first: the row rule, the filter, the pill tones, the wire.
2. API: `listed=true|false` on `GET /documents/:slug/invitations`, filtered beside
   `status` and `source` so one toolbar has one mechanism.
3. Web: a `Listing` select writing `?listed=`, a removable chip, and a pill in the
   signature cell — `listed` muted, `not listed` amber soft, because the exceptional
   state is the one an operator must act on.
4. CLI: a `listed` column on `signatures list`; rebuild the bundle last.

## Validation

- [x] A listed signer's row shows the muted `listed` pill; an unlisted signer's shows
      the amber `not listed` pill; a revoked signature shows neither.
- [x] The Listing filter reads from the URL on mount, writes back on change, shows a
      removable chip, and narrows the table.
- [x] `GET /documents/:slug/invitations?listed=false` returns only unlisted signers.
- [x] `signatories-axi signatures list` prints `listed` for each signature.
- [x] Confirmed unchanged: "view as" renders the participant's own card, and the
      dashboard counts an unlisted signer once and never names them.
- [x] Gates in every touched package: lint, format:check, typecheck, tests; `apps/web`
      build and `check:bundle-size`.

## Risks / unknowns

- The CLI bundle's drift gate compares the whole committed file, including an embedded
  git sha (issue #112), so the local check goes red again after any later commit; CI
  runs at the PR head.

## Notes

- **The listing choice was already on the wire**, in `buildSignatureView` and so in
  both the invitations and the signatures responses; it was simply never rendered or
  printed. The work was display, a filter and a column.
- **The filter lives on the endpoint, not in the browser**, so one toolbar has one
  mechanism: all four People filters round-trip and survive a reload the same way.
- **A revoked signature shows neither pill.** The alternative — a greyed pill — reads
  as a listing choice still in force, and there is nothing to be on or off once the
  name is off the list.
- Confirmed untouched: `computeSignatories` counts an unlisted signer once, in
  `unlisted` alone, and never names them; "view as" still renders the participant's
  own card read-only, where the signer reads their own listing status.
- The full API suite has an unrelated flake under load (`submit.test.ts`, "declining
  through submit records the revocation as a signature event", 5s timeout); it passes
  on its own.

## Follow-ups

- **None.** Everything in scope shipped in PR #113.
