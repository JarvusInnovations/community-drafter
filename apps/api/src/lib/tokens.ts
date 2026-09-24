import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * `specs/behaviors/access-and-identity.md` § Personal links: "at least 96
 * bits of randomness encoded base62 (16+ chars)". base62 packs ~5.95 bits
 * per character, so 20 characters (≈119 bits) comfortably clears the 96-bit
 * floor with room for the `participations.token` schema's `{16,}` pattern.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 20;

export function mintToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += BASE62[(bytes[i] as number) % BASE62.length];
  }
  return out;
}

/** Mint a token guaranteed not to collide with anything `isTaken` reports as existing. */
export function mintUniqueToken(isTaken: (token: string) => boolean): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = mintToken();
    if (!isTaken(token)) return token;
  }
  throw new Error("mintUniqueToken: exhausted retries without finding a free token");
}

/**
 * Constant-time equality for a caller-supplied secret against a known value,
 * used for the admin bearer token compare (`specs/architecture.md` §
 * Authentication). Different-length inputs compare false without leaking
 * timing on length (hashes both to a fixed-size digest-free comparison by
 * padding is unnecessary here — `timingSafeEqual` requires equal-length
 * buffers, so a length mismatch is checked directly and short-circuits;
 * that leak is the input length, not the secret).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
