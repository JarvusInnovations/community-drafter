---
status: done
depends: []
issues: []
pr: 106
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

- [x] The public route serves a PDF for `audience = public` + `public_access = read`, and 404s — same body as an unknown slug — for `audience = closed`, for `public_access = none`, for `state = draft`, and for a `withdrawn` document. `apps/api/src/routes/statement-pdf.test.ts`; the bodies are compared byte for byte, which is what caught the withdrawn case answering in its own words (fixed in its own commit).
- [x] The participant route serves a PDF for any personal link on a readable document, including one whose `audience` is `closed`. Asserted on a `closed`, `public_access: none` letter whose PDF still names its recipient in the title block.
- [x] The operator route is document-scoped: an operator who is not on the document gets the same 404 as an unknown slug. The admin API's not-found body names the slug asked for, so the assertion compares the two sentences with the slug substituted — nothing else distinguishes them.
- [x] A document with a `final` version and a closed signing phase renders clean; every other combination renders with the DRAFT watermark and the version number, and `?draft=1` forces the watermarked form on the admin route only.
- [x] The signatory section honors `show_signatories`: `list` prints organizations then individuals, `count` prints the counts line alone, `none` prints no section at all; an unlisted signer is counted once, in the trailing clause.
- [x] Nothing from the `people` sheet appears in the rendered HTML — asserted against a seeded participant whose person record carries an email and a filed name the signature does not.
- [x] The public route is rate-limited to 10/min per source address and answers 429 `rate_limited` past that. The limiter runs before the slug is looked up, so an unknown slug costs a slot too.
- [x] Golden render: the produced bytes are a PDF of at least one page whose extracted text contains the document title and a signatory's name (`pdf-parse`).
- [x] `signatories-axi docs export <slug> --pdf` writes a file, prints the path, the version and the draft-or-clean word, and never puts PDF bytes on stdout; the committed bundle and SKILL.md are rebuilt and the drift gate passes. `packages/cli/src/e2e.test.ts` runs the real command against the real API.
- [x] Gates in every touched package: `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun test`; `apps/web` also `bun run build` and `bun run check:bundle-size` — 106.75 KB against the 120 KB budget.
- [x] The image builds with Chromium in it, the size delta against the current image is recorded, and a render inside the container proves Chromium launches there. 688 MB → 1.58 GB; the container served `GET /d/coalition-charter/statement.pdf` against a throwaway data repo and returned a real PDF (see Notes).
- [x] Peak memory for one render is measured against Cloud Run's 1 GiB, and `tf/cloudrun.tf` is raised in this PR if it does not fit. It fits with room: 196 MB for a six-page, 300-signatory render, 291 MB for the running service serving the route. `tf/` is untouched.
- [x] Both states are looked at: page one of a draft render and of a clean render, committed under `.verification/` and deleted at closeout.

## Risks / unknowns

- **Chromium is the largest thing in the image** and it is there for one feature. If the delta is unacceptable the alternatives are all worse for this system — a second service needs its own copy of the record, and a pure-TypeScript PDF library gives up the "same HTML the screen renders" property that keeps the deliverable and the screen from drifting.
- **Memory on a 1 GiB singleton.** Bun, the read model, the git working copy and a Chromium render share one instance. The mitigations are one page at a time, an idle shutdown, and a bounded cache; the fallback is a bigger `memory` in `tf/`.
- **The public route is the one expensive anonymous endpoint.** Rate limit plus cache is the answer here; if it is ever abused in earnest the next move is to require the link rather than to make the render cheaper.
- **Chromium is absent in some environments** (a bare dev machine, a CI runner). The renderer must fail with a message that names the missing browser, and the test suite must skip the browser-dependent cases rather than fail on them — while still running every test that does not need a browser.
- **Print fidelity is not screen fidelity.** Tables, long words and headings break differently on paper; the page-break rules in the spec are the ones worth asserting by eye rather than by test.

## Notes

