/**
 * useOfflineQueueStore.ts
 *
 * Zustand store that manages the offline action queue.
 *
 * Responsibilities
 * ────────────────
 * • Holds the in-memory queue (hydrated from disk at startup).
 * • Exposes addItem() for mutations to enqueue pending actions.
 * • Exposes processQueue() to drain the queue on reconnect.
 *   Caller (AppNavigator) invokes processQueue() BEFORE refreshing stores so
 *   the server receives the correct state before a full re-fetch overwrites it.
 * • processQueue() distinguishes transient errors (keep, retry later) from
 *   permanent errors (log + discard, no infinite retry).
 *
 * Batch refresh after drain
 * ─────────────────────────
 * processQueue() does NOT trigger store refreshes itself — that is the
 * responsibility of AppNavigator's reconnect handler, which runs after
 * processQueue() returns. This avoids circular imports and keeps the
 * queue store focused on a single concern.
 *
 * Phase 1 note: last local intended state wins.
 * Multi-device conflict resolution is out of scope for phase 1.
 */

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  OfflineQueueItem,
  createQueueItem,
  readQueue,
  writeQueue,
  enqueue,
  clearQueue,
  type OfflineQueueItemType,
} from "@/lib/offlineQueue";
import {
  recordQuizResultOnServer,
  type QuizResultType,
} from "@/services/quizLimits";

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Returns true if the Supabase error is permanent (should not be retried).
 *
 * Permanent errors: auth invalid (401/403), FK violation (23503),
 * permission denied (42501), JWT expired (PGRST301).
 *
 * Transient errors: network timeouts, temporary unavailability — these are
 * NOT listed here and default to retryable.
 */
