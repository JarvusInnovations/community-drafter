import { createHash } from "node:crypto";

import type { ShowSignatories } from "@community-drafter/shared";
import type { FastifyInstance } from "fastify";

import { ApiError } from "../errors.ts";
import { computeSignatories, type SignatorySummary } from "../lib/signatories.ts";
import { derivePhase, type Phase } from "../phase/phase.ts";
import { siteForDocument } from "../sites/site.ts";
import type { DocumentEntry } from "../storage/read-model.ts";

/** `specs/screens/deliverable.md` § Design: "US Letter by default, A4 on request." */
export type Paper = "letter" | "a4";

export function parsePaper(value: string | undefined): Paper {
  return value?.toLowerCase() === "a4" ? "a4" : "letter";
}

/**
 * Everything the printed page needs and nothing else
 * (`specs/screens/deliverable.md` § Data Requirements). Built from the read
 * model, never from a request — the three routes differ only in who may ask
 * for it, so they all end up here with the same document entry.
 */
export interface DeliverableView {
  slug: string;
  siteName: string;
  /** `https://<site hostname>/d/<slug>`, only when the public door is actually open. */
  publicUrl?: string;
  accent?: string;
  title: string;
  addressedTo: string[];
  versionNumber: number;
  versionDate: string;
  final: boolean;
  draft: boolean;
  bodyHtml: string;
  showSignatories: ShowSignatories;
  signatories: SignatorySummary | null;
  paper: Paper;
  /** `<slug>-v3.pdf`, or `<slug>-v3-draft.pdf` while the deliverable is a draft. */
  filename: string;
  /** Document + version commit + signatory-list hash + draft/clean + paper. */
  cacheKey: string;
}

/**
 * `specs/screens/deliverable.md` § Draft and clean: "draft until the
 * document has a version marked `final` **and** signing has closed, and
 * clean from that moment on." Both conditions — either alone leaves
 * something still moving.
 */
export function isDeliverableDraft(document: DocumentEntry, phase: Phase): boolean {
  const hasFinal = document.versions.some((version) => version.final);
  return !(hasFinal && phase === "closed");
}

/**
 * `specs/screens/deliverable.md` § Availability. A document with no version
 * has no text to render; a withdrawn one was taken back, and a file that
 * outlives the withdrawal is the one artifact that could keep circulating.
 * Both answer `not_found` — the same code every door already uses for a
 * document it will not show.
 */
export function assertDeliverableAvailable(document: DocumentEntry): void {
  if (document.record.state === "withdrawn") {
    throw new ApiError("not_found", "This document was withdrawn.");
  }
  if (document.versions.length === 0) {
    throw new ApiError("not_found", "This document has no published version yet.");
  }
}

/** `Sep 20, 2026` in the instance time zone — the year always (§ Display Rules 2). */
export function formatDeliverableDate(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone || "UTC",
  }).format(date);
}

export interface BuildDeliverableOptions {
  paper?: Paper;
  /**
   * `specs/api/admin.md` § The deliverable: `?draft=1` forces the
   * watermarked form of a document that has already gone clean. There is no
   * flag the other way — a clean copy of an unfinished statement is the one
   * thing nobody may produce, so this only ever adds the watermark.
   */
  forceDraft?: boolean;
}

export function buildDeliverableView(
  fastify: FastifyInstance,
  document: DocumentEntry,
  options: BuildDeliverableOptions = {},
): DeliverableView {
  assertDeliverableAvailable(document);

  const version = document.versions[document.versions.length - 1] as NonNullable<
    DocumentEntry["versions"][number]
  >;
  const phase = derivePhase(document.record, new Date());
  const draft = options.forceDraft === true || isDeliverableDraft(document, phase);
  const paper = options.paper ?? "letter";

  const site = siteForDocument(fastify, document.record);
  const showSignatories = document.record.show_signatories ?? "list";
  const signatories = computeSignatories(
    fastify.storage.readModel.listParticipationsForDocument(document.record.slug),
    showSignatories,
  );

  const rendered = fastify.rendering.render(version.commit, version.body);
  const slug = document.record.slug;

  // Only when the public door is actually open (§ Display Rules 5): a URL
  // that 404s is worse than no URL.
  const publiclyReadable =
    (document.record.audience ?? "closed") === "public" &&
    (document.record.public_access ?? "none") !== "none" &&
    document.record.state !== "draft";
  const publicUrl = publiclyReadable && site.baseUrl ? `${site.baseUrl}/d/${slug}` : undefined;

  const signatureHash = createHash("sha256")
    .update(JSON.stringify(signatories ?? null))
    .digest("hex")
    .slice(0, 16);

  return {
    slug,
    siteName: site.name,
    publicUrl,
    accent: site.accent,
    title: document.record.title,
    addressedTo: document.record.addressed_to ?? [],
    versionNumber: version.number,
    versionDate: formatDeliverableDate(version.published_at, fastify.config.INSTANCE_TIMEZONE),
    final: version.final,
    draft,
    bodyHtml: rendered.html,
    showSignatories,
    signatories,
    paper,
    filename: `${slug}-v${version.number}${draft ? "-draft" : ""}.pdf`,
    cacheKey: [slug, version.commit, signatureHash, draft ? "draft" : "clean", paper].join(":"),
  };
}
