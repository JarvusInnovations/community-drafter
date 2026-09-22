import { type CitationsMode } from "../lib/citations.ts";
import {
  type Bundle,
  type Capacity,
  type CompareResult,
  type DraftCommentCreateResult,
  type DraftCommentSaveResult,
  type RebaseResult,
  type SignatureView,
  type SubmissionJudgement,
  type SubmissionView,
  type SubmitResult,
  type VersionDetail,
} from "./types.ts";

/**
 * Thrown for any non-2xx response from `/i/:token/api/*`. Carries the JSON
 * error envelope (`specs/api/conventions.md` § Responses) so callers can
 * branch on `code` (e.g. `phase_closed`, `attestation_required`) and read
 * `details` (e.g. the deadline that closed the phase).
 */
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

async function request<T>(
  path: string,
  init: RequestInit & { idempotent?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init.idempotent && !headers.has("idempotency-key")) {
    headers.set("idempotency-key", crypto.randomUUID());
  }

  const response = await fetch(path, { ...init, headers, credentials: "omit" });

  if (response.status === 204) {
    return undefined as T;
  }

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

function base(token: string): string {
  return `/i/${encodeURIComponent(token)}/api`;
}

export function getBundle(token: string, version?: number): Promise<Bundle> {
  const query = version !== undefined ? `?v=${version}` : "";
  return request<Bundle>(`${base(token)}/bundle${query}`);
}

/**
 * `specs/api/participant.md` § `GET /i/:token/api/versions/:n`. `citations`
 * is how the reader's "Sources as footnotes" preference reaches the render
 * (`specs/behaviors/versioning.md` § Citations); omitted, the server renders
 * `links`, which is what the bundle already carried.
 */
export function getVersion(
  token: string,
  n: number,
  citations?: CitationsMode,
): Promise<VersionDetail> {
  const query = citations && citations !== "links" ? `?citations=${citations}` : "";
  return request<VersionDetail>(`${base(token)}/versions/${n}${query}`);
}

export function getCompare(token: string, from: number, to: number): Promise<CompareResult> {
  return request<CompareResult>(`${base(token)}/compare?from=${from}&to=${to}`);
}

export interface SignatureInput {
  capacity: Capacity;
  display_name: string;
  descriptor?: string;
  org?: string;
  title?: string;
  authorized?: boolean;
  listed?: boolean;
  version?: number;
}

export function postSignature(token: string, body: SignatureInput): Promise<SignatureView> {
  return request<SignatureView>(`${base(token)}/signature`, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: true,
  });
}

export interface SignaturePatchInput {
  display_name?: string;
  descriptor?: string;
  org?: string;
  title?: string;
  authorized?: boolean;
  listed?: boolean;
  confirm?: boolean;
}

export function patchSignature(token: string, body: SignaturePatchInput): Promise<SignatureView> {
  return request<SignatureView>(`${base(token)}/signature`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSignature(token: string, reason?: string): Promise<SignatureView> {
  return request<SignatureView>(`${base(token)}/signature`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function postDecline(token: string, reason?: string): Promise<{ declined_at: string }> {
  return request<{ declined_at: string }>(`${base(token)}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** `specs/api/participant.md` § Draft submission endpoints. */
export function getDraft(token: string): Promise<SubmissionView | null> {
  return request<SubmissionView | null>(`${base(token)}/draft`);
}

export interface DraftCommentInput {
  version: number;
  anchor?: unknown;
  body: string;
  client_id: string;
}

export function postDraftComment(
  token: string,
  body: DraftCommentInput,
): Promise<DraftCommentCreateResult> {
  return request<DraftCommentCreateResult>(`${base(token)}/draft/comments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface DraftCommentPatchInput {
  body: string;
  anchor?: unknown;
  base_saved_at?: string;
}

export function putDraftComment(
  token: string,
  id: string,
  body: DraftCommentPatchInput,
): Promise<DraftCommentSaveResult> {
  return request<DraftCommentSaveResult>(
    `${base(token)}/draft/comments/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      idempotent: true,
    },
  );
}

export function deleteDraftComment(token: string, id: string): Promise<void> {
  return request<void>(`${base(token)}/draft/comments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function postRebase(token: string, toVersion: number): Promise<RebaseResult> {
  return request<RebaseResult>(`${base(token)}/draft/rebase`, {
    method: "POST",
    body: JSON.stringify({ to_version: toVersion }),
  });
}

export interface SubmitInput {
  version: number;
  judgement: SubmissionJudgement;
  pending: number;
  reason?: string;
  signature?: {
    capacity: Capacity;
    display_name: string;
    descriptor?: string;
    org?: string;
    title?: string;
    authorized?: boolean;
    listed?: boolean;
  };
}

export function postSubmit(token: string, body: SubmitInput): Promise<SubmitResult> {
  return request<SubmitResult>(`${base(token)}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: true,
  });
}
