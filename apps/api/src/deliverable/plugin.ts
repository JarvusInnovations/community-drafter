import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import type { DocumentEntry } from "../storage/read-model.ts";
import { DeliverableCache } from "./cache.ts";
import { PdfRenderer } from "./renderer.ts";
import { renderDeliverableHtml } from "./template.ts";
import {
  buildDeliverableView,
  type BuildDeliverableOptions,
  type DeliverableView,
} from "./view.ts";

export interface DeliverablePdf {
  bytes: Uint8Array;
  view: DeliverableView;
}

/**
 * The one way any of the three doors (`specs/screens/deliverable.md` §
 * Routes) turns a document into a PDF. Each route decides *who may ask*;
 * none of them decides what comes out, so an operator, a signer and the
 * public read the same file.
 */
export class DeliverableService {
  readonly renderer: PdfRenderer;
  private readonly cache: DeliverableCache;

  constructor(
    private readonly fastify: FastifyInstance,
    renderer?: PdfRenderer,
  ) {
    this.renderer = renderer ?? new PdfRenderer({ executablePath: fastify.config.CHROMIUM_PATH });
    this.cache = new DeliverableCache();
  }

  view(document: DocumentEntry, options: BuildDeliverableOptions = {}): DeliverableView {
    return buildDeliverableView(this.fastify, document, options);
  }

  async pdf(
    document: DocumentEntry,
    options: BuildDeliverableOptions = {},
  ): Promise<DeliverablePdf> {
    const view = this.view(document, options);
    const cached = this.cache.get(view.cacheKey);
    if (cached) return { bytes: cached, view };

    const bytes = await this.renderer.render(view, renderDeliverableHtml(view));
    this.cache.set(view.cacheKey, bytes);
    return { bytes, view };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    deliverable: DeliverableService;
  }
}

const deliverablePlugin: FastifyPluginAsync = async (fastify) => {
  const service = new DeliverableService(fastify);
  fastify.decorate("deliverable", service);
  fastify.addHook("onClose", async () => {
    await service.renderer.close();
  });
};

export default fp(deliverablePlugin, "5.x");
