import type { DrafterConfig } from "./config.js";
import { ApiCallError, NetworkError } from "./errors.js";

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

/**
 * Thin typed client over `/admin/api/*` (`specs/api/admin.md`,
 * `specs/api/conventions.md`). Every write carries the bearer token and the
 * resolved `X-Actor`. Errors are translated into `ApiCallError` (the API's
 * own `{ error, message, details }` envelope) or `NetworkError`
 * (transport failure) — `cli.ts` maps either to the CLI's exit code.
 */
export class DrafterClient {
  constructor(private readonly config: DrafterConfig) {}

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    // `specs/api/conventions.md`: "All routes under `/admin/api`" — every
    // client method's `path` is relative to that (`/documents`, not
    // `/admin/api/documents`), so it's added exactly once, here.
    const url = new URL(`${this.config.url}/admin/api${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.adminToken}`,
      "x-actor": this.config.actor,
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
}
