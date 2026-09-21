---
status: in-progress
depends: []
issues: [83]
specs:
  - specs/screens/marketing-site.md
  - specs/screens/public-and-embed.md
  - specs/screens/version-history.md
---

# Plan: share-previews

## Scope

Chris's decision of 2026-09-20: links to this product get forwarded — pasted into Slack, iMessage, WhatsApp, a board email — and today neither the marketing site nor a public document link carries any social metadata, so every one of those previews is a bare URL or a scrape of the first text the crawler finds. Two surfaces get a share preview:

1. **The marketing site** (`site/`, GitHub Pages): Open Graph and Twitter card meta, a 1200×630 card image generated from the site's own tokens and fonts and served as a static file from `site/`, and a favicon set. No external services and no third-party requests — the spec's existing rule.
2. **Public document links** (`/d/:slug`, served by `apps/api` from the built `apps/web`): the HTML the server returns carries OG/Twitter meta naming the document, a one-line description, `og:type=article`, a canonical URL, and a generic instance card image. A private or unknown slug, a personal link, and every admin page get the generic instance tags and nothing that confirms a document exists.

Also in: **#83**, the compare view's missing list-item bullet, as a CSS fix (it is the same "a forwarded link should look right" pass, and it is two rules).

Out: per-document rendered card images (a generic instance card is enough — a per-document image means an image renderer in the request path and a cache, and the title is already in the preview text); `oEmbed`; structured data / JSON-LD; anything that changes diff semantics for #83.

## Implements

- `specs/screens/marketing-site.md` § Display Rules gains a *Share preview and icons* rule: the page carries a description, a canonical URL, and Open Graph/Twitter card metadata naming the platform (never a tenant), with a 1200×630 card image and a favicon set served from `site/` itself, so the no-third-party-requests rule holds for the preview too.
- `specs/screens/public-and-embed.md` gains a § Share preview: what a public document page's HTML declares (title, one-line description from the current version's `summary`, else the first sentence of its body, else a generic line; `og:type=article`; canonical `<instance>/d/<slug>`; a generic instance card image), and the privacy rule for everything else — an unknown slug, `public_access = none`, `state = draft`, any `/i/:token/…` page and any `/admin` page get the generic instance tags only, plus `noindex` on the pages that are nobody's to index.
- `specs/screens/public-and-embed.md` § Principles, Local: **A share preview never confirms a private document exists.** The most specific spec that owns share previews owns the rule; it is the same reasoning as the one shared `PUBLIC_NOT_FOUND` body, applied to the metadata a scraper reads without a human ever clicking.
- `specs/screens/version-history.md` § Display Rules "Compare": a list item reads as a list item whatever its status — #83.

## Approach

1. **Specs first**, in one `docs(specs)` commit.
2. **Card images and icons.** Write the card as an HTML file rendered at exactly 1200×630 in `chrome-devtools-axi` (`resize 1200 630` → `screenshot`), using `site/style.css`'s tokens and the site's own Inter file. Two cards: the marketing one (`site/og.png`) and a generic instance one (`apps/web/public/og.png`, shipped in the web build). Keep the card sources committed next to what they render so either can be regenerated. Favicon set for the site: the app's mark as `favicon.svg`, plus `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `site.webmanifest`.
3. **`site/index.html` head**: canonical, OG, Twitter, icon links. The existing `<meta name="description">` stays as the description the OG tags mirror.
4. **API.** A new `apps/api/src/lib/share-preview.ts`: `resolvePreview(fastify, request, path)` → the tag set for that path, `renderPreviewTags()` → the HTML, `injectPreviewTags()` → the tags spliced into the SPA shell's `<head>` with its `<title>` replaced. `routes/static.ts`'s SPA-shell handler reads `index.html` (mtime-cached), injects, and sends HTML instead of `sendFile`. Only a path matching `/d/:slug` resolves a document, and only through the same gate `routes/public/context.ts` uses; everything else takes the generic branch by construction, so there is no path by which a personal link grows a document-specific tag. `og.png` joins `PUBLIC_ROOT_FILES` so the built web app serves it.
5. **#83.** `.diff-block` gets one uniform left gutter (a transparent 2 px left border plus the padding) that added/removed only recolor, so every block lines up whatever its status; a bare `li` inside a diff block gets the list indent `.doc-body ul/ol` give their items, which is where the outside-positioned marker renders.
6. **Tests.** `routes/static.test.ts`: a public slug's HTML carries `og:title` with the document title and `og:type=article`; a private slug, an unknown slug, a `/i/:token` page and `/admin` carry the generic tags, no document title, and the same bytes as each other.

## Validation

- [ ] `GET /d/<public-slug>` returns HTML whose `og:title` is the document title, whose `og:description` is the current version's summary, whose `og:url` is `<PUBLIC_URL>/d/<slug>`, and whose `og:type` is `article`.
- [ ] `GET /d/<private-slug>`, `GET /d/<unknown-slug>`, `GET /i/<token>` and `GET /admin` return the generic instance tags, identical to each other in everything but the URL, with the document's title appearing nowhere.
- [ ] The marketing site's card renders at 1200×630 from the site's own tokens and fonts, is served from `site/`, and the page makes no third-party request.
- [ ] A whole added or removed list item in the compare view shows its marker and lines up with its unchanged neighbours (#83).
- [ ] Gates green in every touched package: `lint`, `format:check`, `typecheck`, `test`; `apps/web` also `build` and `check:bundle-size` under 120 KB gzip.
- [ ] #83 closed by the PR.

## Risks / unknowns

- **Injecting into `index.html` costs the `sendFile` fast path.** The shell is a few KB and the instance is one container; cache the file by mtime and it is a string splice per request. Watch that the injection still leaves the Vite-built `<script type="module">` untouched.
- **`PUBLIC_URL` is optional in dev.** Absolute URLs are mandatory in OG, so fall back to the request's own scheme and host. Production always sets `PUBLIC_URL`, which takes precedence, so the fallback never decides a live preview.
- **A crawler that renders JS** would see the SPA's own title after hydration; every real scraper reads the served HTML, which is what this changes.
- **Ordered-list items in the compare view** still show a disc, because each block is injected alone outside any `<ol>`. Out of scope here (it needs the block's `ordered` flag threaded through the diff result); the bullet-versus-no-bullet regression #83 names is what this fixes.

## Notes

(at closeout)

## Follow-ups

(at closeout)
