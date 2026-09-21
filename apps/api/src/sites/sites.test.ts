import { afterEach, describe, expect, it } from "bun:test";

import { FakeMailer } from "../lib/mailer/index.ts";
import {
  adminHeaders,
  bearerFor,
  buildTestServer,
  seedDocument,
  seedOperator,
  seedParticipant,
  seedSite,
  TEST_ACTOR,
} from "../routes/test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const DEFAULT_HOST = "drafter.test";
const A_HOST = "letters.example.test";
const B_HOST = "notes.other.test";

/**
 * Two tenants on one deployment — the shape every scoping rule in
 * `specs/behaviors/sites.md` has to be checked against, because a missed
 * scope check does not fail loudly: it shows another tenant's data.
 */
async function twoTenants(opts: { mailer?: FakeMailer } = {}) {
  const built = await buildTestServer({
    mailer: opts.mailer,
    env: { PUBLIC_URL: `https://${DEFAULT_HOST}`, INSTANCE_FROM_EMAIL: "platform@example.org" },
  });
  cleanups.push(built.cleanup);
  const { server } = built;

  await seedOperator(server, { email: "ann@a.test", name: "Ann" });
  await seedOperator(server, { email: "bob@b.test", name: "Bob" });
  await seedSite(server, {
    slug: "site-a",
    hostname: A_HOST,
    name: "Site A",
    reply_to: "a-team@a.test",
    operators: ["ann@a.test"],
  });
  await seedSite(server, {
    slug: "site-b",
    hostname: B_HOST,
    name: "Site B",
    reply_to: "b-team@b.test",
    operators: ["bob@b.test"],
  });
  await seedDocument(server, {
    slug: "a-letter",
    site: "site-a",
    public_access: "read",
    operators: ["ann@a.test"],
    created_by: "ann@a.test",
  });
  await seedDocument(server, {
    slug: "b-note",
    site: "site-b",
    public_access: "read",
    operators: ["bob@b.test"],
    created_by: "bob@b.test",
  });

  return built;
}

describe("host → site resolution and the canonical-host redirect", () => {
  it("redirects a document reached on another site's host, path and query intact", async () => {
    const { server } = await twoTenants();

    const wrongHost = await server.inject({
      method: "GET",
      url: "/d/a-letter/history?from=1&to=2",
      headers: { host: B_HOST },
    });
    expect(wrongHost.statusCode).toBe(302);
    expect(wrongHost.headers.location).toBe(`https://${A_HOST}/d/a-letter/history?from=1&to=2`);

    // The JSON route rather than the SPA shell: the built web app is not
    // present in this package's test run, and what is being checked here is
    // that the canonical host does not redirect.
    const rightHost = await server.inject({
      method: "GET",
      url: "/d/a-letter/api/bundle",
      headers: { host: A_HOST },
    });
    expect(rightHost.statusCode).toBe(200);

    await server.close();
  });

  it("redirects a personal link to the document's host, and 404s an unknown token identically everywhere", async () => {
    const { server } = await twoTenants();
    await seedParticipant(server, {
      document: "a-letter",
      person: "jane-doe",
      token: "TOKENA0000000000",
    });

    const wrongHost = await server.inject({
      method: "GET",
      url: "/i/TOKENA0000000000/api/bundle",
      headers: { host: B_HOST },
    });
    expect(wrongHost.statusCode).toBe(302);
    expect(wrongHost.headers.location).toBe(`https://${A_HOST}/i/TOKENA0000000000/api/bundle`);

    // An unknown token — and an unknown slug — answer the same on every
    // host, with nothing that distinguishes a wrong host from a wrong
    // document (`specs/behaviors/sites.md` § The document's site is canonical).
    const unknownOnA = await server.inject({
      method: "GET",
      url: "/i/NOPE-NOPE-NOPE/api/bundle",
      headers: { host: A_HOST },
    });
    const unknownOnB = await server.inject({
      method: "GET",
      url: "/i/NOPE-NOPE-NOPE/api/bundle",
      headers: { host: B_HOST },
    });
    expect(unknownOnA.statusCode).toBe(404);
    expect(unknownOnB.statusCode).toBe(404);
    expect(unknownOnA.body).toBe(unknownOnB.body);

    const slugOnA = await server.inject({
      method: "GET",
      url: "/d/no-such-document/api/bundle",
      headers: { host: A_HOST },
    });
    const slugOnB = await server.inject({
      method: "GET",
      url: "/d/no-such-document/api/bundle",
      headers: { host: B_HOST },
    });
    expect(slugOnA.statusCode).toBe(404);
    expect(slugOnB.body).toBe(slugOnA.body);

    await server.close();
  });

  it("carries the document's site on the participant and public bundles", async () => {
    const { server } = await twoTenants();
    await server.inject({
      method: "PATCH",
      url: "/admin/api/sites/site-a",
      headers: adminHeaders(),
      payload: { accent: "#0f62fe", logo_url: "https://a.test/logo.svg" },
    });
    await seedParticipant(server, {
      document: "a-letter",
      person: "jane-doe",
      token: "TOKENA1111111111",
    });

    const bundle = await server.inject({
      method: "GET",
      url: "/i/TOKENA1111111111/api/bundle",
      headers: { host: A_HOST },
    });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.json().site).toEqual({
      name: "Site A",
      logo_url: "https://a.test/logo.svg",
      accent: "#0f62fe",
    });

    const publicBundle = await server.inject({
      method: "GET",
      url: "/d/a-letter/api/bundle",
      headers: { host: A_HOST },
    });
    expect(publicBundle.json().site.name).toBe("Site A");

    await server.close();
  });

  it("leaves a document that names no site on the default site, unchanged", async () => {
    const { server } = await twoTenants();
    await seedDocument(server, { slug: "house-statement", public_access: "read" });
    await seedParticipant(server, {
      document: "house-statement",
      person: "jane-doe",
      token: "TOKEND2222222222",
    });

    // Reached on the deployment's own host: no redirect, and the default
    // site's identity (the instance name) is what the bundle carries.
    const bundle = await server.inject({
      method: "GET",
      url: "/i/TOKEND2222222222/api/bundle",
      headers: { host: DEFAULT_HOST },
    });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.json().site).toEqual({
      name: "Community Drafter",
      logo_url: undefined,
      accent: undefined,
    });

    // Reached on a customer host: redirected to the deployment's own.
    const fromA = await server.inject({
      method: "GET",
      url: "/d/house-statement",
      headers: { host: A_HOST },
    });
    expect(fromA.statusCode).toBe(302);
    expect(fromA.headers.location).toBe(`https://${DEFAULT_HOST}/d/house-statement`);

    await server.close();
  });
});

