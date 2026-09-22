---
status: in-progress
depends: []
issues: []
specs:
  - specs/behaviors/versioning.md
  - specs/behaviors/signatures.md
  - specs/behaviors/notifications.md
  - specs/screens/document.md
  - specs/screens/deliverable.md
  - specs/api/participant.md
  - specs/api/admin-cli.md
---

# Plan: document-typography

## Scope

Six refinements to how a document renders and how the signed card reads, asked for
while a real statement was open for comment. Each is small; together they are the
difference between a page that looks authored and one that looks pasted.

**In:**

1. **Citation modes** — a `citations` option on the shared render pipeline with three
   modes (`links`, `footnotes`, `hybrid`), a numbered **Sources** section, a reader
   toggle on the web document and read views, `?citations=` on the document and PDF
   routes, and `--citations` on `signatories-axi docs export --pdf`.
2. **Horizontal rules** — `---` renders as a section break, on screen and on paper.
3. **Block classes** — a whitelisted `{.class}` suffix and `::: class` container so an
   author can mark a lede, a callout, small print or a centered block.
4. **The signed card** — restructured from one run-on sentence into a heading, a facts
   list and one action row.
5. **Listing status on the signed card** — and in the signing and listing-changed
   confirmation emails.
6. **Timeline breathing room** — the "today" marker's label sits flush against the
   countdown chips above it; the track gets a little more air.

**Out:** any new authoring surface (the markdown still arrives through the existing
publish path); per-block styling beyond the four whitelisted classes; a citation style
other than plain numbered URLs (no author/date, no CSL); footnote modes on the compare
view or in comment mode, which stay on `links` forever; and any change to how comments
anchor — block ids and block text must come out byte-identical in all three modes, and
the plan is failed if they do not.

## Implements

- `specs/behaviors/versioning.md` § Rendering — new section: the pipeline's guarantees,
  the three citation modes, the citation rule, and the block-class authoring syntax and
  whitelist.
- `specs/screens/document.md` § Display Rules 3 (*Signed*) — the restructured card and
  the listing fact; § Display Rules 5 and § Design — the reader toggle, the section
  break and the block classes; § Actions — the toggle row.
- `specs/screens/document.md` § Display Rules 2 — the timeline's "today" label keeps
  clear space below the countdown chips.
- `specs/behaviors/signatures.md` § Display — a signer is told their listing status on
  their own card and in the confirmation mail.
- `specs/behaviors/notifications.md` § Messages — `signature-confirmation-<ts>` and
  `listing-changed-<ts>` both state the listing status.
- `specs/screens/deliverable.md` § Routes, § Display Rules 3, § Design — `hybrid` by
  default, `?citations=`, and the printed Sources section.
- `specs/api/participant.md` and `specs/screens/public-and-embed.md` — `?citations=` on
  the bundle, version and statement-PDF routes.
- `specs/api/admin-cli.md` — `docs export --citations`.

## Approach

1. **Render first.** `render(markdown, { citations })` in `packages/shared`. The
   citation transform is a rehype plugin that runs *after* `rehype-block-ids`, so the
   blocks (ids, normalized text, per-block HTML) are extracted from the links-mode tree
   and are identical in every mode by construction, and the appended Sources section
   can never become a commentable block. Block classes are a remark-stage concern
   (`{.class}` stripped from the text, `:::` containers via `remark-directive`), so
   they change the text the same way in every mode.
2. **Sanitizer whitelist.** Extend the `rehype-sanitize` schema with `className`
   restricted to exactly `lede`, `callout`, `small`, `center`. Nothing else survives.
3. **Cache key.** `RenderCache` keys on commit *and* mode.
4. **Routes.** `citationsFromQuery` in the API, shared by the bundle, version and PDF
   routes; the PDF defaults to `hybrid`, everything else to `links`.
5. **Web.** A `useCitationsMode` hook reading `?citations=` then `localStorage`, a quiet
   toggle on the document card, and the bundle/version fetches carrying the mode. The
   compare and comment routes never pass it.
6. **CSS.** `hr` and the four block classes in `apps/web/src/index.css` and in
   `apps/api/src/deliverable/template.ts`, plus the Sources section and the citation
   superscript in both.
7. **The card.** Rebuild the *Signed* branch of `StatusCard` as heading + `<dl>` facts +
   one action row; keep the focus/live-region behaviour, the drift line, the read-only
   mode and the official-capacity wording.
8. **Mail.** `listed` into `signatureConfirmationTemplate` and the existing
   `listingChangedTemplate`, stated only where a signatory list exists at all.

## Validation

- [ ] `render` in all three modes: numbering in first-appearance order, a URL cited
      twice reusing its number, GFM footnotes untouched, a link whose text is itself a
      URL never numbered, and `blocks` byte-identical across the three modes.
- [ ] The Sources section carries no `data-block` and contributes no blocks.
- [ ] `{.lede}` on a paragraph and a heading, `::: callout` around a run of blocks: the
      class lands, a non-whitelisted class is stripped, the container is not a block,
      the paragraphs inside keep the ids they would have had, and the diff still aligns
      them.
- [ ] `---` renders an `hr` and both stylesheets style it.
- [ ] The timeline's "today" label has clear space above it at 390 and 1280.
- [ ] The signed card renders its facts including the listed / not-listed line, in
      personal and official capacity, listed and unlisted, with the actions in one row.
- [ ] Both emails state the listing status.
- [ ] `?citations=hybrid` on a statement PDF produces a Sources list.
- [ ] Gates in every touched package: lint, format:check, typecheck, tests; `apps/web`
      build and `check:bundle-size` under 120 KB gzip.
- [ ] Browser check at 390 and 1280 against a throwaway data repo: the document screen
      with the toggle off and on, the signed card listed and unlisted, an `hr`, a lede
      block, the timeline's "today" label, and the PDF at `hybrid`.

## Risks / unknowns

- **`remark-directive` parses `:name` in running prose as a text directive.** Left
  unhandled those nodes vanish from the output — unacceptable in a live statement. The
  plugin restores any directive it does not handle to its literal source text.
- **`::: lede` with a space is not `remark-directive` syntax** (it wants `:::lede`).
  Authors write the Pandoc form, so the renderer normalizes `::: name` to `:::name`
  before parsing, outside fenced code.
- **The reader toggle needs per-viewer storage**, which `specs/screens/document.md`
  previously ruled out on this route. The spec is amended rather than worked around:
  the exception is display-only and the page renders correctly without it.

## Notes

## Follow-ups
