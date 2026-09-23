import { writeFileSync } from "node:fs";

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
  ConfirmCallDryRun,
  ConfirmCallResult,
  DeliveredResult,
  DocOperatorAddResult,
  DocumentDetail,
  DocumentSummary,
  OpenResult,
  OperatorRecord,
  ScheduleDryRun,
  ScheduleResult,
} from "../types.js";
import type { SignatoriesClient } from "../client.js";
import type { Parsed } from "../flags.js";
import { AxiError } from "axi-sdk-js";

import { parseDeadline } from "../deadline.js";
import { announceLine, clientFrom, render } from "./common.js";

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
  extend: {
    positionals: 1,
    value: ["--comments-close", "--signing-closes"],
    boolean: ["--notify", "--dry-run"],
  },
  close: { positionals: 1 },
  reopen: {
    positionals: 1,
    value: ["--comments-close", "--signing-closes"],
    boolean: ["--notify", "--dry-run"],
  },
  "confirm-call": { positionals: 1, value: ["--by"], boolean: ["--dry-run"] },
  delivered: { positionals: 1, value: ["--note"], boolean: ["--dry-run"] },
  withdraw: { positionals: 1, value: ["--reason"], boolean: ["--public"] },
  operators: { positionals: 3 },
  export: { positionals: 1, value: ["--out", "--paper"], boolean: ["--pdf", "--draft"] },
};

