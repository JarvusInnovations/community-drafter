import { parseFlags, type FlagSpec } from "../flags.js";
import { renderObject } from "../output.js";
import { clientFrom, render } from "./common.js";

const INIT_DATA_REPO_FLAGS: FlagSpec = { positionals: 0 };

export const INIT_DATA_REPO_HELP = `usage: signatories-axi init-data-repo

First-boot helper: writes the four sheet configs into an empty data repo.
Refuses if sheets already exist.`;

export async function initDataRepoCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("init-data-repo", args, INIT_DATA_REPO_FLAGS);
  const client = clientFrom(parsed);
  const result = await client.post<Record<string, unknown>>("/init-data-repo");
  return render(parsed, result, () => renderObject(result));
}