describe("tenancy: one site cannot see another", () => {
  it("scopes the document list and the operators directory to the resolved site", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");
    const bob = await bearerFor("bob@b.test", "site-b", "Bob");

    const annDocs = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { ...ann, host: A_HOST },
    });
    expect(annDocs.json().map((d: { slug: string }) => d.slug)).toEqual(["a-letter"]);

    const bobDocs = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { ...bob, host: B_HOST },
    });
    expect(bobDocs.json().map((d: { slug: string }) => d.slug)).toEqual(["b-note"]);

    // The other tenant's document is 404, the same body as an unknown slug.
    const crossRead = await server.inject({
      method: "GET",
      url: "/admin/api/documents/a-letter",
      headers: { ...bob, host: B_HOST },
    });
    const unknown = await server.inject({
      method: "GET",
      url: "/admin/api/documents/not-a-document",
      headers: { ...bob, host: B_HOST },
    });
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.json().error).toBe(unknown.json().error);

    const annOperators = await server.inject({
      method: "GET",
      url: "/admin/api/operators",
      headers: { ...ann, host: A_HOST },
    });
    const annEmails = annOperators.json().map((o: { email: string }) => o.email);
    expect(annEmails).toContain("ann@a.test");
    expect(annEmails).not.toContain("bob@b.test");

    // A superadmin on the deployment's own host still sees every document,
    // each carrying its site.
    const all = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
    });
    const sites = all.json().map((d: { slug: string; site: string }) => [d.slug, d.site]);
    expect(sites).toContainEqual(["a-letter", "site-a"]);
    expect(sites).toContainEqual(["b-note", "site-b"]);

    await server.close();
  });

  it("404s an operator outside the resolved site's group and refuses a cross-site document operator", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");

    const patch = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/bob@b.test",
      headers: { ...ann, host: A_HOST },
      payload: { name: "Not Bob" },
    });
    expect(patch.statusCode).toBe(404);

    const added = await server.inject({
      method: "POST",
      url: "/admin/api/documents/a-letter/operators",
      headers: { ...ann, host: A_HOST },
      payload: { email: "bob@b.test" },
    });
    expect(added.statusCode).toBe(422);
    expect(added.json().message).toContain("site-a");

    await server.close();
  });

  it("refuses to delete an operator record without a superadmin", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");
    await seedOperator(server, { email: "extra@a.test", name: "Extra" });
    await server.inject({
      method: "POST",
      url: "/admin/api/sites/site-a/operators",
      headers: { ...ann, host: A_HOST },
      payload: { email: "extra@a.test" },
    });

    const refused = await server.inject({
      method: "DELETE",
      url: "/admin/api/operators/extra@a.test",
      headers: { ...ann, host: A_HOST },
    });
    expect(refused.statusCode).toBe(403);

    // Removing them from the site is not deleting them: the record and any
    // other membership survive.
    const removed = await server.inject({
      method: "DELETE",
      url: "/admin/api/sites/site-a/operators/extra@a.test",
      headers: { ...ann, host: A_HOST },
    });
    expect(removed.statusCode).toBe(200);
    expect(server.storage.readModel.getOperatorByEmail("extra@a.test")).toBeTruthy();

    await server.close();
  });

  it("rejects a credential minted on another site's host", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");

    const wrongHost = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { ...ann, host: B_HOST },
    });
    expect(wrongHost.statusCode).toBe(401);
    expect(wrongHost.json().error).toBe("unauthenticated");

    await server.close();
  });
});

