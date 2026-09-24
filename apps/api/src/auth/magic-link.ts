import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `specs/api/auth.md` § `POST /auth/login`: the emailed link carries a
 * 24-character base62 **code**, 6 characters of expiry and 18 of HMAC-SHA256
 * (keyed with `AUTH_SECRET`) over the site, the operator's id and email, the
 * expiry and the return path. The link proves itself, so honoring it needs
 * no server state and survives the instance that sent it being stopped
 * (`specs/architecture.md` § Deployment). Replaces an in-memory
 * code-to-token map that a scale-to-zero restart would have emptied.
 */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
export const MAGIC_CODE_LENGTH = 24;
export const DEFAULT_RETURN_PATH = "/admin";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const EXPIRY_LENGTH = 6;
const MAC_LENGTH = MAGIC_CODE_LENGTH - EXPIRY_LENGTH;
const CODE_PATTERN = /^[0-9A-Za-z]{24}$/u;

export interface MagicLinkSubject {
  /** The resolved site's slug: a link is good only on the host that sent it. */
  site: string;
  operatorId: string;
  operatorEmail: string;
  returnPath: string;
}

function toBase62(value: bigint, width: number): string {
  let out = "";
  let rest = value;
  while (rest > 0n) {
    out = ALPHABET[Number(rest % 62n)] + out;
    rest /= 62n;
  }
  return out.padStart(width, "0").slice(-width);
}

function fromBase62(text: string): bigint {
  let value = 0n;
  for (const char of text) value = value * 62n + BigInt(ALPHABET.indexOf(char));
  return value;
}

function mac(secret: string, subject: MagicLinkSubject, expiry: string): string {
  const digest = createHmac("sha256", secret)
    .update(
      [
        "signatories-magic-link-v1",
        subject.site,
        subject.operatorId,
        subject.operatorEmail.toLowerCase(),
        expiry,
        subject.returnPath,
      ].join("\n"),
    )
    .digest();
  // 256 bits is 43 base62 digits; the leading 18 carry ~107 bits.
  return toBase62(BigInt(`0x${digest.toString("hex")}`), 43).slice(0, MAC_LENGTH);
}

/** Signs a code that expires `MAGIC_LINK_TTL_SECONDS` after `now`. */
export function signMagicCode(
  secret: string,
  subject: MagicLinkSubject,
  now: Date = new Date(),
): { code: string; expiresAt: Date } {
  const expSeconds = Math.floor(now.getTime() / 1000) + MAGIC_LINK_TTL_SECONDS;
  const expiry = toBase62(BigInt(expSeconds), EXPIRY_LENGTH);
  return { code: expiry + mac(secret, subject, expiry), expiresAt: new Date(expSeconds * 1000) };
}

/**
 * The code's expiry when it is well-formed, carries the right MAC for
 * `subject` (compared in constant time) and has not expired; `null`
 * otherwise, for every reason alike.
 */
export function verifyMagicCode(
  secret: string,
  code: string,
  subject: MagicLinkSubject,
  now: Date = new Date(),
): Date | null {
  if (!CODE_PATTERN.test(code)) return null;
  const expiry = code.slice(0, EXPIRY_LENGTH);
  const expected = Buffer.from(mac(secret, subject, expiry));
  const presented = Buffer.from(code.slice(EXPIRY_LENGTH));
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  const expiresAt = new Date(Number(fromBase62(expiry)) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return expiresAt;
}

/** The emailed URL: `op` and `code` always, `return` only when it is not the default. */
export function magicLinkUrl(base: string, operatorId: string, code: string, returnPath: string) {
  const params = new URLSearchParams({ op: operatorId, code });
  if (returnPath !== DEFAULT_RETURN_PATH) params.set("return", returnPath);
  return `${base}/auth/callback?${params.toString()}`;
}
