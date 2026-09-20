import {
  bool,
  csv,
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
  OperatorRecord,
} from "../types.js";
import { parseDeadline } from "../deadline.js";
import { clientFrom, render } from "./common.js";

const DOCS_FLAGS: Record<string, FlagSpec> = {
  create: {
    positionals: 1,
    value: [
      "--title",
      "--sender-name",
      "--reply-to",
      "--capacities",
      "--public",
      "--show-signatories",
      "--revocation-window-hours",
      "--tags",
    ],
  },
  show: { positionals: 1 },
  open: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  extend: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  close: { positionals: 1 },
  reopen: { positionals: 1, value: ["--comments-close", "--signing-closes"] },
  withdraw: { positionals: 1, value: ["--reason"], boolean: ["--public"] },
  operators: { positionals: 3 },
};

export const DOCS_HELP = `usage: drafter-axi docs <create|show|open|extend|close|reopen|withdraw|operators> ...

create <slug> --title <text> --sender-name <text> --reply-to <email>
       [--capacities personal,official] [--public none|read|participate]
       [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]
       (the caller becomes the document's first operator)
show <slug>
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

Every mutation prints the document's key fields and the commit subject. When the
document's --public is not none, create/show/open also print public_url — the
<instance>/d/<slug> address anyone with the link can read.`;

/**
 * `specs/api/admin-cli.md` § Output rules: a document whose `public_access`
 * is not `none` prints the address anyone with the link can read, so it
 * never has to be assembled by hand from the instance URL and the slug.
 * `none` prints no such field. The instance URL comes from the resolved
 * profile, already stripped of a trailing slash.
 */
function publicUrl(doc: DocumentSummary, instanceUrl: string): string | undefined {
  if (!doc.public_access || doc.public_access === "none") return undefined;
  return `${instanceUrl}/d/${doc.slug}`;
}

function detailObject(doc: DocumentSummary, instanceUrl: string): Record<string, unknown> {
  return compact({
    slug: doc.slug,
    title: doc.title,
    state: doc.state,
    phase: doc.phase,
    created_by: doc.created_by,
    operators: doc.operators,
    sender_name: doc.sender_name,
    reply_to: doc.reply_to,
    opened_at: doc.opened_at,
    comments_close_at: doc.comments_close_at,
    signing_closes_at: doc.signing_closes_at,
    capacities: doc.capacities,
    public_access: doc.public_access,
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
        sender_name: requireStr(
          parsed,
          "--sender-name",
          'drafter-axi docs create <slug> --sender-name "..." ...',
        ),
        reply_to: requireStr(
          parsed,
          "--reply-to",
          "drafter-axi docs create <slug> --reply-to <email> ...",
        ),
        capacities: capacities.length > 0 ? capacities : undefined,
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
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/open`,
        { comments_close_at: comments.iso, signing_closes_at: signing.iso },
      );
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc, instanceUrl)),
          renderHelp([
            comments.note,
            signing.note,
            `Run \`${cli} people send ${slug}\` if invitees were imported before opening`,
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
