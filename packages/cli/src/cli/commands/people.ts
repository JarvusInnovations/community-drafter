import { AxiError } from "axi-sdk-js";
import { chmodSync, writeFileSync } from "node:fs";

import {
  bool,
  csv,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
  type FlagSpec,
  type Parsed,
} from "../flags.js";
import {
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
  type FieldDef,
} from "../output.js";
import type {
  ExpireLinkResult,
  ImportResult,
  InvitationRow,
  ReissueLinkResult,
  RemindResult,
  RevokeLinkResult,
  SendResult,
} from "../types.js";
import { parseDeadline } from "../deadline.js";
import { clientFrom, readFileOrStdin, render } from "./common.js";

const PEOPLE_FLAGS: Record<string, FlagSpec> = {
  import: { positionals: 2, value: ["--suggested-capacity"], boolean: ["--dry-run", "--update"] },
  list: { positionals: 1, value: ["--status", "--source", "-q"], boolean: ["--contacts"] },
  links: { positionals: 1, value: ["--person", "--out"] },
  send: { positionals: 1, value: ["--person"], boolean: ["--only-unsent", "--dry-run"] },
  remove: { positionals: 2 },
  remind: { positionals: 1, value: ["--target", "--person", "--min-age"], boolean: ["--dry-run"] },
  "revoke-link": { positionals: 2 },
  "reissue-link": { positionals: 2 },
  expire: { positionals: 2, value: ["--expires-at"] },
};

export const PEOPLE_HELP = `usage: signatories-axi people <import|list|remove|links|send|remind|revoke-link|reissue-link|expire> ...

import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official] [--update] [--dry-run]
       Reads NDJSON or a JSON array (defaults to stdin when the file is omitted);
       a gitsheets people sheet's NDJSON export works directly.

       People are matched by email within THIS document's site, so the same
       address invited on another site is a different person and is never
       touched. Each row's name/org/role/descriptor also become this document's
       own prefill, so importing here never changes what another document's
       sign card offers.

       Row fields, by these exact names:
         email              required  merge key; matches an existing person
                                      case-insensitively and updates them
         name               required  full name, as it should be prefilled
         org                optional  organization — NOT "organization"
         role               optional  job title — NOT "title"
         phone              optional
         descriptor         optional  how a personal-capacity signer is described
         external_id        optional  your own system's id for this person
         suggested_capacity optional  personal | official; prefills the sign card
         tags               optional  array of strings
       Any other key is ignored silently, so a misnamed field simply does
       nothing. Run --dry-run first: it shows what every row would do (new
       person, existing person and which fields would change, or already
       invited) without writing anything.

       An existing person keeps every field they already have; only their
       blanks are filled. Pass --update to let the file replace them and
       refresh an already-invited person's prefill. Either way --dry-run
       reports would_change (what this mode changes) and kept (the set fields
       it leaves alone — what --update would act on).
list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]
       Never prints tokens; emails only with --contacts. Staged invitations that
       have not been sent yet show status not_sent. name and org are what this
       document's sign card prefills, not the raw contact record.
remove <slug> <person>
       Take back a staged invitation that was never sent. Once sent or acted on,
       the record stays (use revoke-link instead).
links <slug> [--person a,b] [--out <file.csv>]
       The only command that returns tokens — recorded as an admin event.
send <slug> [--only-unsent] [--person a,b] [--dry-run]
       Sends invitations to everyone not yet sent (or to --person, even if sent).
       Prints how many the mailer accepted and names the ones it rejected; a
       rejected invitee stays not_sent, so running send again picks them up.
       --dry-run lists who would receive one and who is skipped and why.
remind <slug> --target unopened|opened-not-acted [--person a,b] [--min-age <hours>] [--dry-run]
       Skips anyone this document has messaged within --min-age hours (default
       48; pass 0 to send regardless) and reports what it actually sent,
       counting recently-messaged and reminders-off invitees separately.
       --person limits the run to those people; --target, --min-age and the
       reminders preference still apply, and each named person not reminded
       is listed with why. A name with no invitation here is refused.
revoke-link <slug> <person>
reissue-link <slug> <person>
       Prints the new link once.
expire <slug> <person> --expires-at <when>
       Set when this person's link stops working. <when> is ISO 8601 with a zone
       (2026-10-01T17:00:00-04:00, 2026-10-01T21:00:00Z) or a zone-less time
       (2026-10-01T17:00) read in this machine's local zone; either way the
       command prints the instant it resolved to.`;

