import { parseSubcommand, requirePositional, requireStr, str, type FlagSpec } from "../flags.js";
import { compact, computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { DnsRecord, SiteDetail, SiteOperator } from "../types.js";
import { clientFrom, render } from "./common.js";

const SITES_FLAGS: Record<string, FlagSpec> = {
  list: { positionals: 0 },
  show: { positionals: 1 },
  create: {
    positionals: 1,
    value: [
      "--hostname",
      "--name",
      "--reply-to",
      "--sender-name",
      "--sender-email",
      "--logo-url",
      "--accent",
    ],
  },
  update: {
    positionals: 1,
    value: ["--name", "--reply-to", "--sender-name", "--sender-email", "--logo-url", "--accent"],
  },
  remove: { positionals: 1 },
  operators: { positionals: 3 },
};

export const SITES_HELP = `usage: signatories-axi sites <list|show|create|update|remove|operators> ...

list
show <slug>
create <slug> --hostname <host> --name "<text>" --reply-to <email>
       [--sender-name "<text>"] [--sender-email <email>]
       [--logo-url https://…] [--accent '#0f62fe']       (superadmin)
update <slug> [--name "<text>"] [--reply-to <email>] [--sender-name "<text>"]
       [--sender-email <email>] [--logo-url https://…] [--accent '#0f62fe']  (superadmin)
remove <slug>                                             (superadmin)
operators <slug>
operators add <slug> <email>
operators remove <slug> <email>

A site is one hostname and the identity carried on it: a name, a sender, an
optional logo and accent, and the group of operators who work there. Every
document belongs to exactly one site, and every page, link and message that
document shows carries that site's identity and no other. A document that
names no site belongs to this deployment's own default site.

--hostname is deliberately absent from \`update\`: a site has exactly one
hostname, and a new one is a new site, because DNS, a certificate and every
link already sent are attached to the old one.

Creating the record routes nothing. The hostname must also be verified to
the project and mapped before it reaches the service; \`create\` prints every
DNS record the customer still has to add.`;

/** The "this record routes nothing" sentence, printed wherever DNS is. */
const ROUTES_NOTHING =
  "Creating this record routes nothing: the hostname must also be verified to the project and mapped before it reaches the service.";

function siteObject(site: SiteDetail): Record<string, unknown> {
  return compact({
    slug: site.slug,
    hostname: site.hostname,
    name: site.name,
    sender_name: site.sender_name,
    sender_email: site.sender_email,
    reply_to: site.reply_to,
    logo_url: site.logo_url,
    accent: site.accent,
    from_line: site.from_line,
    hostname_verified: site.hostname_verified,
    sender_verified: site.sender_verified === null ? "not observed yet" : site.sender_verified,
    operators: site.operators,
    documents: site.documents,
    commit: site.commit,
  });
}

function dnsBlock(records: DnsRecord[]): string {
  if (records.length === 0) return "";
  return renderList("dns_records", records, [
    computed<DnsRecord>("type", (r) => r.type),
    computed<DnsRecord>("name", (r) => r.name),
    computed<DnsRecord>("value", (r) => r.value),
    computed<DnsRecord>("purpose", (r) => r.purpose),
  ]);
}

export async function sitesCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("sites", args, SITES_FLAGS);
  const client = clientFrom(parsed);
  const cli = "signatories-axi";

  switch (sub) {
    case "list": {
      const sites = await client.get<SiteDetail[]>("/sites");
      return render(parsed, sites, () =>
        joinBlocks(
          sites.length === 0
            ? renderObject({ sites: "no sites found" })
            : renderList("sites", sites, [
                computed<SiteDetail>("slug", (s) => s.slug),
                computed<SiteDetail>("hostname", (s) => s.hostname ?? ""),
                computed<SiteDetail>("name", (s) => s.name),
                computed<SiteDetail>("from", (s) => s.from_line),
                computed<SiteDetail>("hostname_verified", (s) => s.hostname_verified),
                computed<SiteDetail>("sender_verified", (s) =>
                  s.sender_verified === null ? "not observed yet" : s.sender_verified,
                ),
                computed<SiteDetail>("operators", (s) => s.operators.length),
                computed<SiteDetail>("documents", (s) => s.documents),
              ]),
          renderHelp([`Run \`${cli} sites show <slug>\` for one site and the DNS it still needs`]),
        ),
      );
    }

    case "show": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi sites show <slug>");
      const site = await client.get<SiteDetail>(`/sites/${encodeURIComponent(slug)}`);
      const missing = site.hostname_verified ? [] : site.dns;
      return render(parsed, site, () =>
        joinBlocks(
          renderObject(siteObject(site)),
          dnsBlock(missing),
          renderHelp(
            missing.length > 0
              ? [ROUTES_NOTHING, `Run \`${cli} sites operators ${slug}\` for its operator group`]
              : [`Run \`${cli} sites operators ${slug}\` for its operator group`],
          ),
        ),
      );
    }

    case "create": {
      const usage =
        'signatories-axi sites create <slug> --hostname <host> --name "..." --reply-to <email>';
      const slug = requirePositional(parsed, 0, "slug", usage);
      const body = compact({
        slug,
        hostname: requireStr(parsed, "--hostname", usage),
        name: requireStr(parsed, "--name", usage),
        reply_to: requireStr(parsed, "--reply-to", usage),
        sender_name: str(parsed, "--sender-name"),
        sender_email: str(parsed, "--sender-email"),
        logo_url: str(parsed, "--logo-url"),
        accent: str(parsed, "--accent"),
      });
      const site = await client.post<SiteDetail>("/sites", body);
      return render(parsed, site, () =>
        joinBlocks(
          renderObject(siteObject(site)),
          dnsBlock(site.dns),
          renderHelp([
            ROUTES_NOTHING,
            site.sender_email
              ? "Take the DKIM and Return-Path values from the Postmark console (Sender Signatures → the domain); until that domain is verified, this site's mail fails per recipient rather than going out under the platform's address."
              : `This site's mail goes out from the platform address under the site's name until \`${cli} sites update ${slug} --sender-email …\` names a verified sender`,
            `Run \`${cli} docs create <slug> --site ${slug} …\` to start a document on it`,
          ]),
        ),
      );
    }

    case "update": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi sites update <slug> ...");
      const body = compact({
        name: str(parsed, "--name"),
        reply_to: str(parsed, "--reply-to"),
        sender_name: str(parsed, "--sender-name"),
        sender_email: str(parsed, "--sender-email"),
        logo_url: str(parsed, "--logo-url"),
        accent: str(parsed, "--accent"),
      });
      const site = await client.patch<SiteDetail>(`/sites/${encodeURIComponent(slug)}`, body);
      return render(parsed, site, () => renderObject(siteObject(site)));
    }

    case "remove": {
      const slug = requirePositional(parsed, 0, "slug", "signatories-axi sites remove <slug>");
      const result = await client.delete<{ ok: boolean; commit?: string | null }>(
        `/sites/${encodeURIComponent(slug)}`,
      );
      return render(parsed, result, () =>
        joinBlocks(
          renderObject(result),
          renderHelp([
            `Removed ${slug}. Its domain mapping is separate infrastructure and is removed in tf/.`,
          ]),
        ),
      );
    }

    case "operators": {
      const first = parsed.positional[0];
      if (first === "add" || first === "remove") {
        const usage = `signatories-axi sites operators ${first} <slug> <email>`;
        const slug = requirePositional(parsed, 1, "slug", usage);
        const email = requirePositional(parsed, 2, "email", usage);
        if (first === "add") {
          const result = await client.post<{ ok: boolean; added: boolean; operators: string[] }>(
            `/sites/${encodeURIComponent(slug)}/operators`,
            { email },
          );
          return render(parsed, result, () => renderObject(compact(result)));
        }
        const result = await client.delete<{ ok: boolean; removed: boolean }>(
          `/sites/${encodeURIComponent(slug)}/operators/${encodeURIComponent(email)}`,
        );
        return render(parsed, result, () =>
          joinBlocks(
            renderObject(result),
            renderHelp([
              `Removed ${email} from ${slug} only — their operator record and any other site they belong to are untouched.`,
            ]),
          ),
        );
      }

      const slug = requirePositional(parsed, 0, "slug", "signatories-axi sites operators <slug>");
      const operators = await client.get<SiteOperator[]>(
        `/sites/${encodeURIComponent(slug)}/operators`,
      );
      return render(parsed, operators, () =>
        operators.length === 0
          ? renderObject({ operators: "no operators found" })
          : renderList("operators", operators, [
              computed<SiteOperator>("email", (o) => o.email),
              computed<SiteOperator>("name", (o) => o.name),
              computed<SiteOperator>("kind", (o) => o.kind),
              computed<SiteOperator>("active", (o) => o.active),
              computed<SiteOperator>("superadmin", (o) => o.superadmin === true),
            ]),
      );
    }

    default:
      return sub; // unreachable — parseSubcommand already validated `sub`
  }
}
