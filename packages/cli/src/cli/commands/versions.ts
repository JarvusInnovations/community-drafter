import { AxiError } from "axi-sdk-js";

import {
  bool,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
  type FlagSpec,
} from "../flags.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type {
  CompareResult,
  DispositionRecord,
  PublishResult,
  VersionDetail,
  VersionListItem,
} from "../types.js";
import { clientFrom, readFileOrStdin, render } from "./common.js";

const VERSIONS_FLAGS: Record<string, FlagSpec> = {
  list: { positionals: 1 },
  show: { positionals: 2, boolean: ["--body"] },
  publish: {
    positionals: 1,
    value: ["--file", "--summary", "--notes-file", "--dispositions"],
    boolean: ["--final"],
  },
  compare: { positionals: 3, boolean: ["--unchanged"] },
};

export const VERSIONS_HELP = `usage: drafter-axi versions <list|show|publish|compare> ...

list <slug>
show <slug> <n> [--body]
publish <slug> --file <path> --summary "<text>" [--notes-file <path>] [--final] [--dispositions <file.json>]
compare <slug> <from> <to> [--unchanged]

publish is one commit: the document body, disposition fields on any submissions
named in --dispositions (a JSON array of {submission, comment, outcome, note?}),
and a signing_closes_at extension if the document is mid-signing. Prints the
version number, the commit subject, and notification counts.

--dispositions outcomes — exactly one of these four; anything else is rejected:
  accepted  Incorporated in this version. Note optional.
  partial   Partly addressed in this version. Note expected, saying which part.
  declined  Not incorporated. Note required — it is what the commenter is told.
  noted     Read and noted; no text change. Note optional.

Each entry is {submission: <id>, comment: <id>, outcome: <one of the four>,
note?: "<text>"}. Run feedback export <slug> to get the ids to fill in.`;

const BODY_PREVIEW_CHARS = 800;

/**
 * `specs/api/admin-cli.md` § Help: every place that mentions the
 * dispositions file names the four allowed outcomes, so a bad `outcome` is
 * never something the caller has to discover from a schema dump
 * (`behaviors/review-and-judgement.md` § Dispositions).
 */
const DISPOSITIONS_SHAPE =
  "The file must be a JSON array of {submission, comment, outcome, note?}, where outcome is accepted (incorporated), partial (partly addressed), declined (not incorporated, note required) or noted (read, no text change)";

