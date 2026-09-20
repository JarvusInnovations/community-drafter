import { AxiError } from "axi-sdk-js";
import { writeFileSync } from "node:fs";

import {
  bool,
  csv,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
  type FlagSpec,
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
  ImportResult,
  InvitationRow,
  ReissueLinkResult,
  RemindResult,
  RevokeLinkResult,
  SendResult,
} from "../types.js";
import { clientFrom, readFileOrStdin, render } from "./common.js";

const PEOPLE_FLAGS: Record<string, FlagSpec> = {
  import: { positionals: 2, value: ["--suggested-capacity"], boolean: ["--dry-run"] },
  list: { positionals: 1, value: ["--status", "--source", "-q"], boolean: ["--contacts"] },
  links: { positionals: 1, value: ["--person", "--out"] },
  send: { positionals: 1, value: ["--person"], boolean: ["--only-unsent", "--dry-run"] },
  remove: { positionals: 2 },
  remind: { positionals: 1, value: ["--target"], boolean: ["--dry-run"] },
  "revoke-link": { positionals: 2 },
  "reissue-link": { positionals: 2 },
};

export const PEOPLE_HELP = `usage: drafter-axi people <import|list|remove|links|send|remind|revoke-link|reissue-link> ...

import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official] [--dry-run]
       Reads NDJSON or a JSON array (defaults to stdin when the file is omitted);
       a gitsheets people sheet's NDJSON export works directly. Each row may carry
       email, name, phone, org, role, descriptor, external_id, suggested_capacity.
       --dry-run shows what every row would do (new person, existing person and
       which fields would change, or already invited) without writing anything.
list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]
       Never prints tokens; emails only with --contacts. Staged invitations that
       have not been sent yet show status not_sent.
remove <slug> <person>
       Take back a staged invitation that was never sent. Once sent or acted on,
       the record stays (use revoke-link instead).
links <slug> [--person a,b] [--out <file.csv>]
       The only command that returns tokens — recorded as an admin event.
send <slug> [--only-unsent] [--person a,b] [--dry-run]
       Sends invitations to everyone not yet sent (or to --person, even if sent).
       --dry-run lists who would receive one and who is skipped and why.
remind <slug> --target unopened|opened-not-acted [--dry-run]
revoke-link <slug> <person>
reissue-link <slug> <person>
       Prints the new link once.`;

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
        "drafter-axi people import <slug> [<file.ndjson>|-]",
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
      const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
      const result = await client.postText<ImportResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/import${dryRun ? "?dry_run=1" : ""}`,
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
                computed<PlanRow>("changes", (r) => r.changes.join(",")),
              ])
            : "",
          renderHelp(
            dryRun
              ? [`Nothing was written. Run again without --dry-run to import`]
              : [`Run \`drafter-axi people list ${slug}\` to see the imported invitees`],
          ),
        ),
      );
    }

    case "list": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi people list <slug>");
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
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi people links <slug>");
      const person = csv(str(parsed, "--person"));
      const csvText = await client.post<string>(
        `/documents/${encodeURIComponent(slug)}/invitations/links`,
        {
          person: person.length > 0 ? person : undefined,
        },
      );
      const out = str(parsed, "--out");
      if (out) {
        writeFileSync(out, csvText, "utf8");
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
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi people send <slug>");
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
      return render(parsed, result, () =>
        joinBlocks(
          renderObject({
            queued: result.queued,
            mailer_export: result.csv ? "included (rerun with --json to capture)" : undefined,
          }),
          skippedBlock,
        ),
      );
    }

    case "remove": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi people remove <slug> <person>",
      );
      const personId = requirePositional(
        parsed,
        1,
        "person",
        "drafter-axi people remove <slug> <person>",
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
        "drafter-axi people remind <slug> --target unopened|opened-not-acted",
      );
      const targetFlag = requireStr(
        parsed,
        "--target",
        "drafter-axi people remind <slug> --target unopened|opened-not-acted",
      );
      const target = targetFlag === "opened-not-acted" ? "opened_not_acted" : targetFlag;
      if (target !== "unopened" && target !== "opened_not_acted") {
        throw new AxiError(`"${targetFlag}" is not a valid --target`, "USAGE", [
          "Valid targets: unopened, opened-not-acted",
        ]);
      }
      const result = await client.post<RemindResult>(
        `/documents/${encodeURIComponent(slug)}/invitations/remind`,
        {
          target,
          dry_run: bool(parsed, "--dry-run") || undefined,
        },
      );
      return render(parsed, result, () => renderObject(result));
    }

    case "revoke-link": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi people revoke-link <slug> <person>",
      );
      const person = requirePositional(
        parsed,
        1,
        "person",
        "drafter-axi people revoke-link <slug> <person>",
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
        "drafter-axi people reissue-link <slug> <person>",
      );
      const person = requirePositional(
        parsed,
        1,
        "person",
        "drafter-axi people reissue-link <slug> <person>",
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

    default:
      return sub; // unreachable
  }
}
