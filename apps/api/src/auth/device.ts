import { randomBytes } from "node:crypto";

/**
 * `specs/behaviors/operators.md` § CLI sign-in: device code — an in-memory
 * pending-code store (`specs/architecture.md` § Storage: "Magic-link nonces
 * and pending device codes are short-lived in-memory state whose loss on
 * restart only costs a retry"). `deviceCode` is the CLI's secret polling
 * credential; `userCode` is the short string a human reads and approves.
 */
export interface PendingDevice {
  deviceCode: string;
  userCode: string;
  createdAt: number;
  expiresAt: number;
  approvedEmail?: string;
}

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const DEVICE_TTL_MS = 15 * 60 * 1000;
export const DEVICE_POLL_INTERVAL_SECONDS = 3;

function randomUserCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[randomBytes(1)[0]! % USER_CODE_ALPHABET.length];
  }
  return out;
}

export class DeviceCodeStore {
  private readonly byDeviceCode = new Map<string, PendingDevice>();
  private readonly byUserCode = new Map<string, string>();

  create(ttlMs = DEVICE_TTL_MS): PendingDevice {
    const now = Date.now();
    const pending: PendingDevice = {
      deviceCode: randomBytes(24).toString("base64url"),
      userCode: randomUserCode(),
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.byDeviceCode.set(pending.deviceCode, pending);
    this.byUserCode.set(pending.userCode, pending.deviceCode);
    return pending;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [deviceCode, pending] of this.byDeviceCode) {
      if (pending.expiresAt <= now) {
        this.byDeviceCode.delete(deviceCode);
        this.byUserCode.delete(pending.userCode);
      }
    }
  }

  findByUserCode(userCode: string): PendingDevice | undefined {
    this.sweep();
    const deviceCode = this.byUserCode.get(userCode.toUpperCase());
    return deviceCode ? this.byDeviceCode.get(deviceCode) : undefined;
  }

  /** Binds the pending code to the approving operator's email. Returns `false` for an unknown/expired code. */
  approve(userCode: string, email: string): boolean {
    const pending = this.findByUserCode(userCode);
    if (!pending) return false;
    pending.approvedEmail = email;
    return true;
  }

  /** `undefined` = unknown or expired; otherwise the pending record (approved or not). */
  get(deviceCode: string): PendingDevice | undefined {
    this.sweep();
    return this.byDeviceCode.get(deviceCode);
  }

  /** Test-only: drop every pending code so cases don't leak into one another. */
  clear(): void {
    this.byDeviceCode.clear();
    this.byUserCode.clear();
  }
}
