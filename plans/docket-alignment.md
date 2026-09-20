---
status: planned
depends: []
specs:
  - specs/screens/document.md
  - specs/screens/marketing-site.md
---

# Plan: docket-alignment

## Scope

Close the visible gaps between the live participant surfaces and the chosen "Docket" mock, and bring the GitHub Pages homepage onto the same design: the font (Inter, self-hosted), light scheme only, header order, date format, link styling, document typography, footer, and the secondary participant screens (history, compare, edit-listing form, dialogs) that still use pre-design classes. Restyle `site/` from the old paper-and-green palette to the Docket tokens and re-capture its screenshots. Out: comment mode and the admin dashboard (their own plans, in flight); the preferences route (touched by the admin plan; picks up tokens and font automatically).

## Implements

- `specs/screens/document.md` — § Display Rules 2 (header order) and § Design (tokens: light only, Inter; Header; Dates; Links; Document card type; Footer; Secondary participant screens).
- `specs/screens/marketing-site.md` — § Design and the light-only rule.

## Approach

1. `apps/web`: import `@fontsource-variable/inter`; `font-sans` leads with "Inter Variable"; `color-scheme: light`; delete the automatic dark override. Document body type per the spec.
2. `format.ts`: "Thu, Sep 24 · 5:00 PM EDT" and "Sep 24", year only when not the current year.
3. Components: title → identity line → timeline; quiet-link style everywhere a link or link-like button appears; timeline inactive chip on the page background; footer as one line; history/compare/edit form/confirm dialog to cards, rounded inputs, primary/quiet buttons.
4. `site/`: Docket tokens, Inter from `site/fonts/` (latin subset plus its license), light only, hero as a plain band, buttons and cards per the spec.
5. Deploy, verify at 390 and 1280 against the mock, re-capture `site/img/*.png`, republish Pages.

## Validation

- [ ] Live app renders in Inter with the cool neutral page in both OS color schemes.
- [ ] Identity line sits between the title and the timeline; dates match the spec's form; no default-underlined dark links remain on participant routes.
- [ ] Homepage uses no warm color and no third-party request; screenshots show the aligned app.
- [ ] Existing web tests pass; participant entry stays under the 120 KB budget (the font is a separate asset, not JS).

## Risks / unknowns

- `index.css` is also being appended to by the two in-flight design plans; keep this change to the top of the file so rebases are trivial.

## Notes

(closeout)

## Follow-ups

(closeout)
