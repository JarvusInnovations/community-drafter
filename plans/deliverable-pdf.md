---
status: in-progress
depends: []
issues: []
specs:
  - specs/screens/deliverable.md
  - specs/api/participant.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/conventions.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
  - specs/screens/public-and-embed.md
  - specs/architecture.md
---

# Plan: deliverable-pdf

## Scope

The thing the whole service exists to produce: the finished statement, with its signatories, as a PDF.

**In:** the new `specs/screens/deliverable.md` whole — the print document (title block, statement, signatory list, running footer, DRAFT watermark), the server-side renderer (headless Chromium via `puppeteer-core` against a system browser), the in-memory render cache, the three routes and their gates (operator, personal link, public with the `audience` rule and a per-IP rate limit), `chromium` in the `Dockerfile`, `signatories-axi docs export --pdf`, and the three places a human presses a button: the admin dashboard, the participant footer, the public footer.

**Out:** a PDF of anything other than the current version (no per-version export, no diff PDF, no comment appendix); any stored or attached PDF (nothing is written to the data repo, nothing is mailed); a signatory-list-only export; and a hosted print preview route in the SPA. Out too: the post-close revocation footnote (`specs/behaviors/signatures.md` § Revocation), which no surface implements yet and which the deliverable will inherit for free from `computeSignatories` the day one does.

## Implements

- `specs/screens/deliverable.md` — all of it. New spec, written with this plan.
- `specs/api/participant.md` § `GET /i/:token/api/statement.pdf`.
- `specs/api/admin.md` § The deliverable.
- `specs/api/admin-cli.md` → `docs export`, and the output rule that it never writes a PDF to stdout.
- `specs/api/conventions.md` § Rate limits — the public PDF route's 10/min per source address.
- `specs/screens/document.md` § Display Rules 8 and § Actions — the footer link.
- `specs/screens/admin-dashboard.md` § Dashboard and § Actions — the "Download PDF" button.
- `specs/screens/public-and-embed.md` § Routes, § Data Requirements, § Display Rules — the public route, its `audience` gate, `audience` in the public bundle, and the footer link.
- `specs/architecture.md` § API server, § Deployment, § Configuration — Chromium in the image and in the process.

## Approach

1. **The print document, before any browser.** `apps/api/src/deliverable/` builds a `DeliverableView` from the read model (document, site, current version, `computeSignatories`) and renders it to one standalone HTML string with the print stylesheet inline and Inter embedded as a data URI. No network fetch, no SPA, no asset server: the string is the whole document. This half is pure and is where most of the tests live.
2. **The renderer.** `puppeteer-core` connected to a system Chromium found at `CHROMIUM_PATH` or the usual Debian locations. One browser, launched lazily, one page at a time behind a promise chain, closed after an idle timeout and on `onClose`. Page numbers come from Chromium's own footer template (CSS margin-box counters are not available); the watermark is a `position: fixed` element, which Chromium repeats on every printed page.
3. **The cache.** Keyed by slug, version commit, a hash of the signatory summary, the draft/clean word and the paper size — so the key cannot go stale in the way that matters, and the TTL and the entry bound are only about memory.
4. **The routes,** each a thin gate over the same renderer: document-scoped operator, participant, and public with the `audience` check and the `FixedWindowLimiter` the conventions now name.
5. **The doors.** Admin dashboard button, participant footer link, public footer link (which needs `audience` added to the public bundle), and `docs export` in the CLI with a binary-capable client method, then `cd packages/cli && bun run build` for the committed bundle and the generated SKILL.md region.
6. **The image.** `chromium` plus the font packages it needs in the `Dockerfile`, measured against the current image; the render's peak RSS measured against Cloud Run's 1 GiB, and `tf/cloudrun.tf` raised in this PR if it does not fit.

## Validation

- [ ] The public route serves a PDF for `audience = public` + `public_access = read`, and 404s — same body as an unknown slug — for `audience = closed`, for `public_access = none`, for `state = draft`, and for a `withdrawn` document.
- [ ] The participant route serves a PDF for any personal link on a readable document, including one whose `audience` is `closed`.
- [ ] The operator route is document-scoped: an operator who is not on the document gets the same 404 as an unknown slug.
- [ ] A document with a `final` version and a closed signing phase renders clean; every other combination renders with the DRAFT watermark and the version number, and `?draft=1` forces the watermarked form on the admin route only.
- [ ] The signatory section honors `show_signatories`: `list` prints organizations then individuals, `count` prints the counts line alone, `none` prints no section at all; an unlisted signer is counted once, in the trailing clause.
- [ ] Nothing from the `people` sheet appears in the rendered HTML — asserted against a seeded participant whose person record carries an email and a phone the signature does not.
- [ ] The public route is rate-limited to 10/min per source address and answers 429 `rate_limited` past that.
- [ ] Golden render: the produced bytes are a PDF of at least one page whose extracted text contains the document title and a signatory's name (`pdf-parse`).
- [ ] `signatories-axi docs export <slug> --pdf` writes a file, prints the path, the version and the draft-or-clean word, and never puts PDF bytes on stdout; the committed bundle and SKILL.md are rebuilt and the drift gate passes.
- [ ] Gates in every touched package: `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun test`; `apps/web` also `bun run build` and `bun run check:bundle-size` (120 KB).
- [ ] The image builds with Chromium in it, the size delta against the current image is recorded, and a render inside the container proves Chromium launches there.
- [ ] Peak memory for one render is measured against Cloud Run's 1 GiB, and `tf/cloudrun.tf` is raised in this PR if it does not fit.
- [ ] Both states are looked at: page one of a draft render and of a clean render, committed under `.verification/` and deleted at closeout.

## Risks / unknowns

- **Chromium is the largest thing in the image** and it is there for one feature. If the delta is unacceptable the alternatives are all worse for this system — a second service needs its own copy of the record, and a pure-TypeScript PDF library gives up the "same HTML the screen renders" property that keeps the deliverable and the screen from drifting.
- **Memory on a 1 GiB singleton.** Bun, the read model, the git working copy and a Chromium render share one instance. The mitigations are one page at a time, an idle shutdown, and a bounded cache; the fallback is a bigger `memory` in `tf/`.
- **The public route is the one expensive anonymous endpoint.** Rate limit plus cache is the answer here; if it is ever abused in earnest the next move is to require the link rather than to make the render cheaper.
- **Chromium is absent in some environments** (a bare dev machine, a CI runner). The renderer must fail with a message that names the missing browser, and the test suite must skip the browser-dependent cases rather than fail on them — while still running every test that does not need a browser.
- **Print fidelity is not screen fidelity.** Tables, long words and headings break differently on paper; the page-break rules in the spec are the ones worth asserting by eye rather than by test.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
