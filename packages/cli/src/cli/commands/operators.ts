import { AxiError } from "axi-sdk-js";

import { parseSubcommand, requirePositional, requireStr, str, type FlagSpec } from "../flags.js";
import { compact, computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { OperatorMutationResult, OperatorRecord } from "../types.js";
import { clientFrom, render } from "./common.js";

const OPERATORS_FLAGS: Record<string, FlagSpec> = {
  list: { positionals: 0 },
  add: { positionals: 1, value: ["--name", "--kind", "--title", "--org", "--notes"] },
  update: {
    positionals: 1,
    value: ["--name", "--active", "--superadmin", "--title", "--org", "--notes"],
  },
  remove: { positionals: 1 },
};

export const OPERATORS_HELP = `usage: signatories-axi operators <list|add|update|remove> ...

list
add <email> --name "<text>" [--kind person|bot] [--title "<text>"] [--org "<text>"]
update <email> [--name "<text>"] [--active true|false] [--superadmin true|false] [--title "<text>"] [--org "<text>"] [--notes "<text>"]
remove <email>

This **site's** operator group (\`specs/behaviors/sites.md\`), not every
operator on the instance: the directory, and who may be added to one of this
site's documents. \`add\` creates the record if the email is new and joins it
to this site in the same commit; \`remove\` deletes the record outright and is
superadmin-only — to take someone off one site, use
\`signatories-axi sites operators remove <site> <email>\`.

A superadmin sees and may act on every document; only a superadmin can grant
or revoke the flag, and never on themself.
Every mutation prints the resulting record and the commit subject.`;

function operatorSchema() {
  return [
    computed<OperatorRecord>("email", (o) => o.email),
    computed<OperatorRecord>("name", (o) => o.name),
    computed<OperatorRecord>("kind", (o) => o.kind),
    computed<OperatorRecord>("active", (o) => o.active),
    computed<OperatorRecord>("superadmin", (o) => o.superadmin === true),
    computed<OperatorRecord>("title", (o) => o.title ?? ""),
    computed<OperatorRecord>("org", (o) => o.org ?? ""),
  ];
}

function parseBoolFlag(flag: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AxiError(`${flag} must be true or false`, "USAGE", [
    `signatories-axi operators update <email> ${flag} true|false`,
  ]);
}

export async function operatorsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("operators", args, OPERATORS_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "list": {
      const operators = await client.get<OperatorRecord[]>("/operators");
      return render(parsed, operators, () =>
        operators.length === 0
          ? renderObject({ operators: "no operators found" })
          : renderList("operators", operators, operatorSchema()),
      );
    }

    case "add": {
      const email = requirePositional(
        parsed,
        0,
        "email",
        'signatories-axi operators add <email> --name "..."',
      );
      const body = {
        email,
        name: requireStr(parsed, "--name", 'signatories-axi operators add <email> --name "..."'),
        kind: str(parsed, "--kind"),
        title: str(parsed, "--title"),
        org: str(parsed, "--org"),
        notes: str(parsed, "--notes"),
      };
      const result = await client.post<OperatorMutationResult>("/operators", body);
      return render(parsed, result, () => renderObject(compact(result)));
    }

    case "update": {
      const email = requirePositional(
        parsed,
        0,
        "email",
        "signatories-axi operators update <email> ...",
      );
      const body = compact({
        name: str(parsed, "--name"),
        active: parseBoolFlag("--active", str(parsed, "--active")),
        superadmin: parseBoolFlag("--superadmin", str(parsed, "--superadmin")),
        title: str(parsed, "--title"),
        org: str(parsed, "--org"),
        notes: str(parsed, "--notes"),
      });
      const result = await client.patch<OperatorMutationResult>(
        `/operators/${encodeURIComponent(email)}`,
        body,
      );
      return render(parsed, result, () => renderObject(compact(result)));
    }

    case "remove": {
      const email = requirePositional(
        parsed,
        0,
        "email",
        "signatories-axi operators remove <email>",
      );
      const result = await client.delete<{ ok: boolean; commit?: string | null }>(
        `/operators/${encodeURIComponent(email)}`,
      );
      return render(parsed, result, () =>
        joinBlocks(renderObject(result), renderHelp([`Removed ${email}`])),
      );
    }

    default:
      return sub; // unreachable — parseSubcommand already validated `sub`
  }
}
