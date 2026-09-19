import { afterEach, describe, expect, it } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Widget": "Under
 * 3 KB." / "degrades to nothing if the JSON is unavailable."
 * `plans/public-and-embed.md` § Validation: "`widget.js` is under 3 KB,
 * renders the counts sentence, and renders nothing when the JSON endpoint
 * returns 404." `apps/web/public/widget.js` is copied verbatim to
 * `dist/widget.js` by Vite and served at `/d/:slug/widget.js`
 * (`apps/api/src/routes/public/widget.ts`) — there is no separate minify
 * step, so the committed source itself must already be under budget.
 */
const WIDGET_PATH = join(import.meta.dirname, "..", "..", "public", "widget.js");

/**
 * Dynamically imports the widget source fresh (a cache-busting query per
 * call, since ESM module instances are cached by URL and each test needs
 * its own run of the top-level IIFE) instead of `eval`, which oxlint's
 * `no-eval` rule (enabled via the `suspicious` category) forbids. The file
 * has no `import`/`export` of its own — it's a plain classic script meant
 * for a bare `<script src>` tag — but importing it still just runs its
 * top-level code, which is all a test needs.
 */
function loadWidget(): Promise<unknown> {
  return import(`${WIDGET_PATH}?case=${Math.random()}`);
}

const originalFetch = global.fetch;

afterEach(() => {
  document.body.innerHTML = "";
  global.fetch = originalFetch;
});

/** Flushes the widget's `fetch().then(json).then(render)` microtask/macrotask chain. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("widget.js", () => {
  it("is under 3 KB", () => {
    const { size } = statSync(WIDGET_PATH);
    expect(size).toBeLessThan(3 * 1024);
  });

  it("renders the counts sentence into every [data-drafter-doc] element", async () => {
    document.body.innerHTML = '<div data-drafter-doc="coalition-charter"></div>';

    global.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ organizations: 2, individuals: 5, unlisted: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as unknown as typeof fetch;

    await loadWidget();
    await flush();

    const el = document.querySelector("[data-drafter-doc]") as HTMLElement;
    expect(el.textContent).toContain("Signed by 2 organizations and 5 individuals");
    expect(el.textContent).toContain("and 1 other who asked not to be listed");
  });

  it("renders nothing when the JSON endpoint 404s", async () => {
    document.body.innerHTML = '<div data-drafter-doc="draft-only"></div>';

    global.fetch = (() =>
      Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;

    await loadWidget();
    await flush();

    const el = document.querySelector("[data-drafter-doc]") as HTMLElement;
    expect(el.innerHTML).toBe("");
  });
});
