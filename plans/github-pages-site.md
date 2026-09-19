---
status: planned
depends: []
specs:
  - specs/screens/marketing-site.md
---

# Plan: github-pages-site

## Scope
The static homepage under `site/`, its screenshots, and the GitHub Pages workflow. Out: custom domain, analytics, any dynamic content.

## Implements
- `specs/screens/marketing-site.md` — all.

## Approach
1. Seed the live demo document with states worth showing (a conditional signature with an inline comment, a v2 with a disposition, a plain signature) using fictional personas, then capture phone-width screenshots with the browser automation tool at 390×844 and one wide shot of comment mode.
2. Hand-written `site/index.html` + `site/style.css`: system font stack, one accent color, CSS variables with a dark-scheme override, phone frames around screenshots, no scripts.
3. `.github/workflows/pages.yml`: on push to `develop` touching `site/**`, upload `site/` with the official Pages actions and deploy. Enable Pages with build type `workflow` on the repository.
4. Verify the published URL renders, check both color schemes and phone width.

## Validation
- [ ] The page renders at 390 px wide with no horizontal scroll and in both color schemes.
- [ ] Every screenshot shows a fictional participant or the maintainers and no token, email or admin credential.
- [ ] The workflow publishes on a push to `develop` touching `site/**`, and the Pages URL serves the page.
- [ ] No external script or stylesheet is loaded.

## Risks / unknowns
- **Screenshots go stale** as the UI evolves; the capture steps are recorded here so they can be redone.

## Notes
(closeout)

## Follow-ups
(closeout)