function isPermanentError(error: { status?: number; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const status = error.status;
  if (status === 401 || status === 403) return true;
  const code = error.code;
  if (code === "23503") return true; // foreign_key_violation
  if (code === "23514") return true; // check_violation — data violates a constraint, retrying won't help
  if (code === "42501") return true; // insufficient_privilege
  if (code === "PGRST301") return true; // JWT expired
  return false;
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

// ── Item processor ────────────────────────────────────────────────────────────

async function processItem(
  item: OfflineQueueItem,
  userId: string
): Promise<{ success: boolean; permanent: boolean }> {
  try {
    switch (item.type) {
      case "progress_add_learning": {
        const { sentenceId } = item.payload as { sentenceId: string };
        const { error } = await supabase.from("user_progress").upsert(
          {
            user_id: userId,
            sentence_id: sentenceId,
            state: "learning",
            created_at: new Date().toISOString(),
          },
          { onConflict: "user_id,sentence_id" }
        );
        if (error) return { success: false, permanent: isPermanentError(error) };
        return { success: true, permanent: false };
      }

      case "progress_mark_learned": {
        const { sentenceId } = item.payload as { sentenceId: string };
        const { error } = await supabase.from("user_progress").upsert(
          {
            user_id: userId,
            sentence_id: sentenceId,
            state: "learned",
            learned_at: new Date().toISOString(),
          },
          { onConflict: "user_id,sentence_id" }
        );
        if (error) return { success: false, permanent: isPermanentError(error) };
        return { success: true, permanent: false };
      }

      case "progress_forgot": {
        const { sentenceId } = item.payload as { sentenceId: string };
        const { error } = await supabase
          .from("user_progress")
          .delete()
          .eq("user_id", userId)
          .eq("sentence_id", sentenceId);
        if (error) return { success: false, permanent: isPermanentError(error) };
        return { success: true, permanent: false };
      }

      case "favorite_add": {
        const { sentenceId, isPreset } = item.payload as {
          sentenceId: string;
          isPreset: boolean;
        };
        const { error } = await supabase.from("sentence_favorites").insert({
          user_id: userId,
          sentence_id: sentenceId,
          is_preset: isPreset,
        });
        // 23505 = unique violation — row already exists, treat as success
        if (error && error.code !== "23505") {
          return { success: false, permanent: isPermanentError(error) };
        }
        return { success: true, permanent: false };
      }

      case "favorite_remove": {
        const { sentenceId } = item.payload as { sentenceId: string };
        const { error } = await supabase
          .from("sentence_favorites")
          .delete()
          .eq("user_id", userId)
          .eq("sentence_id", sentenceId);
        if (error) return { success: false, permanent: isPermanentError(error) };
        return { success: true, permanent: false };
      }

      case "quiz_result": {
        const p = item.payload as {
          sentenceId: string | number | null;
          userSentenceId: string | null;
          isCorrect: boolean;
          quizType: QuizResultType;
          answeredAt: string;
        };
        const result = await recordQuizResultOnServer({
          userId,
          sentenceId: toNullableInteger(p.sentenceId),
          userSentenceId: p.userSentenceId,
          isCorrect: p.isCorrect,
          quizType: p.quizType,
          answeredAt: p.answeredAt,
          clientEventId: item.clientEventId ?? item.id,
        });

        if (result.success || result.limitReached) {
          return { success: true, permanent: false };
        }

        return { success: false, permanent: false };
      }

      case "study_session": {
        const p = item.payload as {
          sentenceId: string;
          durationMinutes: number;
          completed: boolean;
          createdAt: string;
        };
        const { error } = await supabase.from("study_sessions").insert({
          user_id: userId,
          sentence_id: p.sentenceId,
          duration_minutes: p.durationMinutes,
          completed: p.completed,
          created_at: p.createdAt,
          client_event_id: item.clientEventId ?? null,
        });
        // 23505 = unique violation on client_event_id — already inserted, idempotent
        if (error && error.code !== "23505") {
          return { success: false, permanent: isPermanentError(error) };
        }
        return { success: true, permanent: false };
      }

      case "reading_mark_completed": {
        const { textId, completedAt, shownAt } = item.payload as {
          textId: string;
          completedAt: string;
          shownAt: string;
        };
        const { error } = await supabase.from("user_reading_progress").upsert(
          {
            user_id: userId,
            reading_text_id: textId,
            status: "completed",
            completed_at: completedAt,
            shown_at: shownAt,
          },
          { onConflict: "user_id,reading_text_id" }
        );
        if (error) return { success: false, permanent: isPermanentError(error) };
        return { success: true, permanent: false };
      }

      default:
        // Unknown item type — permanent failure, discard
        console.warn("[offlineQueue] unknown item type, discarding:", (item as OfflineQueueItem).type);
        return { success: false, permanent: true };
    }
  } catch {
    // Network / runtime exception — transient, keep in queue
    return { success: false, permanent: false };
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface OfflineQueueState {
  queue: OfflineQueueItem[];
  isProcessing: boolean;
  userId: string | null;

  /** Number of pending items (convenience getter). */
  get pendingCount(): number;

  /**
   * Load queue from AsyncStorage at app startup.
   * Call inside hydrateStoresFromCache() so the queue is ready before
   * the first render.
   */
  hydrateQueue: (userId: string) => Promise<void>;

  /**
   * Add an item to the queue (persists to disk immediately).
   * Respects dedupeKey: replaces any existing item with the same key.
   */
  addItem: (item: OfflineQueueItem) => Promise<void>;

  /**
   * Drain the queue against the network.
   * - Transient failures: item kept, retried on next call.
   * - Permanent failures: item discarded with a console.warn (no infinite retry).
   *
   * Call this BEFORE refreshing stores on reconnect so the server receives
   * the correct state before a full re-fetch would overwrite local mutations.
   */
  processQueue: () => Promise<void>;

  /**
   * Clear all pending items and the persisted queue.
   * Call ONLY on confirmed sign-out or account deletion.
   */
  clearAllItems: () => Promise<void>;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  queue: [],
  isProcessing: false,
  userId: null,

  get pendingCount() {
    return get().queue.length;
  },

  hydrateQueue: async (userId: string) => {
    const items = await readQueue(userId);
    set({ queue: items, userId });
  },

  addItem: async (item: OfflineQueueItem) => {
    const { userId } = get();
    if (!userId) return;
    const updated = await enqueue(userId, item);
    set({ queue: updated });
  },

  processQueue: async () => {
    const { userId, isProcessing } = get();
    if (!userId || isProcessing) return;

    const items = get().queue;
    if (items.length === 0) return;

    set({ isProcessing: true });

    try {
      const remaining: OfflineQueueItem[] = [];
      let anyResolved = false; // true if any item was either succeeded or permanently discarded

      for (const item of items) {
        const { success, permanent } = await processItem(item, userId);

        if (success) {
          anyResolved = true;
          // Item handled — do NOT add to remaining
        } else if (permanent) {
          // Log and discard — no infinite retry
          console.warn(
            `[offlineQueue] permanent failure — discarding item (type: ${item.type}, id: ${item.id})`
          );
          anyResolved = true;
        } else {
          // Transient failure — keep for next retry
          remaining.push(item);
        }
      }

      if (anyResolved) {
        await writeQueue(userId, remaining);
        set({ queue: remaining });
      }
    } finally {
      set({ isProcessing: false });
    }
  },

  clearAllItems: async () => {
    const { userId } = get();
    if (userId) {
      await clearQueue(userId);
    }
    set({ queue: [], userId: null });
  },
}));

// ── Convenience factory re-exports ────────────────────────────────────────────
// Consuming stores import createQueueItem + OfflineQueueItemType from here
// to avoid needing a second import path.

export { createQueueItem };
export type { OfflineQueueItemType };