describe("mail is the document's site's", () => {
  it("sends From the site's verified sender, with the document's own values winning", async () => {
    const mailer = new FakeMailer();
    const { server } = await twoTenants({ mailer });
    await server.inject({
      method: "PATCH",
      url: "/admin/api/sites/site-a",
      headers: adminHeaders(),
      payload: { sender_email: "letters@a.test", sender_name: "The A Team" },
    });
    await seedParticipant(server, {
      document: "a-letter",
      person: "jane-doe",
      token: "TOKENA3333333333",
      email: "jane@example.org",
    });

    // An admin action taken on the *default* host still mails the document's
    // own site's identity and links.
    const sent = await server.inject({
      method: "POST",
      url: "/admin/api/documents/a-letter/invitations/send",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: {},
    });
    expect(sent.statusCode).toBe(200);

    const message = mailer.sent.at(-1)!;
    expect(message.from).toEqual({ name: "The A Team", email: "letters@a.test" });
    expect(message.replyTo).toBe("a-team@a.test");
    expect(message.tag).toBe("site-a");
    expect(message.personalLink).toBe(`https://${A_HOST}/i/TOKENA3333333333`);
    expect(message.text).toContain(`https://${A_HOST}/i/TOKENA3333333333`);

    await server.close();
  });

  it("falls back to the platform address under the site's name, and never substitutes one for the other", async () => {
    const mailer = new FakeMailer();
    const { server } = await twoTenants({ mailer });
    await seedParticipant(server, {
      document: "b-note",
      person: "sam-p",
      token: "TOKENB4444444444",
      email: "sam@example.org",
    });

    // Site B declared no sender: the platform's verified address, under the
    // site's name.
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/b-note/invitations/send",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: {},
    });
    expect(mailer.sent.at(-1)!.from).toEqual({ name: "Site B", email: "platform@example.org" });

    // Now it declares one the provider will not accept: every recipient
    // fails by name, nothing is marked sent, and no message goes out from
    // the platform address instead.
    mailer.rejectFrom("notes@b.test");
    await server.inject({
      method: "PATCH",
      url: "/admin/api/sites/site-b",
      headers: adminHeaders(),
      payload: { sender_email: "notes@b.test" },
    });
    await seedParticipant(server, {
      document: "b-note",
      person: "kim-r",
      token: "TOKENB5555555555",
      email: "kim@example.org",
    });

    const before = mailer.sent.length;
    const send = await server.inject({
      method: "POST",
      url: "/admin/api/documents/b-note/invitations/send",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: {},
    });
    expect(send.json().sent).toBe(0);
    expect(send.json().failed).toBe(1);
    expect(send.json().failures[0].person).toBe("kim-r");
    expect(mailer.sent.length).toBe(before);
    expect(
      server.storage.readModel.getParticipation("b-note", "kim-r")?.record.sent_at,
    ).toBeUndefined();

    await server.close();
  });

  it("mints a document's personal links on its own site, wherever the export was run", async () => {
    const { server } = await twoTenants();
    await seedParticipant(server, {
      document: "a-letter",
      person: "jane-doe",
      token: "TOKENA6666666666",
    });

    const links = await server.inject({
      method: "POST",
      url: "/admin/api/documents/a-letter/invitations/links",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: {},
    });
    expect(links.statusCode).toBe(200);
    expect(links.body).toContain(`https://${A_HOST}/i/TOKENA6666666666`);

    await server.close();
  });
});

