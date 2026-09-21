import { existsSync } from "node:fs";

import puppeteer, { type Browser } from "puppeteer-core";

import { ApiError } from "../errors.ts";
import { deliverableCopy } from "./copy.ts";
import { escapeHtml } from "./template.ts";
import type { DeliverableView } from "./view.ts";

/**
 * `specs/architecture.md` § API server: "drives a system Chromium over the
 * DevTools protocol (`puppeteer-core`, no bundled browser download)". The
 * executable is the Debian `chromium` package in the image; locally it is
 * whichever of these a developer already has.
 */
const CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/lib/chromium/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
];

const LAUNCH_ARGS = [
  // The container runs as root and Cloud Run is already a sandbox; Chromium's
  // own setuid sandbox cannot start there.
  "--no-sandbox",
  "--disable-setuid-sandbox",
  // /dev/shm is small on Cloud Run; without this Chromium crashes mid-render.
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--hide-scrollbars",
  "--font-render-hinting=none",
];

/** Page geometry, in millimetres. The footer sits in the bottom margin. */
const MARGIN = { top: "16mm", right: "18mm", bottom: "18mm", left: "18mm" };

/** How long an idle browser stays alive before the process gives its memory back. */
const DEFAULT_IDLE_MS = 5 * 60_000;

export interface PdfRendererOptions {
  executablePath?: string;
  idleMs?: number;
}

/**
 * One browser process, launched on the first render and shut down after an
 * idle period, with renders serialized one page at a time
 * (`specs/architecture.md` § API server). Serialization is not politeness:
 * the service is a 1 GiB singleton, and two concurrent Chromium pages is
 * the shape of an out-of-memory kill that takes the whole instance —
 * including its unpushed writes — with it.
 */
export class PdfRenderer {
  private browser: Browser | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly configuredPath: string | undefined;

  constructor(options: PdfRendererOptions = {}) {
    this.configuredPath = options.executablePath;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  }

  /** The Chromium this renderer would use, or `undefined` when there is none. */
  executablePath(): string | undefined {
    if (this.configuredPath) return this.configuredPath;
    return CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
  }

  /** Whether a render is possible at all here — used to skip, not to fail, in environments without a browser. */
  available(): boolean {
    return this.executablePath() !== undefined;
  }

  async render(view: DeliverableView, html: string): Promise<Uint8Array> {
    const run = this.queue.then(() => this.renderOne(view, html));
    // Keep the chain alive whatever this render does, so one failure does
    // not poison every later caller.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderOne(view: DeliverableView, html: string): Promise<Uint8Array> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluateHandle("document.fonts.ready");
      return await page.pdf({
        format: view.paper === "a4" ? "A4" : "Letter",
        printBackground: true,
        margin: MARGIN,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: footerTemplate(view),
      });
    } finally {
      await page.close().catch(() => undefined);
      this.scheduleIdleShutdown();
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    const executablePath = this.executablePath();
    if (!executablePath) {
      throw new ApiError(
        "internal_error",
        "No Chromium is available to render the statement. Install the `chromium` package or set CHROMIUM_PATH.",
      );
    }

    this.browser = await puppeteer.launch({ executablePath, args: LAUNCH_ARGS });
    return this.browser;
  }

  private scheduleIdleShutdown(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}

/**
 * `specs/screens/deliverable.md` § Display Rules 5: the site's name, the
 * public address when there is one, and "Page n of m" on every page. Page
 * numbers come from Chromium's own footer template because CSS counters are
 * not available in a page margin box in any shipping browser.
 */
export function footerTemplate(view: DeliverableView): string {
  const left = [
    view.draft ? escapeHtml(deliverableCopy.footerDraft(view.versionNumber)) : "",
    escapeHtml(view.siteName),
    view.publicUrl ? escapeHtml(view.publicUrl) : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  return `<div style="width:100%;margin:0 18mm;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.5pt;color:#5b6472;display:flex;justify-content:space-between;align-items:baseline;">
  <span>${left}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
}
