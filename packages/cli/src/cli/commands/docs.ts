import {
  bool,
  csv,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
  type FlagSpec,
} from "../flags.js";
import { cliInvocation } from "../invocation.js";
import { compact, computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { DocumentDetail, DocumentSummary } from "../types.js";
import { clientFrom, render } from "./common.js";

const DOCS_FLAGS: Record<string, FlagSpec> = {
  create: {
    positionals: 1,
    value: [
      "--title",
      "--owner",
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
};

export const DOCS_HELP = `usage: drafter-axi docs <create|show|open|extend|close|reopen|withdraw> ...

create <slug> --title <text> --owner <email> --sender-name <text> --reply-to <email>
       [--capacities personal,official] [--public none|read|participate]
       [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]
show <slug>
open <slug> --comments-close <iso> --signing-closes <iso>
extend <slug> [--comments-close <iso>] [--signing-closes <iso>]
close <slug>
reopen <slug> [--comments-close <iso>] --signing-closes <iso>
withdraw <slug> --reason <text> [--public]

Every mutation prints the document's key fields and the commit subject.`;

function detailObject(doc: DocumentSummary): Record<string, unknown> {
  return compact({
    slug: doc.slug,
    title: doc.title,
    state: doc.state,
    phase: doc.phase,
    owner: doc.owner,
    sender_name: doc.sender_name,
    reply_to: doc.reply_to,
    opened_at: doc.opened_at,
    comments_close_at: doc.comments_close_at,
    signing_closes_at: doc.signing_closes_at,
    capacities: doc.capacities,
    public_access: doc.public_access,
    show_signatories: doc.show_signatories,
    tags: doc.tags,
    commit: doc.commit,
    counts: doc.counts,
  });
}

export async function docsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("docs", args, DOCS_FLAGS);
  const client = clientFrom(parsed);
  const cli = cliInvocation();

  switch (sub) {
    case "create": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi docs create <slug> --title "..." --owner <email> --sender-name "..." --reply-to <email>',
      );
      const capacities = csv(str(parsed, "--capacities"));
      const tags = csv(str(parsed, "--tags"));
      const body = {
        slug,
        title: requireStr(parsed, "--title", 'drafter-axi docs create <slug> --title "..." ...'),
        owner: requireStr(parsed, "--owner", "drafter-axi docs create <slug> --owner <email> ..."),
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
          renderObject(detailObject(doc)),
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
          renderObject(detailObject(doc)),
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
        "drafter-axi docs open <slug> --comments-close <iso> --signing-closes <iso>",
      );
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/open`,
        {
          comments_close_at: requireStr(
            parsed,
            "--comments-close",
            "drafter-axi docs open <slug> --comments-close <iso> --signing-closes <iso>",
          ),
          signing_closes_at: requireStr(
            parsed,
            "--signing-closes",
            "drafter-axi docs open <slug> --comments-close <iso> --signing-closes <iso>",
          ),
        },
      );
      return render(parsed, doc, () =>
        joinBlocks(
          renderObject(detailObject(doc)),
          renderHelp([
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
        "drafter-axi docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]",
      );
      const body = compact({
        comments_close_at: str(parsed, "--comments-close"),
        signing_closes_at: str(parsed, "--signing-closes"),
      });
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/schedule`,
        body,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc)));
    }

    case "close": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi docs close <slug>");
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/close`,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc)));
    }

    case "reopen": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>",
      );
      const body = compact({
        comments_close_at: str(parsed, "--comments-close"),
        signing_closes_at: requireStr(
          parsed,
          "--signing-closes",
          "drafter-axi docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>",
        ),
      });
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/reopen`,
        body,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc)));
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
      return render(parsed, doc, () => renderObject(detailObject(doc)));
    }

    default:
      return sub; // unreachable — parseSubcommand already validated `sub`
  }
}
