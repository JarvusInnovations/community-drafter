import {
  bool,
  csv,
  list,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
  type FlagSpec,
} from "../flags.js";
import { resolveConfig } from "../config.js";
import { compact, computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type {
  DocOperatorAddResult,
  DocumentDetail,
  DocumentSummary,
  OpenResult,
  OperatorRecord,
} from "../types.js";
import { AxiError } from "axi-sdk-js";

import { parseDeadline } from "../deadline.js";
import { clientFrom, render } from "./common.js";

const DOCS_FLAGS: Record<string, FlagSpec> = {
  create: {
    positionals: 1,
    value: [
      "--site",
      "--title",
      "--sender-name",
      "--reply-to",
      "--capacities",
      "--audience",
      "--public",
      "--show-signatories",
      "--revocation-window-hours",
      "--tags",
    ],
    multi: ["--addressed-to"],
    deprecated: {
      "--list-visible-to":
        "--list-visible-to is now --addressed-to: who the statement goes to, repeatable once per recipient",
    },
  },
  show: { positionals: 1 },
  update: {
    positionals: 1,
    value: ["--audience", "--site"],
    multi: ["--addressed-to"],
  },
  open: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  extend: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  close: { positionals: 1 },
  reopen: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  withdraw: { positionals: 1, value: ["--reason"], boolean: ["--public"] },
  operators: { positionals: 3 },
};

export const DOCS_HELP = `usage: drafter-axi docs <create|show|update|open|extend|close|reopen|withdraw|operators> ...

create <slug> --title <text> --audience public|closed
       [--site <slug>] [--sender-name <text>] [--reply-to <email>]
       [--addressed-to "<name>"]... [--capacities personal,official]
       [--show-signatories list|count|none]
       [--revocation-window-hours <n>] [--tags a,b]
       (the caller becomes the document's first operator)

--audience is required and says who the FINISHED statement is for:
  public  it will be published for anyone to read
  closed  it is delivered to the people and bodies it is addressed to
--addressed-to names one of those recipients; repeat it once per recipient. It
is required with --audience closed, and allowed with --audience public. It is a
disclosure, not a permission: every signer is shown those names before they
sign.

--audience is not --public. --public sets public_access, which is whether
anyone with the link may read the WORKING draft; the two are independent, so a
letter to a named body can be drafted in the open and a public statement can be
drafted invitee-only.
show <slug>
update <slug> [--audience public|closed] [--addressed-to "<name>"]... [--site <slug>]
       (settings only; --addressed-to replaces the recipients)

--site names the site the document belongs to — the hostname every personal
link, public link and message for it is built on. It defaults to the site
this profile is signed in to, and \`update --site\` moves the document to
another site you operate: the slug, tokens and history do not change, the
hostname its participants are sent to does. --sender-name and --reply-to may
be omitted, in which case the site's own are used.
open <slug> --comments-close <when> --signing-closes <when>
extend <slug> [--comments-close <when>] [--signing-closes <when>]
close <slug>
reopen <slug> [--comments-close <when>] --signing-closes <when>

<when> is ISO 8601 with a zone (2026-10-01T21:00:00Z, 2026-10-01T17:00:00-04:00) or a
zone-less time read in this machine's local zone (2026-10-01T17:00); the CLI prints
what it resolved to.
withdraw <slug> --reason <text> [--public]
operators <slug>
operators add <slug> <email>
operators remove <slug> <email>

Every mutation prints the document's key fields and the commit subject, plus
the site and the canonical host its links are built on. When the document's
--public is not none, create/show/open also print public_url — the
https://<site hostname>/d/<slug> address anyone with the link can read.`;

/**
 * `specs/api/admin-cli.md` § Output rules: a document whose `public_access`
 * is not `none` prints the address anyone with the link can read, so it
 * never has to be assembled by hand. The host is the **document's site**
 * (`specs/behaviors/sites.md`), which is the address its participants are
 * actually sent — not the instance URL this profile happens to be signed in
 * to. `none` prints no such field.
 */
function publicUrl(doc: DocumentSummary, instanceUrl: string): string | undefined {
  if (!doc.public_access || doc.public_access === "none") return undefined;
  return `${canonicalHost(doc, instanceUrl)}/d/${doc.slug}`;
}

/** The origin this document's personal and public links are built on. */
function canonicalHost(doc: DocumentSummary, instanceUrl: string): string {
  return doc.site_url || instanceUrl;
}

function detailObject(doc: DocumentSummary, instanceUrl: string): Record<string, unknown> {
  return compact({
    slug: doc.slug,
    title: doc.title,
    state: doc.state,
    phase: doc.phase,
    // `specs/api/admin-cli.md` § Output rules: every document view prints
    // its site and the canonical host its links are built on, because an
    // operator handing out a link needs to read the address their
    // participants will actually receive.
    site: doc.site ?? "default",
    site_url: canonicalHost(doc, instanceUrl),
    created_by: doc.created_by,
    operators: doc.operators,
    sender_name: doc.sender_name,
    reply_to: doc.reply_to,
    opened_at: doc.opened_at,
    comments_close_at: doc.comments_close_at,
    signing_closes_at: doc.signing_closes_at,
    capacities: doc.capacities,
    // `specs/api/admin-cli.md` § Output rules: the audience and who the
    // statement is addressed to, as stored, beside `public_access` — who
    // the statement goes to and who may read the draft are two different
    // answers, and an operator should see both at once.
    public_access: doc.public_access,
    audience: doc.audience,
    addressed_to: doc.addressed_to?.length ? doc.addressed_to : undefined,
    public_url: publicUrl(doc, instanceUrl),
    show_signatories: doc.show_signatories,
    tags: doc.tags,
    commit: doc.commit,
    counts: doc.counts,
  });
}

export async function docsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("docs", args, DOCS_FLAGS);
  const client = clientFrom(parsed);
  // `specs/api/admin-cli.md` § Output rules: emitted commands always read
  // `drafter-axi …`; the home view's `invoke_as` is the one place the
  // resolved shim path is printed.
  const cli = "drafter-axi";
  const instanceUrl = resolveConfig({ profile: str(parsed, "--profile") }).url;

  switch (sub) {
    case "create": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi docs create <slug> --title "..." --sender-name "..." --reply-to <email>',
      );
      const capacities = csv(str(parsed, "--capacities"));
      const tags = csv(str(parsed, "--tags"));
      const body = {
        slug,
        title: requireStr(parsed, "--title", 'drafter-axi docs create <slug> --title "..." ...'),
        // `specs/behaviors/sites.md`: the document is created on the site
        // this profile is signed in to unless it names another the caller
        // operates; the site supplies the sender the document omits.
        site: str(parsed, "--site"),
        sender_name: str(parsed, "--sender-name"),
        reply_to: str(parsed, "--reply-to"),
        capacities: capacities.length > 0 ? capacities : undefined,
        // `specs/data-model.md` § Audience: `--audience` is required and is
        // stored as given. `--public` is the separate drafting-time read
        // setting and is never written from it.
        audience: requireStr(
          parsed,
          "--audience",
          "drafter-axi docs create <slug> --audience public|closed ...",
        ),
        addressed_to: list(parsed, "--addressed-to"),
        public_access: str(parsed, "--public"),
        show_signatories: str(parsed, "--show-signatories"),
        revocation_window_hours: str(parsed, "--revocation-window-hours")
          ? Number(str(parsed, "--revocation-window-hours"))
          : undefined,
        tags: tags.length > 0 ? tags : undefined,
      };
      const doc = await client.post<DocumentSummary>("/documents", body);
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          renderHelp([
            `Run \`${cli} versions publish ${slug} --file <path> --summary "..."\` to publish a first version`,
          ]),
        ),
      );
    }

    case "show": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi docs show <slug>");
      const doc = await client.get<DocumentDetail>(`/documents/${encodeURIComponent(slug)}`);
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          doc.versions.length === 0
            ? renderObject({ versions: "no published versions yet" })
            : renderList("versions", doc.versions, [
                computed("number", (v) => v.number),
                computed("summary", (v) => v.summary),
                computed("published_at", (v) => v.published_at),
                computed("final", (v) => v.final),
                computed("dispositions", (v) => v.dispositions),
              ]),
          renderHelp([
            doc.versions.length === 0
              ? `Run \`${cli} versions publish ${slug} --file <path> --summary "..."\` to publish a first version`
              : `Run \`${cli} people list ${slug}\` for participation status`,
          ]),
        ),
      );
    }

    case "update": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi docs update <slug> [--audience public|closed] [--addressed-to "..."]',
      );
      // `specs/api/admin-cli.md`: settings only, over `PATCH /documents/:slug`.
      // Sending only what was given keeps an omitted flag from clearing a
      // field the operator never mentioned.
      const audience = str(parsed, "--audience");
      const addressedTo = list(parsed, "--addressed-to");
      const site = str(parsed, "--site");
      if (audience === undefined && addressedTo === undefined && site === undefined) {
        throw new AxiError("nothing to update", "USAGE", [
          'Run `drafter-axi docs update <slug> --audience public|closed [--addressed-to "..."] [--site <slug>]`',
        ]);
      }
      const doc = await client.patch<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}`,
        compact({ audience, addressed_to: addressedTo, site }),
      );
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          site === undefined
            ? ""
            : renderHelp([
                `${slug} now belongs to ${doc.site ?? "default"} — from the next message and the next redirect its participants are sent to ${canonicalHost(doc, instanceUrl)}`,
              ]),
        ),
      );
    }

    case "open": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi docs open <slug> --comments-close <when> --signing-closes <when>",
      );
      const openUsage =
        "drafter-axi docs open <slug> --comments-close <when> --signing-closes <when>";
      const comments = parseDeadline(
        requireStr(parsed, "--comments-close", openUsage),
        "--comments-close",
        openUsage,
      );
      const signing = parseDeadline(
        requireStr(parsed, "--signing-closes", openUsage),
        "--signing-closes",
        openUsage,
      );
      const doc = await client.post<OpenResult>(`/documents/${encodeURIComponent(slug)}/open`, {
        comments_close_at: comments.iso,
        signing_closes_at: signing.iso,
      });
      // `specs/api/admin-cli.md`: opening prints how many invitations were
      // delivered and names any the mailer rejected — those invitees are
      // still `not_sent`, so `people send` will reach them.
      const invitations = doc.invitations;
      const openFailures = invitations?.failures ?? [];
      type OpenFailure = (typeof openFailures)[number];
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          invitations
            ? renderObject({
                invitations_sent: invitations.sent,
                invitations_failed: invitations.failed,
              })
            : "",
          openFailures.length > 0
            ? renderList("invitation_failures", openFailures, [
                computed<OpenFailure>("person", (f) => f.person),
                computed<OpenFailure>("error", (f) => f.error),
              ])
            : "",
          renderHelp([
            comments.note,
            signing.note,
            openFailures.length > 0
              ? `${openFailures.length} invitation(s) were not delivered and are still not_sent — fix the address, then run \`${cli} people send ${slug}\``
              : `Run \`${cli} people send ${slug}\` if invitees were imported after opening`,
          ]),
        ),
      );
    }

    case "extend": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi docs extend <slug> [--comments-close <when>] [--signing-closes <when>]",
      );
      const extendUsage =
        "drafter-axi docs extend <slug> [--comments-close <when>] [--signing-closes <when>]";
      const rawComments = str(parsed, "--comments-close");
      const rawSigning = str(parsed, "--signing-closes");
      const comments = rawComments
        ? parseDeadline(rawComments, "--comments-close", extendUsage)
        : undefined;
      const signing = rawSigning
        ? parseDeadline(rawSigning, "--signing-closes", extendUsage)
        : undefined;
      const body = compact({
        comments_close_at: comments?.iso,
        signing_closes_at: signing?.iso,
      });
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/schedule`,
        body,
      );
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          renderHelp([comments?.note, signing?.note].filter((n): n is string => Boolean(n))),
        ),
      );
    }

    case "close": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi docs close <slug>");
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/close`,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc, instanceUrl)));
    }

    case "reopen": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi docs reopen <slug> [--comments-close <when>] --signing-closes <when>",
      );
      const reopenUsage =
        "drafter-axi docs reopen <slug> [--comments-close <when>] --signing-closes <when>";
      const rawComments = str(parsed, "--comments-close");
      const comments = rawComments
        ? parseDeadline(rawComments, "--comments-close", reopenUsage)
        : undefined;
      const signing = parseDeadline(
        requireStr(parsed, "--signing-closes", reopenUsage),
        "--signing-closes",
        reopenUsage,
      );
      const body = compact({ comments_close_at: comments?.iso, signing_closes_at: signing.iso });
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/reopen`,
        body,
      );
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          renderHelp([comments?.note, signing.note].filter((n): n is string => Boolean(n))),
        ),
      );
    }

    case "withdraw": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi docs withdraw <slug> --reason "..." [--public]',
      );
      const body = {
        reason: requireStr(
          parsed,
          "--reason",
          'drafter-axi docs withdraw <slug> --reason "..." [--public]',
        ),
        public: bool(parsed, "--public"),
      };
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/withdraw`,
        body,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc, instanceUrl)));
    }

    case "operators": {
      const first = parsed.positional[0];
      if (first === "add" || first === "remove") {
        const slug = requirePositional(
          parsed,
          1,
          "slug",
          `drafter-axi docs operators ${first} <slug> <email>`,
        );
        const email = requirePositional(
          parsed,
          2,
          "email",
          `drafter-axi docs operators ${first} <slug> <email>`,
        );
        if (first === "add") {
          const result = await client.post<DocOperatorAddResult>(
            `/documents/${encodeURIComponent(slug)}/operators`,
            { email },
          );
          return render(parsed, result, () => renderObject(compact(result)));
        }
        const result = await client.delete<{
          ok: boolean;
          removed: boolean;
          commit?: string | null;
        }>(`/documents/${encodeURIComponent(slug)}/operators/${encodeURIComponent(email)}`);
        return render(parsed, result, () => renderObject(result));
      }

      const slug = requirePositional(parsed, 0, "slug", "drafter-axi docs operators <slug>");
      const operators = await client.get<OperatorRecord[]>(
        `/documents/${encodeURIComponent(slug)}/operators`,
      );
      return render(parsed, operators, () =>
        operators.length === 0
          ? renderObject({ operators: "no operators found" })
          : renderList("operators", operators, [
              computed("email", (o) => o.email),
              computed("name", (o) => o.name),
              computed("kind", (o) => o.kind),
              computed("active", (o) => o.active),
            ]),
      );
    }

    default:
      return sub; // unreachable — parseSubcommand already validated `sub`
  }
}
