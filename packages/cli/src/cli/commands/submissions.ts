import { bool, parseSubcommand, requirePositional, str, type FlagSpec } from "../flags.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { SubmissionView } from "../types.js";
import { clientFrom, render } from "./common.js";

const SUBMISSIONS_FLAGS: Record<string, FlagSpec> = {
  list: {
    positionals: 1,
    value: ["--version", "--person"],
    boolean: ["--pending", "--include-drafts"],
  },
};

export const SUBMISSIONS_HELP = `usage: signatories-axi submissions list <slug> [--pending] [--version <n>] [--person <id>] [--include-drafts]

Whole submissions, each with its comments (shown as two tables: submissions,
then comments). Drafts come only with --include-drafts, and every draft row
carries state: draft so it can't be mistaken for a submitted answer.`;

export async function submissionsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("submissions", args, SUBMISSIONS_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "list": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi submissions list <slug>");
      const includeDrafts = bool(parsed, "--include-drafts");
      const submissions = await client.get<SubmissionView[]>(
        `/documents/${encodeURIComponent(slug)}/submissions`,
        {
          state: includeDrafts ? "all" : "submitted",
          disposition: bool(parsed, "--pending") ? "pending" : undefined,
          version: str(parsed, "--version"),
          person: str(parsed, "--person"),
        },
      );

      const comments = submissions.flatMap((s) =>
        s.comments.map((c) => ({
          submission: s.id,
          comment: c.id,
          anchor: c.anchor ? JSON.stringify(c.anchor) : "",
          body: c.body,
          disposition: c.disposition?.outcome ?? "pending",
        })),
      );

      return render(parsed, submissions, () =>
        joinBlocks(
          submissions.length === 0
            ? renderObject({ submissions: "0 submissions found" })
            : renderList("submissions", submissions, [
                computed("id", (s) => s.id),
                computed("author", (s) => s.author),
                computed("version", (s) => s.version),
                computed("state", (s) => s.state),
                computed("judgement", (s) => s.judgement ?? ""),
                computed("comments", (s) => s.comments.length),
                computed("pending", (s) => s.comments.filter((c) => !c.disposition).length),
              ]),
          comments.length === 0
            ? ""
            : renderList("comments", comments, [
                computed("submission", (c) => c.submission),
                computed("comment", (c) => c.comment),
                computed("body", (c) => truncate(String(c.body))),
                computed("disposition", (c) => c.disposition),
              ]),
          renderHelp([
            `Run \`signatories-axi feedback export ${slug}\` for the full LLM-round bundle`,
          ]),
        ),
      );
    }

    default:
      return sub; // unreachable
  }
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
