import { AxiError } from "axi-sdk-js";

import { DeviceExpiredError, NetworkError } from "./errors.js";

/** `specs/api/auth.md` § Device-code flow. */
export interface DeviceStart {
  device_code: string;
  user_code: string;
  expires_in: number;
  interval: number;
}

export interface DeviceToken {
  token: string;
  expires_at: string;
  email: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(
      `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

/** `POST /auth/device` — kicks off the device-code flow for `email` against `instanceUrl`. */
export async function startDeviceLogin(instanceUrl: string, email: string): Promise<DeviceStart> {
  const response = await postJson(`${instanceUrl}/auth/device`, { email });
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new AxiError(body.message ?? `HTTP ${response.status}`, "USAGE", []);
  }
  return (await response.json()) as DeviceStart;
}

export interface PollOptions {
  /** Overrides the server's advertised poll interval — test-only. */
  intervalMs?: number;
  /** Overrides the 15-minute ceiling — test-only. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `specs/behaviors/operators.md` § CLI sign-in: "polls `POST
 * /auth/device/token` with the `device_code` every 3 seconds for up to 15
 * minutes; once approved it receives the 90-day CLI token." Polls
 * immediately (no initial delay) so a code approved before the first poll
 * resolves right away, then waits `interval` between subsequent attempts.
 */
export async function pollDeviceToken(
  instanceUrl: string,
  deviceCode: string,
  serverIntervalSeconds: number,
  options: PollOptions = {},
): Promise<DeviceToken> {
  const intervalMs = options.intervalMs ?? serverIntervalSeconds * 1000;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const response = await postJson(`${instanceUrl}/auth/device/token`, {
      device_code: deviceCode,
    });
    if (response.ok) return (await response.json()) as DeviceToken;

    const body = await readErrorBody(response);
    if (response.status === 409 && body.error === "device_pending") {
      if (Date.now() >= deadline) {
        throw new DeviceExpiredError(
          "Timed out waiting for the device to be approved (15 minutes). Run `signatories-axi login` again.",
        );
      }
      await sleep(intervalMs);
      continue;
    }

    // 404 (unknown/expired code) or anything else unexpected — the device
    // code is done for, one way or another.
    throw new DeviceExpiredError(
      body.message ??
        "The device code is unknown or has expired. Run `signatories-axi login` again.",
    );
  }
}