export const DOCS_HELP = `usage: signatories-axi docs <create|show|update|open|extend|close|reopen|confirm-call|delivered|withdraw|export|operators> ...

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
extend <slug> [--comments-close <when>] [--signing-closes <when>] [--notify] [--dry-run]
close <slug>
reopen <slug> [--comments-close <when>] --signing-closes <when> [--notify] [--dry-run]

Moving a deadline tells NOBODY unless you pass --notify, which sends "more time"
to the people who opened the document and have not signed or declined. Either
way the output says how many that is; --dry-run checks the change and prints the
count without writing or sending anything. Closing sends nothing.

confirm-call <slug> [--by <when>] [--dry-run]
       Ask every signer whose signature is behind the current version, and
       every conditional signer, to keep their name on the current text or
       remove it by --by (default: when signing closes). Once per person per
       call; nobody qualifying sends nothing and says so. --dry-run lists who
       would be asked and why. Run it before delivering.
delivered <slug> [--note "<text>"] [--dry-run]
       Record that the statement was delivered and tell every current signer
       where it went and when, with the note. Once per document; the PDF goes
       clean from that moment. --dry-run prints how many signers would be told.

<when> is ISO 8601 with a zone (2026-10-01T21:00:00Z, 2026-10-01T17:00:00-04:00) or a
zone-less time read in this machine's local zone (2026-10-01T17:00); the CLI prints
what it resolved to.
withdraw <slug> --reason <text> [--public]
export <slug> --pdf [--out <file>] [--paper letter|a4]
       [--citations links|footnotes|hybrid] [--draft]
       The deliverable: the current version's text with a title block naming
       who it is addressed to, then the signatory list as it stands. --pdf
       names the format and is the only one today, so it may be omitted.

       Without --out the file is <slug>-v<n>.pdf in the working directory, or
       <slug>-v<n>-draft.pdf while the copy is still a draft. A copy is a
       draft — watermarked DRAFT, with the version number — until signing
       closes or the document is delivered, whichever first. --draft forces
       the watermark back on; there is deliberately no flag the other way.

       --citations picks how the citation links in the text are presented.
       hybrid (the default) keeps every link clickable AND numbers it, with
       a Sources list at the end — one file that works on a screen and on
       paper. footnotes drops the links and keeps the numbers; links is the
       plain form, with no numbers and no Sources list.

       The signatory list is computed at the moment of the render and is
       never frozen, so a name revoked after closing is simply not in the
       next copy. For the counts themselves, run \`signatures list <slug>\`.
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
    delivered_at: doc.delivered_at,
    delivered_note: doc.delivered_note,
    commit: doc.commit,
    counts: doc.counts,
  });
}

export async function docsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("docs", args, DOCS_FLAGS);
  const client = clientFrom(parsed);
  // `specs/api/admin-cli.md` § Output rules: emitted commands always read
  // `signatories-axi …`; the home view's `invoke_as` is the one place the
  // resolved shim path is printed.
  const cli = "signatories-axi";
  const instanceUrl = resolveConfig({ profile: str(parsed, "--profile") }).url;

  switch (sub) {
    case "create": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'signatories-axi docs create <slug> --title "..." --sender-name "..." --reply-to <email>',
      );
      const capacities = csv(str(parsed, "--capacities"));
      const tags = csv(str(parsed, "--tags"));
      const body = {
        slug,
        title: requireStr(
          parsed,
          "--title",
          'signatories-axi docs create <slug> --title "..." ...',
        ),
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
          "signatories-axi docs create <slug> --audience public|closed ...",
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
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi docs show <slug>");
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
        'signatories-axi docs update <slug> [--audience public|closed] [--addressed-to "..."]',
      );
      // `specs/api/admin-cli.md`: settings only, over `PATCH /documents/:slug`.
      // Sending only what was given keeps an omitted flag from clearing a
      // field the operator never mentioned.
      const audience = str(parsed, "--audience");
      const addressedTo = list(parsed, "--addressed-to");
      const site = str(parsed, "--site");
      if (audience === undefined && addressedTo === undefined && site === undefined) {
        throw new AxiError("nothing to update", "USAGE", [
          'Run `signatories-axi docs update <slug> --audience public|closed [--addressed-to "..."] [--site <slug>]`',
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
        "signatories-axi docs open <slug> --comments-close <when> --signing-closes <when>",
      );
      const openUsage =
        "signatories-axi docs open <slug> --comments-close <when> --signing-closes <when>";
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
      const extendUsage =
        "signatories-axi docs extend <slug> [--comments-close <when>] [--signing-closes <when>] [--notify] [--dry-run]";
      const slug = requirePositional(parsed, 0, "slug", extendUsage);
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
        notify: bool(parsed, "--notify") || undefined,
        dry_run: bool(parsed, "--dry-run") || undefined,
      });
      const notes = [comments?.note, signing?.note].filter((n): n is string => Boolean(n));
      return scheduleChange(parsed, client, slug, "schedule", body, notes, instanceUrl);
    }

    case "close": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi docs close <slug>");
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/close`,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc, instanceUrl)));
    }

    case "reopen": {
      const reopenUsage =
        "signatories-axi docs reopen <slug> [--comments-close <when>] --signing-closes <when> [--notify] [--dry-run]";
      const slug = requirePositional(parsed, 0, "slug", reopenUsage);
      const rawComments = str(parsed, "--comments-close");
      const comments = rawComments
        ? parseDeadline(rawComments, "--comments-close", reopenUsage)
        : undefined;
      const signing = parseDeadline(
        requireStr(parsed, "--signing-closes", reopenUsage),
        "--signing-closes",
        reopenUsage,
      );
      const body = compact({
        comments_close_at: comments?.iso,
        signing_closes_at: signing.iso,
        notify: bool(parsed, "--notify") || undefined,
        dry_run: bool(parsed, "--dry-run") || undefined,
      });
      const notes = [comments?.note, signing.note].filter((n): n is string => Boolean(n));
      return scheduleChange(parsed, client, slug, "reopen", body, notes, instanceUrl);
    }

    case "confirm-call": {
      const usage = "signatories-axi docs confirm-call <slug> [--by <when>] [--dry-run]";
      const slug = requirePositional(parsed, 0, "slug", usage);
      const rawBy = str(parsed, "--by");
      const by = rawBy ? parseDeadline(rawBy, "--by", usage) : undefined;
      const path = `/documents/${encodeURIComponent(slug)}/confirm-call`;
      if (bool(parsed, "--dry-run")) {
        const preview = await client.post<ConfirmCallDryRun>(
          path,
          compact({ by: by?.iso, dry_run: true }),
        );
        type Row = ConfirmCallDryRun["would_send"][number];
        return render(parsed, preview, () =>
          joinBlocks(
            renderObject({ dry_run: true, by: preview.by, would_ask: preview.would_send.length }),
            preview.would_send.length > 0
              ? renderList("would_ask", preview.would_send, [
                  computed<Row>("person", (r) => r.person),
                  computed<Row>("name", (r) => r.name),
                  computed<Row>("why", (r) =>
                    r.reason === "conditional"
                      ? "conditional"
                      : `behind v${r.signed_on_version ?? "?"}`,
                  ),
                ])
              : "",
            renderHelp(
              [
                by?.note,
                preview.would_send.length === 0
                  ? "Nobody needs to confirm: every signature is on the current text and unconditional"
                  : `Run \`${cli} docs confirm-call ${slug}${rawBy ? ` --by ${rawBy}` : ""}\` to ask them`,
              ].filter((n): n is string => Boolean(n)),
            ),
          ),
        );
      }
      const result = await client.post<ConfirmCallResult>(path, compact({ by: by?.iso }));
      type Failure = ConfirmCallResult["failures"][number];
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(
            compact({
              by: result.by,
              asked: result.sent,
              failed: result.failed,
              commit: result.commit ?? undefined,
            }),
          ),
          result.failures.length > 0
            ? renderList("failures", result.failures, [
                computed<Failure>("person", (f) => f.person),
                computed<Failure>("error", (f) => f.error),
              ])
            : "",
          renderHelp(
            [
              by?.note,
              result.sent === 0 && result.failed === 0
                ? "Nobody needed to confirm; nothing was sent"
                : `Run \`${cli} signatures list ${slug}\` to see who has kept their name`,
            ].filter((n): n is string => Boolean(n)),
          ),
        ),
      );
    }

    case "delivered": {
      const usage = 'signatories-axi docs delivered <slug> [--note "..."] [--dry-run]';
      const slug = requirePositional(parsed, 0, "slug", usage);
      const path = `/documents/${encodeURIComponent(slug)}/delivered`;
      if (bool(parsed, "--dry-run")) {
        const preview = await client.post<{ dry_run: true; would_send: number }>(path, {
          dry_run: true,
        });
        return render(parsed, preview, () =>
          joinBlocks(
            renderObject({ dry_run: true, would_tell: preview.would_send }),
            renderHelp([
              `Run \`${cli} docs delivered ${slug} --note "..."\` to record the delivery and tell them`,
            ]),
          ),
        );
      }
      const result = await client.post<DeliveredResult>(
        path,
        compact({ note: str(parsed, "--note") }),
      );
      type Failure = DeliveredResult["failures"][number];
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(detailObject(result, instanceUrl)),
          renderObject({ signers_told: result.sent, failed: result.failed }),
          result.failures.length > 0
            ? renderList("failures", result.failures, [
                computed<Failure>("person", (f) => f.person),
                computed<Failure>("error", (f) => f.error),
              ])
            : "",
          renderHelp([`Run \`${cli} docs export ${slug} --pdf\` for the clean copy`]),
        ),
      );
    }

    case "withdraw": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'signatories-axi docs withdraw <slug> --reason "..." [--public]',
      );
      const body = {
        reason: requireStr(
          parsed,
          "--reason",
          'signatories-axi docs withdraw <slug> --reason "..." [--public]',
        ),
        public: bool(parsed, "--public"),
      };
      const doc = await client.post<DocumentSummary>(
        `/documents/${encodeURIComponent(slug)}/withdraw`,
        body,
      );
      return render(parsed, doc, () => renderObject(detailObject(doc, instanceUrl)));
    }

    case "export": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi docs export <slug> --pdf [--out <file>]",
      );
      // `specs/api/admin-cli.md`: `--pdf` names the format and is the only
      // one today, so a bare `docs export <slug>` means the same thing
      // rather than failing over a flag with one legal value.
      const paper = str(parsed, "--paper");
      if (paper !== undefined && paper !== "letter" && paper !== "a4") {
        throw new AxiError("--paper must be letter or a4", "USAGE", [
          `Run \`${cli} docs export ${slug} --pdf --paper letter\``,
        ]);
      }
      // `specs/behaviors/versioning.md` § Citations. Unlike the HTTP door,
      // which falls back rather than fail a reader's shared URL, a mistyped
      // flag is refused: an operator asked for a specific form of the file
      // and should be told they did not get it.
      const citations = str(parsed, "--citations");
      if (
        citations !== undefined &&
        citations !== "links" &&
        citations !== "footnotes" &&
        citations !== "hybrid"
      ) {
        throw new AxiError("--citations must be links, footnotes or hybrid", "USAGE", [
          `Run \`${cli} docs export ${slug} --pdf --citations hybrid\``,
        ]);
      }
      const download = await client.getBinary(
        `/documents/${encodeURIComponent(slug)}/statement.pdf`,
        { paper, citations, draft: bool(parsed, "--draft") ? "1" : undefined },
      );

      // The version number and the draft-or-clean word are read off the
      // name the server chose, so what is printed describes the bytes that
      // were written rather than a second, later look at the document.
      const serverName = download.filename ?? `${slug}.pdf`;
      const out = str(parsed, "--out") ?? serverName;
      writeFileSync(out, download.bytes);

      const draftCopy = serverName.endsWith("-draft.pdf");
      const version = /-v(\d+)(?:-draft)?\.pdf$/u.exec(serverName)?.[1];
      const result = {
        out,
        version: version === undefined ? undefined : Number(version),
        copy: draftCopy ? "draft" : "clean",
        paper: paper ?? "letter",
        citations: citations ?? "hybrid",
        bytes: download.bytes.byteLength,
      };
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(compact(result)),
          renderHelp([
            draftCopy
              ? `This copy is watermarked DRAFT; it goes clean once signing closes or \`${cli} docs delivered ${slug}\` records the delivery`
              : `Run \`${cli} signatures list ${slug}\` to read the names on this copy`,
          ]),
        ),
      );
    }

    case "operators": {
      const first = parsed.positional[0];
      if (first === "add" || first === "remove") {
        const slug = requirePositional(
          parsed,
          1,
          "slug",
          `signatories-axi docs operators ${first} <slug> <email>`,
        );
        const email = requirePositional(
          parsed,
          2,
          "email",
          `signatories-axi docs operators ${first} <slug> <email>`,
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

      const slug = requirePositional(parsed, 0, "slug", "signatories-axi docs operators <slug>");
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

/**
 * `docs extend` and `docs reopen` share one output: each deadline's old and
 * new time, then the announcement — what it sent when `--notify` was given,
 * and how many it did not tell when it was not (`specs/api/admin-cli.md`).
 */
async function scheduleChange(
  parsed: Parsed,
  client: SignatoriesClient,
  slug: string,
  endpoint: "schedule" | "reopen",
  body: Record<string, unknown>,
  notes: string[],
  instanceUrl: string,
): Promise<string> {
  const path = `/documents/${encodeURIComponent(slug)}/${endpoint}`;
  const result = await client.post<ScheduleResult | ScheduleDryRun>(path, body);
  const deadlines = result.deadlines ?? [];
  const notify = result.notify;
  const dryRun = "dry_run" in result && result.dry_run === true;
  const hint =
    notify && !notify.requested && notify.would_notify > 0
      ? `Nobody was told. Re-run with --notify to tell the ${notify.would_notify} ${notify.would_notify === 1 ? "person" : "people"} who opened it and have not answered`
      : undefined;
  return render(parsed, result, () =>
    joinBlocks(
      dryRun
        ? renderObject({ dry_run: true })
        : renderObject(detailObject(result as ScheduleResult, instanceUrl)),
      deadlines.length > 0
        ? renderList("deadlines", deadlines, [
            computed("deadline", (d) => d.deadline),
            computed("from", (d) => d.from ?? "(unset)"),
            computed("to", (d) => d.to),
          ])
        : "",
      notify
        ? renderObject({
            announce: dryRun
              ? `${notify.would_notify} would be told${notify.requested ? "" : " with --notify"}`
              : announceLine(notify),
          })
        : "",
      renderHelp(
        [
          ...notes,
          dryRun ? `Run without --dry-run to ${endpoint === "reopen" ? "reopen" : "extend"}` : hint,
        ].filter((n): n is string => Boolean(n)),
      ),
    ),
  );
}
