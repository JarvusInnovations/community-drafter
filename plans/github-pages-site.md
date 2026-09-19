---
status: done
pr: 23
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
- [x] The page renders at 390 px wide with no horizontal scroll (scrollWidth 390 at innerWidth 390) and defines a dark-scheme token set; dark mode checked by reading the CSS, not screenshotted.
- [x] Every screenshot shows a fictional participant (Alex Kim, Jane Doe, Sam Rivera) or the maintainer, and no token, email or admin credential (URL bars are not captured).
- [x] The workflow published on the merge of PR #23 (run succeeded) and https://jarvusinnovations.github.io/community-drafter/ returns 200.
- [x] No external script or stylesheet is loaded (`index.html` references only `style.css` and local images).

## Risks / unknowns
- **Screenshots go stale** as the UI evolves; the capture steps are recorded here so they can be redone.

## Notes
- Screenshots were taken against the live demo document after seeding a conditional submission with an inline comment (Jane), a v2 with a disposition, a plain signature (Sam) and a saved draft (Alex). Capture: `chrome-devtools-axi resize 390 844`, open the page, wait for content, `screenshot`. Lazy-loaded images render as blank frames in full-page captures, so the page does not use `loading="lazy"`.
- The comment-mode shot is 1200×800; the rest are 390×844.

## Follow-ups
- Tracked as: re-capture the screenshots once the participant UI gets its visual pass; the comment-mode shot does not show the inline highlight because the anchored passage is below the fold.
