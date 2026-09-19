/**
 * Minimal RFC 4180 CSV encoding for the `export` mailer's mail-merge output
 * (`specs/architecture.md` § Outbound messaging: "a CSV of
 * `name,email,subject,link`") and the admin `invitations/links` /
 * `invitations/send` exports (`specs/api/admin.md`).
 */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
