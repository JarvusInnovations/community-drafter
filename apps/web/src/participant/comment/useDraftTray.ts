import { type Anchor } from "@community-drafter/shared/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  deleteDraftComment,
  getDraft,
  postDraftComment,
  postRebase,
  putDraftComment,
} from "../api.ts";
import { type RebasePlacement } from "../types.ts";
import { CommentBuffer } from "./buffer.ts";

export type CommentStatus = "restored" | "saving" | "saved" | "retrying" | "error";

export interface TrayComment {
  /** Stable UI key: the server comment id once created, else a client-minted id. */
  id: string;
  serverId?: string;
  anchor?: Anchor;
  body: string;
  status: CommentStatus;
  savedAt?: string;
  /** Set once, after a 409 stale_edit adopts the server's newer copy. */
  conflictNote?: string;
  /** Set after a rebase when the anchor's passage could no longer be found. */
  unplaced?: boolean;
}

/** The general comment — "a comment with no anchor" — always keyed the same way. */
const GENERAL_ID = "general";

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
const GENERAL_DEBOUNCE_MS = 3_000;

function mintLocalId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function bufferKeyFor(item: TrayComment): string {
  return item.serverId ?? item.id;
}

export interface UseDraftTrayOptions {
  token: string;
  documentSlug: string;
  person: string;
  /** The version currently displayed — used for a brand-new comment's anchor/version. */
  version: number;
  /** `phase === "commenting"` — draft saves are refused otherwise. */
  canSave: boolean;
  /** Test-only override for the retry backoff schedule. */
  retryDelaysMs?: number[];
  /** Test-only override for the general comment's debounce (ms). */
  generalDebounceMs?: number;
}

export interface UseDraftTrayResult {
  loading: boolean;
  /** The draft's own declared version, once one exists (may differ from `version` — the mismatch bar). */
  draftVersion: number | null;
  inlineComments: TrayComment[];
  general: TrayComment | null;
  /** Comments neither acknowledged by the server nor safely buffered (drives the submit-blocking count). */
  pendingCount: number;
  /** Anything a navigation-away warning should fire for. */
  hasUnsavedWork: boolean;
  addInline: (anchor: Anchor, body: string) => string;
  editComment: (id: string, body: string) => void;
  commitComment: (id: string) => void;
  removeComment: (id: string) => Promise<void>;
  editGeneral: (body: string) => void;
  rebase: (toVersion: number) => Promise<RebasePlacement[]>;
  markUnplaced: (placements: RebasePlacement[]) => void;
  reload: () => Promise<void>;
}

/**
 * The three-layer save path (`specs/behaviors/review-and-judgement.md`):
 * every keystroke buffers locally; "Add" or leaving a composer with text
 * (or, for the general comment, a 3s pause) saves to the server; the server
 * acknowledges only once the commit lands, and only then is the buffer
 * entry cleared. A failed save keeps its buffer entry, shows "Not saved,
 * retrying" and retries with backoff — never discarding on failure.
 */
