import { afterEach, describe, expect, it } from "bun:test";

import { PDFParse } from "pdf-parse";

import { PdfRenderer } from "../deliverable/renderer.ts";
import { renderDeliverableHtml } from "../deliverable/template.ts";
import { statementPdfLimiter } from "./public/statement-pdf.ts";
import {
  adminHeaders,
  bearerFor,
  buildTestServer,
  seedDocument,
  seedOperator,
  seedParticipant,
} from "./test-support.ts";

type TestServer = Awaited<ReturnType<typeof buildTestServer>>["server"];

const cleanups: Array<() => void> = [];
afterEach(() => {
  statementPdfLimiter.reset();
  while (cleanups.length) cleanups.pop()?.();
});

const TOKEN = "a".repeat(20);

/**
 * The deliverable's renders cost a browser, so every case that can be
 * settled on the print document is settled there
 * (`deliverable/deliverable.test.ts`) and only the golden case below
 * actually prints. Where no Chromium exists at all — a bare dev machine, a
 * CI runner without the package — the browser-dependent cases skip rather
 * than fail, and everything else still runs.
 */
const chromiumAvailable = new PdfRenderer().available();

async function signAs(
  server: TestServer,
  document: string,
  person: string,
  signature: {
    capacity: "personal" | "official";
    display_name: string;
    descriptor?: string;
    org?: string;
    title?: string;
    listed?: boolean;
  },
): Promise<void> {
  await server.storage.commit(
    "sign",
    {
      actor: { kind: "participant" },
      subject: `sign: ${person} on ${document}`,
      document,
      person,
      version: 1,
    },
    async (tx) => {
      await tx.participations.patch(
        { document, person },
        {
          signature: {
            ...signature,
            authorized: true,
            listed: signature.listed ?? true,
            display_approved: true,
            signed_on_version: 1,
          },
        },
      );
    },
  );
}

describe("GET /d/:slug/statement.pdf — the public door", () => {
  it("404s for audience = closed, with the body an unknown slug gets", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "letter-to-the-board",
      audience: "closed",
      addressed_to: ["the State Board of Education"],
      public_access: "read",
      body: "Readable, not downloadable.",
    });

    const refused = await server.inject({ url: "/d/letter-to-the-board/statement.pdf" });
    const unknown = await server.inject({ url: "/d/never-created/statement.pdf" });

    expect(refused.statusCode).toBe(404);
    expect(refused.body).toBe(unknown.body);

    // The same document's text is still readable one route over — which is
    // the whole point of the two settings being separate.
    const readable = await server.inject({ url: "/d/letter-to-the-board/api/bundle" });
    expect(readable.statusCode).toBe(200);
  });

  it("404s for public_access = none, for a draft, and for a withdrawn document", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "private-doc", audience: "public", public_access: "none" });
    await seedDocument(server, {
      slug: "draft-doc",
      audience: "public",
      public_access: "read",
      state: "draft",
    });
    await seedDocument(server, {
      slug: "withdrawn-doc",
      audience: "public",
      public_access: "read",
      state: "withdrawn",
    });

    const unknown = await server.inject({ url: "/d/never-created/statement.pdf" });
    for (const slug of ["private-doc", "draft-doc", "withdrawn-doc"]) {
      const response = await server.inject({ url: `/d/${slug}/statement.pdf` });
      expect(response.statusCode).toBe(404);
      // Byte-identical to a slug that was never created — a withdrawn
      // document saying so in its own words would disclose that it exists.
      expect(response.body).toBe(unknown.body);
    }
  });

  it("is rate-limited per source address", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    // An unknown slug still costs a slot: the limiter runs before anything
    // is looked up, which is what keeps the route's cost bounded whether or
    // not the caller names a real document.
    for (let i = 0; i < 10; i++) {
      const response = await server.inject({ url: "/d/never-created/statement.pdf" });
      expect(response.statusCode).toBe(404);
    }
    const limited = await server.inject({ url: "/d/never-created/statement.pdf" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("GET /admin/api/documents/:slug/statement.pdf — the operator door", () => {
  it("is document-scoped: a non-operator gets the unknown-slug 404", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "scoped-doc", operators: ["owner@example.org"] });
    await seedOperator(server, { email: "owner@example.org" });
    await seedOperator(server, { email: "outsider@example.org" });

    const outsider = await server.inject({
      url: "/admin/api/documents/scoped-doc/statement.pdf",
      headers: await bearerFor("outsider@example.org", "default"),
    });
    const unknown = await server.inject({
      url: "/admin/api/documents/never-created/statement.pdf",
      headers: await bearerFor("outsider@example.org", "default"),
    });

    // The admin API's not-found body names the slug that was asked for, so
    // "identical to an unknown slug" means the same status and the same
    // sentence with the caller's own slug in it — nothing distinguishes a
    // document they may not see from one that does not exist.
    expect(outsider.statusCode).toBe(unknown.statusCode);
    expect(outsider.body).toBe(unknown.body.replace("never-created", "scoped-doc"));
  });

  it("404s a document with no version yet", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await server.storage.commit(
      "create",
      { actor: { kind: "operator", email: "team@example.org" }, subject: "create: bodiless" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "bodiless",
          title: "Bodiless",
          state: "draft",
          body: "",
          audience: "closed",
          addressed_to: ["the Board"],
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    const response = await server.inject({
      url: "/admin/api/documents/bodiless/statement.pdf",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("draft and clean", () => {
  it("is a draft until a final version and a closed signing phase, and clean after", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "charter",
      title: "Charter of the Coalition",
      body: "The first text.",
      audience: "public",
      public_access: "read",
    });

    const before = server.deliverable.view(server.storage.readModel.getDocument("charter")!);
    expect(before.draft).toBe(true);
    expect(before.filename).toBe("charter-v1-draft.pdf");

    // A final version alone is not enough — the list is still taking names.
    const published = await server.inject({
      method: "POST",
      url: "/admin/api/documents/charter/versions",
      headers: adminHeaders(),
      payload: { body: "The final text.", summary: "Final wording", final: true },
    });
    expect(published.statusCode).toBe(200);
    expect(server.deliverable.view(server.storage.readModel.getDocument("charter")!).draft).toBe(
      true,
    );

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/charter/close",
      headers: adminHeaders(),
    });

    const after = server.deliverable.view(server.storage.readModel.getDocument("charter")!);
    expect(after.draft).toBe(false);
    expect(after.final).toBe(true);
    expect(after.filename).toBe("charter-v2.pdf");
    expect(renderDeliverableHtml(after)).not.toContain(">DRAFT<");
  });

  it("lets an operator force the watermark back on, and offers no flag the other way", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "charter2", body: "Text." });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/charter2/versions",
      headers: adminHeaders(),
      payload: { body: "Final text.", summary: "Final", final: true },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/charter2/close",
      headers: adminHeaders(),
    });

    const document = server.storage.readModel.getDocument("charter2")!;
    expect(server.deliverable.view(document, { forceDraft: true }).draft).toBe(true);
    expect(server.deliverable.view(document, { forceDraft: false }).draft).toBe(false);

    // A document that is still a draft cannot be asked for clean.
    await seedDocument(server, { slug: "charter3", body: "Text." });
    const unfinished = server.storage.readModel.getDocument("charter3")!;
    expect(server.deliverable.view(unfinished, { forceDraft: false }).draft).toBe(true);
  });
});