describe("the /sites endpoints", () => {
  it("is superadmin-only for the site itself, and open to the group for its operators", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");

    const refused = await server.inject({
      method: "POST",
      url: "/admin/api/sites",
      headers: { ...ann, host: A_HOST },
      payload: {
        slug: "sneaky",
        hostname: "sneaky.test",
        name: "Sneaky",
        reply_to: "x@a.test",
      },
    });
    expect(refused.statusCode).toBe(403);

    await seedOperator(server, { email: "newbie@a.test", name: "Newbie" });
    const joined = await server.inject({
      method: "POST",
      url: "/admin/api/sites/site-a/operators",
      headers: { ...ann, host: A_HOST },
      payload: { email: "newbie@a.test" },
    });
    expect(joined.statusCode).toBe(200);
    expect(server.storage.readModel.getSite("site-a")?.operators).toContain("newbie@a.test");

    // And the other tenant's site is invisible, not merely unwritable.
    const cross = await server.inject({
      method: "GET",
      url: "/admin/api/sites/site-b",
      headers: { ...ann, host: A_HOST },
    });
    expect(cross.statusCode).toBe(404);

    await server.close();
  });

  it("refuses a hostname another site already claims", async () => {
    const { server } = await twoTenants();

    const taken = await server.inject({
      method: "POST",
      url: "/admin/api/sites",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: { slug: "copycat", hostname: A_HOST, name: "Copycat", reply_to: "x@a.test" },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe("hostname_taken");

    const own = await server.inject({
      method: "POST",
      url: "/admin/api/sites",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: { slug: "shadow", hostname: DEFAULT_HOST, name: "Shadow", reply_to: "x@a.test" },
    });
    expect(own.json().error).toBe("hostname_taken");

    await server.close();
  });

  it("refuses to delete a site any document still names, and to empty an operator group", async () => {
    const { server } = await twoTenants();

    const inUse = await server.inject({
      method: "DELETE",
      url: "/admin/api/sites/site-a",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
    });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error).toBe("site_in_use");
    expect(inUse.json().details.documents).toEqual(["a-letter"]);

    const lastOperator = await server.inject({
      method: "DELETE",
      url: "/admin/api/sites/site-a/operators/ann@a.test",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
    });
    expect(lastOperator.statusCode).toBe(409);
    expect(lastOperator.json().error).toBe("last_operator");

    await server.close();
  });

  it("prints the DNS a new site still needs, and says the record routes nothing", async () => {
    const { server } = await twoTenants();

    const created = await server.inject({
      method: "POST",
      url: "/admin/api/sites",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: {
        slug: "third",
        hostname: "third.example.test",
        name: "Third",
        reply_to: "team@third.test",
        sender_email: "letters@third.test",
      },
    });
    expect(created.statusCode).toBe(201);
    const dns = created.json().dns as Array<{ type: string; name: string; value: string }>;
    expect(dns[0]).toMatchObject({
      type: "CNAME",
      name: "third.example.test",
      value: "sites.signatories.org",
    });
    expect(dns.filter((r) => r.name.includes("third.test")).length).toBe(2);
    // A hostname nothing has ever arrived on is reported unverified, not live.
    expect(created.json().hostname_verified).toBe(false);
    expect(created.json().sender_verified).toBeNull();

    await server.close();
  });

  it("creates a document on the caller's site and moves it only to a site they operate", async () => {
    const { server } = await twoTenants();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");

    const created = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { ...ann, host: A_HOST },
      payload: { slug: "a-second", title: "A second", audience: "public" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().site).toBe("site-a");
    expect(created.json().site_url).toBe(`https://${A_HOST}`);

    const moved = await server.inject({
      method: "PATCH",
      url: "/admin/api/documents/a-second",
      headers: { ...ann, host: A_HOST },
      payload: { site: "site-b" },
    });
    expect(moved.statusCode).toBe(404);

    // A superadmin on the default host may move it, and the slug, tokens
    // and history are untouched — only the hostname changes.
    const byAdmin = await server.inject({
      method: "PATCH",
      url: "/admin/api/documents/a-second",
      headers: { ...adminHeaders(), host: DEFAULT_HOST },
      payload: { site: "site-b" },
    });
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json().site).toBe("site-b");
    expect(byAdmin.json().site_url).toBe(`https://${B_HOST}`);

    await server.close();
  });
});

describe("auth is per host", () => {
  it("emails a magic link only to an operator of the resolved site, on that site's host", async () => {
    const mailer = new FakeMailer();
    const { server } = await twoTenants({ mailer });

    const other = await server.inject({
      method: "POST",
      url: "/auth/login",
      headers: { host: A_HOST },
      payload: { email: "bob@b.test" },
    });
    expect(other.statusCode).toBe(202);
    expect(mailer.sent.length).toBe(0);

    const own = await server.inject({
      method: "POST",
      url: "/auth/login",
      headers: { host: A_HOST },
      payload: { email: "ann@a.test" },
    });
    expect(own.statusCode).toBe(202);
    const message = mailer.sent.at(-1)!;
    expect(message.subject).toBe("Sign in to Site A");
    expect(message.personalLink).toContain(`https://${A_HOST}/auth/callback?code=`);

    await server.close();
  });

  it("returns the resolved site on the session", async () => {
    const { server } = await twoTenants();

    const onA = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { ...(await bearerFor(TEST_ACTOR.email, "site-a", "Team")), host: A_HOST },
    });
    expect(onA.json().site).toMatchObject({
      slug: "site-a",
      name: "Site A",
      hostname: A_HOST,
    });

    await server.close();
  });
});
