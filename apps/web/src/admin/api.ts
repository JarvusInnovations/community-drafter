import {
  type ActivityEntry,
  type DocumentDetail,
  type DocumentSummary,
  type InvitationRow,
  type NotificationsHealth,
  type OperatorRecord,
  type SessionInfo,
  type SiteRow,
  type SubmissionView,
  type VersionDetail,
  type VersionListItem,
} from "./types.ts";

/**
 * Thrown for any non-2xx response from `/admin/api/*` or `/auth/*`. Mirrors
 * `participant/api.ts`'s `ApiError` so error handling reads the same way
 * across both apps.
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

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `specs/api/conventions.md`: cookie-authenticated admin writes require the
 * custom `X-Requested-With: drafter` header (`gateway.ts`'s CSRF check).
 * Every write from this client carries it; bearer/CLI traffic is a
 * different client entirely (`admin-cli`), so there's no case here where
 * this header is wrong to send.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (WRITE_METHODS.has(method)) {
    headers.set("x-requested-with", "drafter");
  }

  const response = await fetch(path, { ...init, headers, credentials: "include" });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorBody = isJson
      ? (body as { error?: string; message?: string; details?: Record<string, unknown> })
      : undefined;
    throw new ApiError(
      response.status,
      errorBody?.error ?? "unknown_error",
      errorBody?.message ?? (typeof body === "string" ? body : "Something went wrong."),
      errorBody?.details ?? {},
    );
  }

  return body as T;
}

const BASE = "/admin/api";

export function getSession(): Promise<SessionInfo> {
  return request<SessionInfo>("/auth/session");
}

export function logout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

/**
 * `POST /auth/login` — `specs/screens/admin-dashboard.md` § Sign-in: always
 * 202s regardless of whether the address is an operator, so this never
 * throws for an unrecognized email; the login screen shows the same
 * non-disclosing sentence either way.
 */
export function requestLogin(email: string, returnPath?: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(returnPath ? { email, return: returnPath } : { email }),
  });
}

/** `POST /auth/device/approve` — the device-approval page. */
export function approveDevice(userCode: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/device/approve", {
    method: "POST",
    body: JSON.stringify({ user_code: userCode }),
  });
}

/**
 * `specs/api/admin.md` § Operators — the **resolved site's** operator group
 * (`specs/behaviors/sites.md` § Operators and tenancy), not every operator
 * on the instance.
 */
export function listOperators(): Promise<OperatorRecord[]> {
  return request<OperatorRecord[]>(`${BASE}/operators`);
}

/** `specs/api/admin.md` § Sites — the caller's sites (every site for a superadmin). */
export function listSites(): Promise<SiteRow[]> {
  return request<SiteRow[]>(`${BASE}/sites`);
}

export interface CreateOperatorInput {
  email: string;
  name: string;
  kind?: "person" | "bot";
  title?: string;
  org?: string;
  notes?: string;
}