describe("what reaches the page", () => {
  it("names signatories from their signature and nothing from the people sheet", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "charter4",
      title: "Charter",
      body: "Text.",
      show_signatories: "list",
    });
    await seedParticipant(server, {
      document: "charter4",
      person: "jane-doe",
      token: TOKEN,
      email: "jane.private@example.org",
      name: "Jane Q. Doe (as filed)",
    });
    await signAs(server, "charter4", "jane-doe", {
      capacity: "official",
      display_name: "Jane Doe",
      org: "Skype a Scientist",
      title: "Executive Director",
    });
    await seedParticipant(server, {
      document: "charter4",
      person: "pat-lee",
      token: "b".repeat(20),
      email: "pat.private@example.org",
    });
    await signAs(server, "charter4", "pat-lee", {
      capacity: "personal",
      display_name: "Pat Lee",
      listed: false,
    });

    const html = renderDeliverableHtml(
      server.deliverable.view(server.storage.readModel.getDocument("charter4")!),
    );

    expect(html).toContain("Skype a Scientist");
    expect(html).toContain("Jane Doe, Executive Director");
    expect(html).toContain(
      "Signed by 1 organization and 0 individuals, and 1 other who asked not to be listed.",
    );
    expect(html).not.toContain("Pat Lee");
    expect(html).not.toContain("jane.private@example.org");
    expect(html).not.toContain("pat.private@example.org");
    expect(html).not.toContain("as filed");
  });
});

describe.if(chromiumAvailable)("the rendered PDF", () => {
  it("is a PDF of at least one page carrying the title and a signatory", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "golden-charter",
      title: "Charter of the Save the Academy Coalition",
      body: "# Preamble\n\nWe, the undersigned, write to the Board.\n",
      audience: "public",
      public_access: "read",
      show_signatories: "list",
    });
    await seedParticipant(server, {
      document: "golden-charter",
      person: "alex-kim",
      token: TOKEN,
    });
    await signAs(server, "golden-charter", "alex-kim", {
      capacity: "personal",
      display_name: "Alex Kim",
      descriptor: "neighbor and museum member",
    });

    const response = await server.inject({ url: "/d/golden-charter/statement.pdf" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="golden-charter-v1-draft.pdf"',
    );

    const bytes = new Uint8Array(response.rawPayload);
    expect(Buffer.from(bytes.slice(0, 5)).toString("utf8")).toBe("%PDF-");

    const parser = new PDFParse({ data: bytes });
    try {
      const parsed = await parser.getText();
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.text).toContain("Charter of the Save the Academy Coalition");
      expect(parsed.text).toContain("Alex Kim, neighbor and museum member");
      expect(parsed.text).toContain("We, the undersigned, write to the Board.");
    } finally {
      await parser.destroy();
    }
  }, 60_000);

  it("serves the same document to a personal link, closed audience and all", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "closed-letter",
      title: "Letter to the Board",
      body: "Dear Board.",
      audience: "closed",
      addressed_to: ["the State Board of Education"],
      public_access: "none",
    });
    await seedParticipant(server, { document: "closed-letter", person: "alex-kim", token: TOKEN });

    const response = await server.inject({ url: `/i/${TOKEN}/api/statement.pdf` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");

    const parser = new PDFParse({ data: new Uint8Array(response.rawPayload) });
    try {
      const parsed = await parser.getText();
      expect(parsed.text).toContain("To: the State Board of Education");
      expect(parsed.text).toContain("Letter to the Board");
    } finally {
      await parser.destroy();
    }
  }, 60_000);
});