**Chromium is expensive, and it is worth saying how expensive.** The image goes from 688 MB to **1.58 GB** — a delta of 892 MB, almost all of it in one apt layer: `chromium` at 318 MB installed, `chromium-common` at 66 MB, and the software-GL stack its dependencies drag in whether or not a headless render touches it (`libllvm19` at 127 MB, `mesa-libgallium` at 42 MB). `--no-install-recommends` was already in force; the rest is Depends, not Recommends, so it cannot be trimmed by asking apt more politely. The two real ways down are leaving Debian's package (Google's `chrome-headless-shell` is roughly 170 MB, but it is a download at build time, which `specs/architecture.md` rules out on purpose) or moving the render to a second service, which would need its own copy of the record. Neither is obviously right; both are follow-ups rather than blockers, because the thing being printed is the artifact the whole service exists to produce.

**Memory was the risk that did not materialize.** A render of a six-page statement carrying 300 signatories peaks the whole container at **196 MB** (cgroup `memory.peak`, measured inside the image under `--memory=1g`), of which Bun is 58 MB. The full service — read model, data-repo checkout, API, one render — peaks at **291 MB** while serving the public route. Cloud Run's 1 GiB stands untouched. Two things earn that number: only one page renders at a time, and the browser shuts down after five idle minutes, so an instance that never serves a PDF holds nothing.

**Two Chromium behaviors carry the design.** A `position: fixed` element is repainted on every printed page, which is what makes one element a watermark rather than a mark on the first sheet. And page numbers come from Chromium's own footer template rather than CSS, because `counter(page)` in a page margin box is in no shipping browser — that is why the running footer lives in `footerTemplate()` and not in the stylesheet.

**The cache key is the interesting part of the cache.** It carries a hash of the signatory summary alongside the version commit, so a hit is only ever the redrawing of a list that has not changed. That is what lets a cache sit in front of a document whose local principle is "says exactly what the record says at the moment it is rendered": the list is computed on every request either way, and the TTL and the entry bound are about memory alone.

**The public door's 404s had to be flattened.** `assertDeliverableAvailable` refuses a withdrawn document and one with no version, each with a message of its own — useful on the operator and participant doors, a disclosure on the anonymous one. The public route now converts any `not_found` from behind it into the one shared body, and the test compares bytes rather than status codes, which is the only way that class of leak gets caught.

**Two spec corrections came out of building it.** The deliverable's date carries the year, unlike a screen's date-only point, because a printed statement outlives the year it was printed in. And `docs export` prints what it wrote rather than who signed: fetching the counts would take a second request and could only report a moment other than the one the file was rendered at.

**A test suite that renders has to close its server.** The existing route-test pattern cleans up the temp data repo and leaves the Fastify instance to be garbage-collected, which is harmless until the instance owns a browser: the renderer's Chromium is shut down by the app's `onClose` hook, so without a `server.close()` the process outlived `bun test`, held the run's stdout open and made a finished suite look like a hanging one. Worth knowing for any future plan that puts a child process behind a decorator.

**The rename landed mid-flight.** `drafter-axi` became `signatories-axi` on develop while this branch was open; the rebase carried it, and one commit subject on this branch still says the old name.

## Follow-ups

- **Get the image back under a gigabyte.** *Issue.* The two candidates are Google's `chrome-headless-shell` (roughly 170 MB, but downloaded at build time, which `specs/architecture.md` currently forbids) and dropping the software-GL packages a headless render never calls. Either changes a spec before it changes a Dockerfile.
- **The post-close revocation footnote is specified and implemented nowhere.** `specs/behaviors/signatures.md` § Revocation asks every signatory list and count to carry "1 signature removed after closing at the signer's request". No surface does it, and this plan deliberately did not add it here first — the deliverable will inherit it for free from `computeSignatories` the day one does. *Tracked as* a pre-existing gap, not introduced by this plan.
- **The public route's rate limit is a literal.** 10/min per address, fixed in code. If it ever bites a legitimate press moment, it becomes configuration the way `AUTH_LOGIN_RATE_LIMIT` did. *Deferred.*
- **A PDF of an older version, a signatory-list-only export, and mailing the deliverable** were all out of scope and stay out. *None* of them is claimed by a downstream plan.
- No downstream plan absorbs anything from this one.
