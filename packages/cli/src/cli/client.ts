import type { SignatoriesConfig } from "./config.js";
import { writeProfile } from "./config.js";
import { ApiCallError, NetworkError, SignInExpiredError } from "./errors.js";
import { decodeJwtIatSeconds } from "./jwt.js";

/** `specs/api/conventions.md` § Responses — the JSON error envelope. */
interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

interface RequestOptions {
  body?: unknown;
  /** Sent as-is with the given content type instead of JSON-encoding `body`. */
  raw?: { text: string; contentType: string };
  query?: Record<string, string | undefined>;
}

interface RefreshResponse {
  token: string;
  expires_at: string;
  email: string;
}

/** `specs/behaviors/operators.md` § Sessions: "The CLI refreshes it silently when it is older than 30 days". */
const REFRESH_AFTER_DAYS = 30;

/**
 * Whichever of these two codes the API returns for a bad bearer token, the
 * CLI shows one fixed sentence (`SignInExpiredError`) instead — the
 * distinction (revoked vs. never valid vs. deactivated) isn't actionable
 * for the person at the keyboard; the fix is the same either way.
 */
const REAUTH_CODES = new Set(["unauthenticated", "operator_inactive"]);

/**
 * Thin typed client over `/admin/api/*` (`specs/api/admin.md`,
 * `specs/api/conventions.md`). Every write carries the bearer token.
 * Errors are translated into `ApiCallError` (the API's own
 * `{ error, message, details }` envelope), `SignInExpiredError` (a bad or
 * revoked token), or `NetworkError` (transport failure) — `cli.ts` maps
 * each to the CLI's exit code.
 */
export class SignatoriesClient {
  private config: SignatoriesConfig;
  private refreshChecked = false;

  constructor(config: SignatoriesConfig) {
    this.config = config;
  }

  /**
   * `specs/behaviors/operators.md` § CLI sign-in: "The CLI refreshes it
   * silently when it is older than 30 days by calling `POST /auth/refresh`
   * with the current token; a refresh is refused for an inactive
   * operator." Runs at most once per `SignatoriesClient` instance (i.e. once
   * per CLI invocation), and only for a token that came from the profile
   * file — a `SIGNATORIES_TOKEN` override is never rewritten anywhere.
   */
  private async ensureFreshToken(): Promise<void> {
    if (this.refreshChecked) return;
    this.refreshChecked = true;
    if (this.config.tokenSource !== "profile") return;

    const iat = decodeJwtIatSeconds(this.config.token);
    if (iat === undefined) return;
    const ageDays = (Date.now() / 1000 - iat) / 86400;
    if (ageDays < REFRESH_AFTER_DAYS) return;

    let response: Response;
    try {
      response = await fetch(`${this.config.url}/auth/refresh`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.token}` },
      });
    } catch (error) {
      throw new NetworkError(
        `could not reach ${this.config.url} to refresh the sign-in token: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new SignInExpiredError();
    }

    const refreshed = (await response.json()) as RefreshResponse;
    this.config.token = refreshed.token;
    writeProfile(this.config.profile, {
      url: this.config.url,
      token: refreshed.token,
      email: refreshed.email,
      expires_at: refreshed.expires_at,
    });
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    await this.ensureFreshToken();

    // `specs/api/conventions.md`: "All routes under `/admin/api`" — every
    // client method's `path` is relative to that (`/documents`, not
    // `/admin/api/documents`), so it's added exactly once, here.
    const url = new URL(`${this.config.url}/admin/api${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.token}`,
    };

    let body: string | undefined;
    if (options.raw) {
      body = options.raw.text;
      headers["content-type"] = options.raw.contentType;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["content-type"] = "application/json; charset=utf-8";
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (error) {
      throw new NetworkError(
        `could not reach ${this.config.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as ApiErrorBody;
        if (REAUTH_CODES.has(payload.error)) throw new SignInExpiredError();
        throw new ApiCallError(payload.error, payload.message, payload.details ?? {});
      }
      const text = await response.text();
      throw new ApiCallError("internal_error", text || `HTTP ${response.status}`);
    }

    if (response.status === 204) return undefined as unknown as T;
    if (contentType.includes("text/csv") || contentType.includes("text/markdown")) {
      return (await response.text()) as unknown as T;
    }
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  /** POST with a pre-serialized text body (NDJSON import) instead of a JSON-encoded object. */
  postText<T>(path: string, text: string, contentType: string): Promise<T> {
    return this.request<T>("POST", path, { raw: { text, contentType } });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