export function createOperator(input: CreateOperatorInput): Promise<OperatorRecord> {
  return request<OperatorRecord>(`${BASE}/operators`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface UpdateOperatorInput {
  name?: string;
  active?: boolean;
  title?: string;
  org?: string;
  notes?: string;
}

export function updateOperator(email: string, input: UpdateOperatorInput): Promise<OperatorRecord> {
  return request<OperatorRecord>(`${BASE}/operators/${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function removeOperator(email: string): Promise<{ ok: boolean; commit: string | null }> {
  return request(`${BASE}/operators/${encodeURIComponent(email)}`, { method: "DELETE" });
}

/** The document's own operator membership (`specs/screens/admin-dashboard.md` § "Operators of this document"). */
export function getDocumentOperators(slug: string): Promise<OperatorRecord[]> {
  return request<OperatorRecord[]>(`${BASE}/documents/${encodeURIComponent(slug)}/operators`);
}

export function addDocumentOperator(
  slug: string,
  email: string,
): Promise<OperatorRecord & { added: boolean }> {
  return request(`${BASE}/documents/${encodeURIComponent(slug)}/operators`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function removeDocumentOperator(
  slug: string,
  email: string,
): Promise<{ ok: boolean; removed: boolean; commit: string | null }> {
  return request(
    `${BASE}/documents/${encodeURIComponent(slug)}/operators/${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
}

export function listDocuments(): Promise<DocumentSummary[]> {
  return request<DocumentSummary[]>(`${BASE}/documents`);
}

export function getDocument(slug: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`${BASE}/documents/${encodeURIComponent(slug)}`);
}

export interface ScheduleInput {
  comments_close_at?: string;
  signing_closes_at?: string;
}

export function extendDeadline(slug: string, body: ScheduleInput): Promise<DocumentDetail> {
  return request<DocumentDetail>(`${BASE}/documents/${encodeURIComponent(slug)}/schedule`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getInvitations(
  slug: string,
  query: { status?: string; source?: string; q?: string } = {},
): Promise<InvitationRow[]> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.source) {
    params.set("source", query.source);
  }
  if (query.q) {
    params.set("q", query.q);
  }
  const qs = params.toString();
  return request<InvitationRow[]>(
    `${BASE}/documents/${encodeURIComponent(slug)}/invitations${qs ? `?${qs}` : ""}`,
  );
}

/** The only read path for tokens — returns the CSV text, recorded server-side as an admin event. */
export function exportLinks(slug: string, person?: string[]): Promise<string> {
  return request<string>(`${BASE}/documents/${encodeURIComponent(slug)}/invitations/links`, {
    method: "POST",
    body: JSON.stringify(person && person.length > 0 ? { person } : {}),
  });
}

export function copyPersonalLink(
  slug: string,
  person: string,
): Promise<{ link: string; name: string; email: string }> {
  return exportLinks(slug, [person]).then((csv) => {
    const [, dataLine] = csv.trim().split("\n");
    const [, name, email, link] = (dataLine ?? "").split(",");
    return { link: link ?? "", name: name ?? "", email: email ?? "" };
  });
}

export function revokeLink(
  slug: string,
  person: string,
): Promise<{ revoked: boolean; commit: string | null }> {
  return request(
    `${BASE}/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(person)}/revoke-link`,
    {
      method: "POST",
    },
  );
}

export function reissueLink(
  slug: string,
  person: string,
): Promise<{ link: string; commit: string | null }> {
  return request(
    `${BASE}/documents/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(person)}/reissue-link`,
    { method: "POST" },
  );
}

export function revokeSignature(
  slug: string,
  person: string,
  reason: string,
): Promise<{ commit: string | null }> {
  return request(
    `${BASE}/documents/${encodeURIComponent(slug)}/signatures/${encodeURIComponent(person)}/revoke`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function getSubmissions(
  slug: string,
  query: {
    state?: "submitted" | "draft" | "all";
    disposition?: string;
    version?: string;
    person?: string;
  } = {},
): Promise<SubmissionView[]> {
  const params = new URLSearchParams();
  if (query.state) {
    params.set("state", query.state);
  }
  if (query.disposition) {
    params.set("disposition", query.disposition);
  }
  if (query.version) {
    params.set("version", query.version);
  }
  if (query.person) {
    params.set("person", query.person);
  }
  const qs = params.toString();
  return request<SubmissionView[]>(
    `${BASE}/documents/${encodeURIComponent(slug)}/submissions${qs ? `?${qs}` : ""}`,
  );
}

export function feedbackExportUrl(slug: string): string {
  return `${BASE}/documents/${encodeURIComponent(slug)}/feedback-export`;
}

export function getVersions(slug: string): Promise<VersionListItem[]> {
  return request<VersionListItem[]>(`${BASE}/documents/${encodeURIComponent(slug)}/versions`);
}

export function getVersionDetail(slug: string, n: number): Promise<VersionDetail> {
  return request<VersionDetail>(`${BASE}/documents/${encodeURIComponent(slug)}/versions/${n}`);
}

export function getActivity(slug: string, limit = 50): Promise<ActivityEntry[]> {
  return request<ActivityEntry[]>(
    `${BASE}/documents/${encodeURIComponent(slug)}/activity?limit=${limit}`,
  );
}

export function getNotifications(slug: string): Promise<NotificationsHealth> {
  return request<NotificationsHealth>(
    `${BASE}/documents/${encodeURIComponent(slug)}/notifications`,
  );
}

/** `specs/screens/admin-dashboard.md` § "View as" — reuses the participant bundle shape. */
export function getViewAsBundle(slug: string, person: string): Promise<unknown> {
  return request(
    `${BASE}/documents/${encodeURIComponent(slug)}/participations/${encodeURIComponent(person)}/bundle`,
  );
}
