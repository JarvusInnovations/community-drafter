import { type CitationsMode } from "../lib/citations.ts";
import { type CompareResult, type PublicBundle, type PublicVersionDetail } from "./types.ts";

/** Thrown for any non-2xx response from `/d/:slug/api/*`, same shape as `../participant/api.ts`'s. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "omit" });

  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  const body = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const errorBody = body as
      | { error?: string; message?: string; details?: Record<string, unknown> }
      | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error ?? "unknown_error",
      errorBody?.message ?? "Something went wrong.",
      errorBody?.details ?? {},
    );
  }

  return body as T;
}

function base(slug: string): string {
  return `/d/${encodeURIComponent(slug)}/api`;
}

export function getPublicBundle(slug: string, version?: number): Promise<PublicBundle> {
  const query = version !== undefined ? `?v=${version}` : "";
  return request<PublicBundle>(`${base(slug)}/bundle${query}`);
}

/**
 * `?citations=` carries the reader's "Sources as footnotes" preference to
 * the render (`specs/behaviors/versioning.md` § Citations); omitted, the
 * server renders `links`.
 */
export function getPublicVersion(
  slug: string,
  n: number,
  citations?: CitationsMode,
): Promise<PublicVersionDetail> {
  const query = citations && citations !== "links" ? `?citations=${citations}` : "";
  return request<PublicVersionDetail>(`${base(slug)}/versions/${n}${query}`);
}

export function getPublicCompare(slug: string, from: number, to: number): Promise<CompareResult> {
  return request<CompareResult>(`${base(slug)}/compare?from=${from}&to=${to}`);
}