/** Strip the redline's `<ins>`/`<del>` HTML into terminal-readable `{+...+}`/`{-...-}` markers. */
function toTerminalText(html: string): string {
  return html
    .replace(/<ins>/g, "{+")
    .replace(/<\/ins>/g, "+}")
    .replace(/<del>/g, "{-")
    .replace(/<\/del>/g, "-}")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseDispositions(text: string): DispositionRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AxiError(
      `--dispositions file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "USAGE",
      [DISPOSITIONS_SHAPE],
    );
  }
  if (!Array.isArray(parsed)) {
    throw new AxiError("--dispositions file must contain a JSON array", "USAGE", [
      DISPOSITIONS_SHAPE,
    ]);
  }
  return parsed as DispositionRecord[];
}

export async function versionsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("versions", args, VERSIONS_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "list": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi versions list <slug>");
      const versions = await client.get<VersionListItem[]>(
        `/documents/${encodeURIComponent(slug)}/versions`,
      );
      return render(parsed, versions, () =>
        versions.length === 0
          ? renderObject({ versions: "no published versions yet" })
          : renderList("versions", versions, [
              computed("number", (v) => v.number),
              computed("summary", (v) => v.summary),
              computed("published_at", (v) => v.published_at),
              computed("final", (v) => v.final),
              computed("dispositions", (v) => v.dispositions),
            ]),
      );
    }

    case "show": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi versions show <slug> <n>");
      const n = requirePositional(parsed, 1, "n", "drafter-axi versions show <slug> <n>");
      const version = await client.get<VersionDetail>(
        `/documents/${encodeURIComponent(slug)}/versions/${encodeURIComponent(n)}`,
      );
      const showBody = bool(parsed, "--body");
      const bodyBlock = showBody
        ? renderObject({ body: version.body })
        : renderObject({
            body:
              version.body.length > BODY_PREVIEW_CHARS
                ? `${version.body.slice(0, BODY_PREVIEW_CHARS)}\n... (truncated, ${version.body.length} chars total)`
                : version.body,
          });
      return render(parsed, version, () =>
        joinBlocks(
          renderObject({
            number: version.number,
            commit: version.commit,
            summary: version.summary,
            published_at: version.published_at,
            published_by: version.published_by,
            final: version.final,
            notes: version.notes,
          }),
          bodyBlock,
          version.dispositions.length > 0
            ? renderList("dispositions", version.dispositions, [
                computed("submission", (d) => d.submission),
                computed("comment", (d) => d.comment),
                computed("outcome", (d) => d.outcome),
                computed("note", (d) => d.note ?? ""),
              ])
            : "",
          !showBody && version.body.length > BODY_PREVIEW_CHARS
            ? renderHelp([
                `Run \`drafter-axi versions show ${slug} ${n} --body\` for the full body`,
              ])
            : "",
        ),
      );
    }

    case "publish": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi versions publish <slug> --file <path> --summary "..."',
      );
      const filePath = requireStr(
        parsed,
        "--file",
        'drafter-axi versions publish <slug> --file <path> --summary "..."',
      );
      const summary = requireStr(
        parsed,
        "--summary",
        'drafter-axi versions publish <slug> --file <path> --summary "..."',
      );
      const body = await readFileOrStdin(filePath);
      const notesFile = str(parsed, "--notes-file");
      const notes = notesFile ? await readFileOrStdin(notesFile) : undefined;
      const dispositionsFile = str(parsed, "--dispositions");
      const dispositions = dispositionsFile
        ? parseDispositions(await readFileOrStdin(dispositionsFile))
        : undefined;

      const result = await client.post<PublishResult>(
        `/documents/${encodeURIComponent(slug)}/versions`,
        {
          body,
          summary,
          notes,
          final: bool(parsed, "--final") || undefined,
          dispositions,
        },
      );

      return render(parsed, result, () =>
        joinBlocks(
          renderObject({
            number: result.number,
            summary: result.summary,
            commit: result.commit,
            // `specs/api/admin-cli.md`: printed only when the publish moved
            // it — a `signing_closes_at: null` line reads as a deadline
            // that was cleared (#60).
            ...(result.signing_closes_at ? { signing_closes_at: result.signing_closes_at } : {}),
          }),
          renderObject({ notified: result.notified }),
          renderHelp([`Run \`drafter-axi docs show ${slug}\` to see the updated dashboard`]),
        ),
      );
    }

    case "compare": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "drafter-axi versions compare <slug> <from> <to>",
      );
      const from = requirePositional(
        parsed,
        1,
        "from",
        "drafter-axi versions compare <slug> <from> <to>",
      );
      const to = requirePositional(
        parsed,
        2,
        "to",
        "drafter-axi versions compare <slug> <from> <to>",
      );
      const result = await client.get<CompareResult>(
        `/documents/${encodeURIComponent(slug)}/compare`,
        {
          from,
          to,
        },
      );
      const includeUnchanged = bool(parsed, "--unchanged");
      const blocks = (
        result.blocks as Array<{ status: string; id: string; html: string; format_only?: boolean }>
      ).filter((b) => includeUnchanged || b.status !== "same");
      return render(parsed, result, () =>
        joinBlocks(
          renderObject({ from: result.from, to: result.to, summary: result.summary }),
          blocks.length === 0
            ? renderObject({ blocks: "no changed blocks" })
            : renderList("blocks", blocks, [
                computed("status", (b) => b.status),
                computed("id", (b) => b.id),
                computed("text", (b) => toTerminalText(b.html as string)),
              ]),
          renderHelp(
            includeUnchanged
              ? []
              : [
                  `Run \`drafter-axi versions compare ${slug} ${from} ${to} --unchanged\` to include unchanged blocks`,
                ],
          ),
        ),
      );
    }

    default:
      return sub; // unreachable
  }
}