export function useDraftTray(opts: UseDraftTrayOptions): UseDraftTrayResult {
  const { token, documentSlug, person, version, canSave } = opts;
  const retryDelaysMs = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const generalDebounceMs = opts.generalDebounceMs ?? GENERAL_DEBOUNCE_MS;
  const buffer = useMemo(() => new CommentBuffer(documentSlug, person), [documentSlug, person]);

  const [loading, setLoading] = useState(true);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [items, setItems] = useState<Map<string, TrayComment>>(new Map());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const retryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const retryAttempts = useRef(new Map<string, number>());
  const generalDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);

  /**
   * Every mutation goes through here so `itemsRef.current` is authoritative
   * the instant this returns — not just after React's next render. Several
   * call sites (`load`, `addInline`) need to read the item they just wrote
   * *synchronously afterward* (to kick off its first save), and `setState`
   * updates aren't visible via a ref until a render has actually happened.
   */
  const updateItems = useCallback(
    (updater: (prev: Map<string, TrayComment>) => Map<string, TrayComment>) => {
      const next = updater(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
    },
    [],
  );

  const patchItem = useCallback(
    (id: string, patch: Partial<TrayComment>) => {
      updateItems((prev) => {
        const current = prev.get(id);
        if (!current) {
          return prev;
        }
        const next = new Map(prev);
        next.set(id, { ...current, ...patch });
        return next;
      });
    },
    [updateItems],
  );

  const clearRetry = useCallback((id: string) => {
    const timer = retryTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
    }
    retryTimers.current.delete(id);
    retryAttempts.current.delete(id);
  }, []);

  /** Saves (creates or updates) one item against the server; on failure, buffers stay and a retry is scheduled. */
  const performSave = useCallback(
    async (id: string) => {
      const item = itemsRef.current.get(id);
      if (!item || !canSave) {
        return;
      }

      patchItem(id, { status: "saving" });
      const bufferKey = bufferKeyFor(item);

      try {
        if (!item.serverId) {
          const result = await postDraftComment(token, {
            version,
            anchor: item.anchor,
            body: item.body,
            client_id: id,
          });
          if (!mounted.current) {
            return;
          }
          buffer.clear(bufferKey);
          patchItem(id, {
            serverId: result.id,
            status: "saved",
            savedAt: result.saved_at,
            conflictNote: undefined,
          });
          setDraftVersion(version);
        } else {
          const result = await putDraftComment(token, item.serverId, {
            body: item.body,
            anchor: item.anchor,
            base_saved_at: item.savedAt,
          });
          if (!mounted.current) {
            return;
          }
          buffer.clear(bufferKey);
          patchItem(id, { status: "saved", savedAt: result.saved_at, conflictNote: undefined });
        }
        clearRetry(id);
      } catch (err) {
        if (!mounted.current) {
          return;
        }
        if (err instanceof ApiError && err.code === "stale_edit") {
          // Conflict rule: a server copy never overwrites a newer local
          // edit — but here the *server* is the one reporting it's newer,
          // so we adopt its copy and tell the participant why.
          const serverComment = err.details.comment as
            | { body: string; saved_at: string }
            | undefined;
          if (serverComment) {
            buffer.clear(bufferKey);
            patchItem(id, {
              body: serverComment.body,
              status: "saved",
              savedAt: serverComment.saved_at,
              conflictNote:
                "This comment changed since you last saved — showing the latest version.",
            });
            clearRetry(id);
            return;
          }
        }
        patchItem(id, { status: "retrying" });
        const attempt = retryAttempts.current.get(id) ?? 0;
        const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 30_000;
        retryAttempts.current.set(id, attempt + 1);
        const timer = setTimeout(() => void performSave(id), delay);
        retryTimers.current.set(id, timer);
      }
    },
    [buffer, canSave, clearRetry, patchItem, retryDelaysMs, token, version],
  );

  const scheduleImmediateSave = useCallback(
    (id: string) => {
      clearRetry(id);
      void performSave(id);
    },
    [clearRetry, performSave],
  );

  // --- initial load + buffer restore ---
  const load = useCallback(async () => {
    setLoading(true);
    let serverDraft: Awaited<ReturnType<typeof getDraft>> = null;
    try {
      serverDraft = await getDraft(token);
    } catch {
      serverDraft = null;
    }
    if (!mounted.current) {
      return;
    }

    const next = new Map<string, TrayComment>();
    const seenServerIds = new Set<string>();

    for (const comment of serverDraft?.comments ?? []) {
      const key = comment.anchor ? comment.id : GENERAL_ID;
      seenServerIds.add(comment.id);
      const buffered = buffer.get(comment.id);
      const anchor = (comment.anchor as Anchor | null | undefined) ?? undefined;
      if (buffered && buffered.body !== comment.body) {
        next.set(key, {
          id: key,
          serverId: comment.id,
          anchor,
          body: buffered.body,
          status: "restored",
        });
      } else {
        next.set(key, {
          id: key,
          serverId: comment.id,
          anchor,
          body: comment.body,
          status: "saved",
          savedAt: comment.saved_at,
        });
      }
    }

    // Buffered items with no matching server comment yet — a create that
    // never got as far as an ack.
    for (const { id, entry } of buffer.list()) {
      if (seenServerIds.has(id) || next.has(id)) {
        continue;
      }
      next.set(id, {
        id,
        anchor: entry.anchor as Anchor | undefined,
        body: entry.body,
        status: "restored",
      });
    }

    itemsRef.current = next;
    setItems(next);
    setDraftVersion(serverDraft?.version ?? null);
    setLoading(false);

    for (const item of next.values()) {
      if (item.status === "restored") {
        scheduleImmediateSave(item.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, buffer]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // Captured once per effect run so the cleanup below reads the same Map
    // the effect saw, not whatever `.current` happens to hold by the time
    // it fires (the ref itself never changes identity across renders).
    const timers = retryTimers.current;
    const debounce = generalDebounce;
    return () => {
      mounted.current = false;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      if (debounce.current) {
        clearTimeout(debounce.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, documentSlug, person]);

  const addInline = useCallback(
    (anchor: Anchor, body: string): string => {
      const id = mintLocalId();
      const entry = { body, anchor, updatedAt: new Date().toISOString() };
      buffer.set(id, entry);
      updateItems((prev) => {
        const next = new Map(prev);
        next.set(id, { id, anchor, body, status: "restored" });
        return next;
      });
      scheduleImmediateSave(id);
      return id;
    },
    [buffer, scheduleImmediateSave, updateItems],
  );

  const editComment = useCallback(
    (id: string, body: string) => {
      const item = itemsRef.current.get(id);
      if (!item) {
        return;
      }
      buffer.set(bufferKeyFor(item), {
        body,
        anchor: item.anchor,
        updatedAt: new Date().toISOString(),
      });
      patchItem(id, { body });
    },
    [buffer, patchItem],
  );

  const commitComment = useCallback(
    (id: string) => {
      scheduleImmediateSave(id);
    },
    [scheduleImmediateSave],
  );

  const removeComment = useCallback(
    async (id: string) => {
      const item = itemsRef.current.get(id);
      if (!item) {
        return;
      }
      clearRetry(id);
      buffer.clear(bufferKeyFor(item));
      if (item.serverId) {
        try {
          await deleteDraftComment(token, item.serverId);
        } catch {
          // Best-effort: even if the delete request fails, drop it locally
          // rather than leave a comment the participant asked to remove.
        }
      }
      updateItems((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [buffer, clearRetry, token, updateItems],
  );

  const editGeneral = useCallback(
    (body: string) => {
      const existing = itemsRef.current.get(GENERAL_ID);
      const id = GENERAL_ID;
      if (!existing) {
        updateItems((prev) => {
          const next = new Map(prev);
          next.set(id, { id, body, status: "restored" });
          return next;
        });
      } else {
        patchItem(id, { body });
      }
      buffer.set(existing ? bufferKeyFor(existing) : id, {
        body,
        updatedAt: new Date().toISOString(),
      });

      if (generalDebounce.current) {
        clearTimeout(generalDebounce.current);
      }
      generalDebounce.current = setTimeout(() => scheduleImmediateSave(id), generalDebounceMs);
    },
    [buffer, generalDebounceMs, patchItem, scheduleImmediateSave, updateItems],
  );

  const rebase = useCallback(
    async (toVersion: number): Promise<RebasePlacement[]> => {
      const result = await postRebase(token, toVersion);
      setDraftVersion(result.version);
      const unplacedIds = new Set(
        result.comments.filter((placement) => !placement.placed).map((placement) => placement.id),
      );
      updateItems((prev) => {
        const next = new Map(prev);
        for (const [key, item] of next) {
          if (item.serverId && unplacedIds.has(item.serverId)) {
            next.set(key, { ...item, unplaced: true });
          } else if (item.serverId) {
            next.set(key, { ...item, unplaced: false });
          }
        }
        return next;
      });
      return result.comments;
    },
    [token, updateItems],
  );

  const markUnplaced = useCallback(
    (placements: RebasePlacement[]) => {
      const unplacedIds = new Set(placements.filter((p) => !p.placed).map((p) => p.id));
      updateItems((prev) => {
        const next = new Map(prev);
        for (const [key, item] of next) {
          if (item.serverId) {
            next.set(key, { ...item, unplaced: unplacedIds.has(item.serverId) });
          }
        }
        return next;
      });
    },
    [updateItems],
  );

  // Map insertion order (the order comments were added) — an imperfect but
  // reasonable proxy for "document order" (`specs/screens/comment-mode.md`)
  // without re-deriving each anchor's live position here too.
  const all = [...items.values()];
  const inlineComments = all.filter((item) => item.id !== GENERAL_ID && item.anchor !== undefined);
  const general = items.get(GENERAL_ID) ?? null;
  const pendingCount = all.filter((item) => item.status !== "saved").length;
  const hasUnsavedWork = pendingCount > 0;

  return {
    loading,
    draftVersion,
    inlineComments,
    general,
    pendingCount,
    hasUnsavedWork,
    addInline,
    editComment,
    commitComment,
    removeComment,
    editGeneral,
    rebase,
    markUnplaced,
    reload: load,
  };
}
