import { randomBytes } from "node:crypto";

/**
 * `specs/behaviors/access-and-identity.md` § Admin access: "Google OAuth
 * with an allowlist ..., HMAC-signed session cookie, 24-hour lifetime."
 * The cookie carries only a session id — this in-memory map is the
 * authority (`jarvus-fastify` authentication reference: "JWT as format,
 * database as authority"). Single-instance only, as the plan specifies:
 * logout/revocation drop the row here, so a restart or a second instance
 * would not share sessions. That's an accepted phase-1 limitation, not an
 * oversight.
 */
export interface Session {
  id: string;
  email: string;
  name?: string;
  createdAt: number;
  expiresAt: number;
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(email: string, name?: string, ttlMs = SESSION_TTL_MS): Session {
    const id = randomBytes(24).toString("base64url");
    const now = Date.now();
    const session: Session = { id, email, name, createdAt: now, expiresAt: now + ttlMs };
    this.sessions.set(id, session);
    return session;
  }

  /** Returns the live session, or `null` if missing/expired (expired rows are dropped). */
  get(id: string): Session | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  revoke(id: string): void {
    this.sessions.delete(id);
  }

  /** Test-only: drop every session so cases don't leak into one another. */
  clear(): void {
    this.sessions.clear();
  }
}
