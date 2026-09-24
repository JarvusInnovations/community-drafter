import { clearProfileToken, resolveLoginUrl, resolveProfileName, writeProfile } from "../config.js";
import { pollDeviceToken, startDeviceLogin } from "../device-login.js";
import { parseFlags, requirePositional, str, type FlagSpec } from "../flags.js";
import { joinBlocks, renderHelp, renderObject } from "../output.js";
import type { WhoAmI } from "../types.js";
import { clientFrom, render } from "./common.js";

const LOGIN_FLAGS: FlagSpec = { positionals: 1, value: ["--url"] };
const LOGOUT_FLAGS: FlagSpec = { positionals: 0 };
const WHOAMI_FLAGS: FlagSpec = { positionals: 0 };

export const LOGIN_HELP = `usage: signatories-axi login <email> [--url <instance>]

Device-code sign-in. Resolves the instance from --url, else SIGNATORIES_URL, else
fails with exit 2. Sends the operator a magic-link email whose return path
approves this device, prints the user code to watch for, then polls until
approved (or the code expires — 15 minutes). On success, writes the instance
url, the operator's email and a 90-day token to
~/.config/signatories/<profile>.toml (mode 600); every later command reads from
there unless SIGNATORIES_URL/SIGNATORIES_TOKEN are set.`;

export const LOGOUT_HELP = `usage: signatories-axi logout

Forgets the stored sign-in token for this profile (url/email are kept).`;

export const WHOAMI_HELP = `usage: signatories-axi whoami

Shows the signed-in operator (email, kind) and the token's expiry.`;

/**
 * `specs/behaviors/operators.md` § CLI sign-in: device code. The user code
 * and the "check your email" line are written straight to the real
 * `process.stdout` — not the string this command returns — because they
 * must appear *before* the (potentially minutes-long) poll resolves; the
 * SDK only writes a command's return value once, at the end
 * (`axi-sdk-js`'s `runAxiCli`).
 */
export async function loginCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("login", args, LOGIN_FLAGS);
  const email = requirePositional(
    parsed,
    0,
    "email",
    "signatories-axi login <email> [--url <instance>]",
  )
    .trim()
    .toLowerCase();
  const profile = resolveProfileName(str(parsed, "--profile"));
  const url = resolveLoginUrl(str(parsed, "--url"));

  const start = await startDeviceLogin(url, email);
  process.stdout.write(
    `user_code: ${start.user_code}\n` +
      `Check your email for the sign-in link, then approve this device.\n`,
  );

  const token = await pollDeviceToken(url, start.device_code, start.interval);
  writeProfile(profile, {
    url,
    email: token.email,
    token: token.token,
    expires_at: token.expires_at,
  });

  return render(parsed, token, () =>
    joinBlocks(
      renderObject({ signed_in_as: token.email, url, expires_at: token.expires_at }),
      renderHelp([
        "Run `signatories-axi whoami` to confirm",
        "Run `signatories-axi` to see your documents",
      ]),
    ),
  );
}

export async function logoutCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("logout", args, LOGOUT_FLAGS);
  const profile = resolveProfileName(str(parsed, "--profile"));
  const cleared = clearProfileToken(profile);
  return render(parsed, { signed_out: cleared }, () => renderObject({ signed_out: cleared }));
}

export async function whoamiCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("whoami", args, WHOAMI_FLAGS);
  const client = clientFrom(parsed);
  const info = await client.get<WhoAmI>("/whoami");
  return render(parsed, info, () => renderObject(info));
}