interface ImportRow {
  name: string;
  email: string;
  phone?: string;
  org?: string;
  role?: string;
  descriptor?: string;
  external_id?: string;
  suggested_capacity?: string;
  tags?: string[];
  [key: string]: unknown;
}

function parseImportRows(text: string): ImportRow[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AxiError("no rows to import (input was empty)", "USAGE", [
      "Pass a file path, or pipe NDJSON/a JSON array to stdin with `-`",
    ]);
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new AxiError("import input must be a JSON array or NDJSON", "USAGE", []);
    }
    return parsed as ImportRow[];
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ImportRow);
}

/**
 * `--min-age <hours>` for `people remind`. Left to the API's own default
 * (48) when the flag is absent, so the interval is stated in one place;
 * a value the API would reject is caught here with the usage hint instead.
 */
function minAgeHours(parsed: Parsed): number | undefined {
  const raw = str(parsed, "--min-age");
  if (raw === undefined) return undefined;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new AxiError(`"${raw}" is not a valid --min-age`, "USAGE", [
      "--min-age takes a number of hours, 0 or greater (default 48; 0 sends regardless)",
    ]);
  }
  return hours;
}

/** Minimal RFC 4180 CSV row parser — matches `apps/api/src/lib/csv.ts`'s writer. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // skip — \r\n line endings
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export async function peopleCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("people", args, PEOPLE_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "import": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi people import <slug> [<file.ndjson>|-]",
      );
      const filePath = parsed.positional[1] ?? "-";
      const suggestedCapacity = str(parsed, "--suggested-capacity");
      const rows = parseImportRows(await readFileOrStdin(filePath));
      if (suggestedCapacity) {
        for (const row of rows) {
          if (row.suggested_capacity === undefined) row.suggested_capacity = suggestedCapacity;
        }
      }
      const dryRun = bool(parsed, "--dry-run");
      const update = bool(parsed, "--update");
      const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
      const query = [dryRun ? "dry_run=1" : "", update ? "update=1" : ""].filter(Boolean).join("&");
      const result = await client.postText<ImportResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/import${query ? `?${query}` : ""}`,
        ndjson,
        "application/x-ndjson",
      );
      const { rows: planRows, ...counts } = result;
      type PlanRow = NonNullable<ImportResult["rows"]>[number];
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(counts),
          planRows && planRows.length > 0
            ? renderList("rows", planRows, [
                computed<PlanRow>("person", (r) => r.person),
                computed<PlanRow>("name", (r) => r.name),
                computed<PlanRow>("action", (r) => r.action),
                computed<PlanRow>("would_change", (r) => r.would_change.join(",")),
                computed<PlanRow>("kept", (r) => r.kept.join(",")),
              ])
            : "",
          renderHelp(
            [
              dryRun
                ? `Nothing was written. Run again without --dry-run to import`
                : `Run \`signatories-axi people list ${slug}\` to see the imported invitees`,
              // The one thing a reader cannot infer from the counts: the rows
              // in `kept` are the ones a second run with --update would change.
              ...(!update && planRows?.some((r) => r.kept.length > 0)
                ? [
                    `Fields in kept were left alone because the person already has a value — pass --update to replace them`,
                  ]
                : []),
            ].filter(Boolean),
          ),
        ),
      );
    }

    case "list": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi people list <slug>");
      const contacts = bool(parsed, "--contacts");
      const rows = await client.get<InvitationRow[]>(
        `/documents/${encodeURIComponent(slug)}/invitations`,
        {
          status: str(parsed, "--status"),
          source: str(parsed, "--source"),
          q: str(parsed, "-q"),
        },
      );
      const schema: Array<FieldDef<InvitationRow>> = [
        computed("person", (r) => r.person),
        computed("name", (r) => r.name),
        computed("org", (r) => r.org ?? ""),
        ...(contacts ? [computed<InvitationRow>("email", (r) => r.email)] : []),
        computed("status", (r) => r.status),
        computed("opens", (r) => r.opens),
        computed("sent_at", (r) => r.sent_at ?? ""),
      ];
      return render(parsed, contacts ? rows : rows.map(({ email: _email, ...rest }) => rest), () =>
        joinBlocks(
          rows.length === 0
            ? renderObject({ people: "0 invitees found" })
            : renderList("people", rows, schema),
          renderHelp(contacts ? [] : [`Pass --contacts to include email addresses (never tokens)`]),
        ),
      );
    }

    case "links": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi people links <slug>");
      const person = csv(str(parsed, "--person"));
      const csvText = await client.post<string>(
        `/documents/${encodeURIComponent(slug)}/invitations/links`,
        {
          person: person.length > 0 ? person : undefined,
        },
      );
      const out = str(parsed, "--out");
      if (out) {
        // `specs/api/admin-cli.md`: the rows are credentials, so the file
        // is written `0600` exactly as `login` writes the profile. `mode`
        // is only honoured when the file is created, so an existing, more
        // permissive file is chmod'd explicitly (#60).
        writeFileSync(out, csvText, { encoding: "utf8", mode: 0o600 });
        chmodSync(out, 0o600);
        const rowCount = Math.max(0, parseCsv(csvText).length - 1);
        return render(parsed, { out, rows: rowCount }, () => renderObject({ out, rows: rowCount }));
      }
      const parsedRows = parseCsv(csvText);
      const [header, ...dataRows] = parsedRows;
      const rows = dataRows.map((r) =>
        Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ""])),
      );
      return render(parsed, rows, () =>
        joinBlocks(
          rows.length === 0
            ? renderObject({ links: "0 links found" })
            : renderList("links", rows, [
                computed("person", (r) => r.person),
                computed("name", (r) => r.name),
                computed("email", (r) => r.email),
                computed("link", (r) => r.link),
              ]),
          renderHelp(["Links are tokens — handle this output like a credential"]),
        ),
      );
    }

    case "send": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi people send <slug>");
      const person = csv(str(parsed, "--person"));
      const dryRun = bool(parsed, "--dry-run");
      const result = await client.post<SendResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/send`,
        {
          only_unsent: bool(parsed, "--only-unsent") || undefined,
          person: person.length > 0 ? person : undefined,
          dry_run: dryRun || undefined,
        },
      );
      type Skipped = NonNullable<SendResult["skipped"]>[number];
      type Would = NonNullable<SendResult["would_send"]>[number];
      const skippedBlock =
        result.skipped && result.skipped.length > 0
          ? renderList("skipped", result.skipped, [
              computed<Skipped>("person", (s) => s.person),
              computed<Skipped>("reason", (s) => s.reason),
            ])
          : "";
      if (dryRun) {
        const would = result.would_send ?? [];
        return render(parsed, result, () =>
          joinBlocks(
            renderObject({ dry_run: true, would_send: would.length }),
            would.length > 0
              ? renderList("would_send", would, [
                  computed<Would>("person", (w) => w.person),
                  computed<Would>("name", (w) => w.name),
                ])
              : "",
            skippedBlock,
            renderHelp([`Nothing was sent. Run again without --dry-run to send`]),
          ),
        );
      }
      type Failure = NonNullable<SendResult["failures"]>[number];
      const failures = result.failures ?? [];
      return render(parsed, result, () =>
        joinBlocks(
          renderObject({
            sent: result.sent,
            failed: result.failed,
            mailer_export: result.csv ? "included (rerun with --json to capture)" : undefined,
          }),
          skippedBlock,
          failures.length > 0
            ? renderList("failures", failures, [
                computed<Failure>("person", (f) => f.person),
                computed<Failure>("error", (f) => f.error),
              ])
            : "",
          failures.length > 0
            ? renderHelp([
                `${failures.length} invitation(s) were not delivered and are still not_sent — fix the address, then run \`signatories-axi people send ${slug}\` again`,
              ])
            : "",
        ),
      );
    }

    case "remove": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi people remove <slug> <person>",
      );
      const personId = requirePositional(
        parsed,
        1,
        "person",
        "signatories-axi people remove <slug> <person>",
      );
      const result = await client.delete<{ ok: boolean; commit?: string | null }>(
        `/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(personId)}`,
      );
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(result),
          renderHelp([`Removed the staged invitation for ${personId}`]),
        ),
      );
    }

    case "remind": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi people remind <slug> --target unopened|opened-not-acted",
      );
      const targetFlag = requireStr(
        parsed,
        "--target",
        "signatories-axi people remind <slug> --target unopened|opened-not-acted",
      );
      const target = targetFlag === "opened-not-acted" ? "opened_not_acted" : targetFlag;
      if (target !== "unopened" && target !== "opened_not_acted") {
        throw new AxiError(`"${targetFlag}" is not a valid --target`, "USAGE", [
          "Valid targets: unopened, opened-not-acted",
        ]);
      }
      const person = csv(str(parsed, "--person"));
      const result = await client.post<RemindResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/remind`,
        {
          target,
          person: person.length > 0 ? person : undefined,
          min_age_hours: minAgeHours(parsed),
          dry_run: bool(parsed, "--dry-run") || undefined,
        },
      );
      type RemindFailure = NonNullable<RemindResult["failures"]>[number];
      type RemindSkipped = NonNullable<RemindResult["skipped"]>[number];
      const remindFailures = result.failures ?? [];
      // `specs/api/admin-cli.md`: a remind prints what it actually sent and,
      // when it sent nothing, why — the recency guard and the `reminders`
      // preference are separate answers.
      const help: string[] = [];
      if (result.skipped_recent > 0) {
        help.push(
          `${result.skipped_recent} were already messaged within ${result.min_age_hours}h — pass \`--min-age <hours>\` (0 to send regardless) if you need to nudge sooner`,
        );
      }
      if (result.skipped_pref > 0) {
        help.push(`${result.skipped_pref} have turned reminders off and were left alone`);
      }
      if (result.dry_run) {
        help.push("Nothing was sent. Run again without --dry-run to send");
      }
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(
            result.dry_run
              ? {
                  dry_run: true,
                  targeted: result.targeted,
                  skipped_recent: result.skipped_recent,
                  skipped_pref: result.skipped_pref,
                  min_age_hours: result.min_age_hours,
                }
              : {
                  sent: result.sent,
                  failed: result.failed,
                  skipped_recent: result.skipped_recent,
                  skipped_pref: result.skipped_pref,
                  min_age_hours: result.min_age_hours,
                  commit: result.commit ?? undefined,
                },
          ),
          result.skipped && result.skipped.length > 0
            ? renderList("skipped", result.skipped, [
                computed<RemindSkipped>("person", (s) => s.person),
                computed<RemindSkipped>("reason", (s) => s.reason),
              ])
            : "",
          remindFailures.length > 0
            ? renderList("failures", remindFailures, [
                computed<RemindFailure>("person", (f) => f.person),
                computed<RemindFailure>("error", (f) => f.error),
              ])
            : "",
          help.length > 0 ? renderHelp(help) : "",
        ),
      );
    }

    case "revoke-link": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi people revoke-link <slug> <person>",
      );
      const person = requirePositional(
        parsed,
        1,
        "person",
        "signatories-axi people revoke-link <slug> <person>",
      );
      const result = await client.post<RevokeLinkResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(person)}/revoke-link`,
      );
      return render(parsed, result, () => renderObject(result));
    }

    case "reissue-link": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi people reissue-link <slug> <person>",
      );
      const person = requirePositional(
        parsed,
        1,
        "person",
        "signatories-axi people reissue-link <slug> <person>",
      );
      const result = await client.post<ReissueLinkResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(person)}/reissue-link`,
      );
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(result),
          renderHelp([
            "This link is shown once — it is not retrievable again except via `people links`",
          ]),
        ),
      );
    }

    case "expire": {
      const usage = "signatories-axi people expire <slug> <person> --expires-at <when>";
      const slug = requirePositional(parsed, 0, "slug", usage);
      const person = requirePositional(parsed, 1, "person", usage);
      // `specs/api/admin-cli.md`: the same `<when>` grammar as `docs open`,
      // echoed back — the API only accepts a zoned instant, and an operator
      // reaching for an expiry should not have to convert one by hand.
      const expiresAt = parseDeadline(
        requireStr(parsed, "--expires-at", usage),
        "--expires-at",
        usage,
      );
      const result = await client.post<ExpireLinkResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(person)}/expire`,
        { expires_at: expiresAt.iso },
      );
      return render(parsed, result, () =>
        joinBlocks(
          renderObject({ person, ...result }),
          renderHelp([
            expiresAt.note,
            `The link stops working then; \`signatories-axi people reissue-link ${slug} ${person}\` issues a fresh one`,
          ]),
        ),
      );
    }

    default:
      return sub; // unreachable
  }
}
