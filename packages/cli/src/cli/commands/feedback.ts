import { writeFileSync } from "node:fs";

import { AxiError } from "axi-sdk-js";

import { parseSubcommand, requirePositional, str, type FlagSpec } from "../flags.js";
import { renderObject } from "../output.js";
import type { FeedbackExport } from "../types.js";
import { clientFrom } from "./common.js";

const FEEDBACK_FLAGS: Record<string, FlagSpec> = {
  export: { positionals: 1, value: ["--format", "--out"] },
};

export const FEEDBACK_HELP = `usage: signatories-axi feedback export <slug> [--format json|md] [--out <file>]

The LLM-round bundle (\`specs/behaviors/review-and-judgement.md\`): every
pending comment, organized by submission. Feed the json form straight into
your disposition pass, then \`versions publish --dispositions <file.json>\`.`;

export async function feedbackCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("feedback", args, FEEDBACK_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "export": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi feedback export <slug>");
      const format = str(parsed, "--format", "json");
      if (format !== "json" && format !== "md") {
        throw new AxiError(`"${format}" is not a valid --format`, "USAGE", [
          "Valid formats: json, md",
        ]);
      }
      const out = str(parsed, "--out");

      if (format === "md") {
        const markdown = await client.get<string>(
          `/documents/${encodeURIComponent(slug)}/feedback-export`,
          {
            format: "md",
          },
        );
        if (out) {
          writeFileSync(out, markdown, "utf8");
          return renderObject({ out, format });
        }
        return markdown;
      }

      const bundle = await client.get<FeedbackExport>(
        `/documents/${encodeURIComponent(slug)}/feedback-export`,
      );
      const content = JSON.stringify(bundle, null, 2);
      if (out) {
        writeFileSync(out, content, "utf8");
        return renderObject({
          out,
          format,
          pending: bundle.submissions.submitted.length + bundle.submissions.draft.length,
        });
      }
      return content;
    }

    default:
      return sub; // unreachable
  }
}
