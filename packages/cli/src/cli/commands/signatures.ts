import { bool, parseSubcommand, requirePositional, requireStr, type FlagSpec } from "../flags.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { RevokeSignatureResult, SignatureListRow } from "../types.js";
import { clientFrom, render } from "./common.js";

const SIGNATURES_FLAGS: Record<string, FlagSpec> = {
  list: { positionals: 1, boolean: ["--include-revoked", "--conditional"] },
  revoke: { positionals: 2, value: ["--reason"] },
};

export const SIGNATURES_HELP = `usage: drafter-axi signatures <list|revoke> ...

list <slug> [--include-revoked] [--conditional]
revoke <slug> <person> --reason "<text>"
       Admin revocation; a confirmation email goes to the person.`;

export async function signaturesCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("signatures", args, SIGNATURES_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "list": {
      const slug = requirePositional(parsed, 0, "slug", "drafter-axi signatures list <slug>");
      const includeRevoked = bool(parsed, "--include-revoked");
      const conditionalOnly = bool(parsed, "--conditional");
      let rows = await client.get<SignatureListRow[]>(
        `/documents/${encodeURIComponent(slug)}/signatures`,
        {
          include_revoked: includeRevoked ? "true" : undefined,
        },
      );
      if (conditionalOnly) rows = rows.filter((r) => r.signature?.conditional === true);

      return render(parsed, rows, () =>
        joinBlocks(
          rows.length === 0
            ? renderObject({ signatures: "0 signatures found" })
            : renderList("signatures", rows, [
                computed("person", (r) => r.person),
                computed("name", (r) => r.name),
                computed("capacity", (r) => r.signature?.capacity ?? ""),
                computed("conditional", (r) => r.signature?.conditional ?? false),
                computed("revoked", (r) => r.signature?.revoked ?? false),
                // `specs/api/admin-cli.md`: each signature carries the
                // version it is attached to and whether that version is
                // behind the document's current one.
                computed("version", (r) => r.signature?.signed_on_version ?? ""),
                computed("behind", (r) => r.behind ?? false),
                computed("signed_at", (r) => r.signature?.signed_at ?? ""),
              ]),
        ),
      );
    }

    case "revoke": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        'drafter-axi signatures revoke <slug> <person> --reason "..."',
      );
      const person = requirePositional(
        parsed,
        1,
        "person",
        'drafter-axi signatures revoke <slug> <person> --reason "..."',
      );
      const reason = requireStr(
        parsed,
        "--reason",
        'drafter-axi signatures revoke <slug> <person> --reason "..."',
      );
      const result = await client.post<RevokeSignatureResult>(
        `/documents/${encodeURIComponent(slug)}/signatures/${encodeURIComponent(person)}/revoke`,
        { reason },
      );
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(result),
          renderHelp([`Run \`drafter-axi signatures list ${slug}\` to confirm`]),
        ),
      );
    }

    default:
      return sub; // unreachable
  }
}
