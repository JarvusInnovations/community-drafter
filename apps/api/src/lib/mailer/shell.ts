/**
 * The one email shape every message from an instance uses —
 * `specs/behaviors/notifications.md` § Content rules "Shape": a greeting by
 * name, one or two plain sentences, the clock as a sentence, exactly one
 * action button with the same URL in plain text beneath it, at most one
 * further link, then the small print. The participant templates
 * (`notifications/templates.ts`) and the operator sign-in email
 * (`auth/routes.ts`) both render through here so mail from an instance
 * always looks like it comes from one place.
 *
 * The HTML part says the same words as the text part; it adds only the
 * button in the accent blue and the app's type (`specs/screens/document.md`
 * § Design tokens). No logo, header image, tracking pixel or extra links.
 */

export interface EmailLink {
  label: string;
  url: string;
}

export interface EmailParts {
  /** "Hi Jane," */
  greeting: string;
  /** Plain sentences, one paragraph per entry. An entry starting with "- " renders as a list item. */
  body: string[];
  /** The one action. Its URL is repeated in plain text beneath the button. */
  button: EmailLink;
  /** At most one further link in the body (e.g. the whole document under a "see what changed" button). */
  alsoLink?: EmailLink;
  /** Small print: one line per entry. */
  smallPrint?: string[];
  /** Subscription-message footer links (preferences, stop optional). */
  footerLinks?: EmailLink[];
}

export interface RenderedEmail {
  text: string;
  html: string;
}

const FONT =
  'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK = "#0f172a";
const MUTED = "#5b6472";
const BLUE = "#2457f5";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Groups consecutive "- " lines into one `<ul>`; everything else is a `<p>`. */
function bodyHtml(lines: string[]): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (list.length > 0) {
      out.push(
        `<ul style="margin:0 0 16px;padding-left:20px">${list
          .map((item) => `<li style="margin:0 0 6px">${escapeHtml(item)}</li>`)
          .join("")}</ul>`,
      );
      list = [];
    }
  };
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
    } else {
      flush();
      out.push(`<p style="margin:0 0 16px">${escapeHtml(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

export function renderEmail(parts: EmailParts): RenderedEmail {
  const body = parts.body.filter((line) => line.length > 0);
  const smallPrint = (parts.smallPrint ?? []).filter((line) => line.length > 0);
  const footerLinks = parts.footerLinks ?? [];

  const textBlocks: string[] = [parts.greeting, ...body];
  textBlocks.push(`${parts.button.label}: ${parts.button.url}`);
  if (parts.alsoLink) {
    textBlocks.push(`${parts.alsoLink.label}: ${parts.alsoLink.url}`);
  }
  const tail = [...smallPrint, ...footerLinks.map((link) => `${link.label}: ${link.url}`)];
  if (tail.length > 0) {
    textBlocks.push(tail.join("\n"));
  }
  const text = `${textBlocks.join("\n\n")}\n`;

  const html =
    `<div style="font-family:${FONT};font-size:16px;line-height:1.55;color:${INK};max-width:520px">` +
    `<p style="margin:0 0 16px">${escapeHtml(parts.greeting)}</p>` +
    bodyHtml(body) +
    `<p style="margin:24px 0 12px"><a href="${escapeHtml(parts.button.url)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapeHtml(parts.button.label)}</a></p>` +
    `<p style="margin:0 0 16px;font-size:14px;color:${MUTED}">Or paste this link into your browser:<br><a href="${escapeHtml(parts.button.url)}" style="color:${BLUE}">${escapeHtml(parts.button.url)}</a></p>` +
    (parts.alsoLink
      ? `<p style="margin:0 0 16px"><a href="${escapeHtml(parts.alsoLink.url)}" style="color:${BLUE};font-weight:600">${escapeHtml(parts.alsoLink.label)}</a></p>`
      : "") +
    (tail.length > 0
      ? `<p style="margin:24px 0 0;font-size:14px;color:${MUTED}">` +
        [
          ...smallPrint.map((line) => escapeHtml(line)),
          ...footerLinks.map(
            (link) =>
              `<a href="${escapeHtml(link.url)}" style="color:${MUTED}">${escapeHtml(link.label)}</a>`,
          ),
        ].join("<br>") +
        `</p>`
      : "") +
    `</div>`;

  return { text, html };
}

/** "Jane" from "Jane Doe"; an email address or a single word comes back unchanged. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.includes("@")) return trimmed;
  return trimmed.split(/\s+/u)[0] ?? trimmed;
}
