import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { UserProgress, QuizResult, StudySession } from "@/types";
import { useAchievementStore } from "./useAchievementStore";
import { readCache, writeCache } from "@/lib/offlineCache";
import { useOfflineQueueStore, createQueueItem } from "./useOfflineQueueStore";
import { generateQueueId } from "@/lib/offlineQueue";
import { useNetworkStore } from "./useNetworkStore";
import {
  consumeOfflineQuizLimit,
  recordQuizResultOnServer,
  type QuizDailyLimitStatus,
  type QuizResultType,
} from "@/services/quizLimits";

// TODO: daily_stats tablosuna yazma — şu an streak user_progress.learned_at'tan hesaplanıyor.
// daily_stats tablosu şu an kullanılmıyor; gerekirse her öğrenme/quiz sonrası güncellenebilir.
interface ModeStats { correct: number; total: number }

interface ProgressStats {
  totalSentencesStudied: number;
  totalSentencesLearned: number;
  currentStreak: number;
  longestStreak: number;
  quizAccuracy: number;
  totalQuizQuestions: number;
  totalBuildSentences: number;
  correctQuizAnswers: number;
  studyTimeToday: number;
  studyTimeThisWeek: number;
  studyTimeThisMonth: number;
  lastStudyDate: string | null;
  quizByMode: { multiple_choice: ModeStats; fill_blank: ModeStats; build_sentence: ModeStats };
  quizByCategory: Record<string, ModeStats>;
  todayLearnedUserSentences: number;
  userLearnedDates: string[];
}

export interface QuizRecordOutcome {
  success: boolean;
  queued?: boolean;
  limitReached?: boolean;
  missingSnapshot?: boolean;
  status?: QuizDailyLimitStatus | null;
  error?: string;
}

type RecordQuizResultInput = Omit<QuizResult, "id" | "answered_at"> & {
  bypassDailyLimit?: boolean;
};

interface ProgressState {
  progress: UserProgress[];
  progressMap: Record<string, "learning" | "learned">;
  stats: ProgressStats;
  loading: boolean;
  error: string | null;

  loadProgress: () => Promise<void>;
  loadStats: () => Promise<void>;
  // State-machine actions for preset sentences
  addToLearning: (sentenceId: string) => Promise<void>;
  markAsLearned: (sentenceId: string) => Promise<void>;
  forgot: (sentenceId: string) => Promise<void>;
  // Legacy quiz tracking
  recordStudySession: (session: Omit<StudySession, "id" | "created_at">) => Promise<void>;
  recordQuizResult: (result: RecordQuizResultInput) => Promise<QuizRecordOutcome>;
  getTodayProgress: () => UserProgress[];
  getWeekProgress: () => UserProgress[];
  getMonthProgress: () => UserProgress[];
  calculateStreak: () => Promise<void>;
  clear: () => void;
}

const DEFAULT_STATS: ProgressStats = {
  totalSentencesStudied: 0,
  totalSentencesLearned: 0,
  currentStreak: 0,
  longestStreak: 0,
  quizAccuracy: 0,
  totalQuizQuestions: 0,
  totalBuildSentences: 0,
  correctQuizAnswers: 0,
  studyTimeToday: 0,
  studyTimeThisWeek: 0,
  studyTimeThisMonth: 0,
  lastStudyDate: null,
  quizByMode: { multiple_choice: { correct: 0, total: 0 }, fill_blank: { correct: 0, total: 0 }, build_sentence: { correct: 0, total: 0 } },
  quizByCategory: {},
  todayLearnedUserSentences: 0,
  userLearnedDates: [],
};

// Cache shape saved to AsyncStorage
interface ProgressCacheSnapshot {
  progress: UserProgress[];
  progressMap: Record<string, "learning" | "learned">;
  stats: ProgressStats;
}

function cacheKeyProgress(userId: string) {
  return `progress:${userId}`;
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function applyPendingProgressQueue(
  progressMap: Record<string, "learning" | "learned">
): Record<string, "learning" | "learned"> {
  const queue = useOfflineQueueStore.getState().queue;
  if (queue.length === 0) return progressMap;

  let merged = progressMap;
  const ensureMutable = () => {
    if (merged === progressMap) merged = { ...progressMap };
    return merged;
  };

  for (const item of queue) {
    if (
      item.type !== "progress_add_learning" &&
      item.type !== "progress_mark_learned" &&
      item.type !== "progress_forgot"
    ) {
      continue;
    }

    const sentenceId = (item.payload as { sentenceId?: unknown }).sentenceId;
    if (sentenceId === null || sentenceId === undefined || sentenceId === "") continue;
    const key = String(sentenceId);
    const next = ensureMutable();

    if (item.type === "progress_add_learning") {
      next[key] = "learning";
    } else if (item.type === "progress_mark_learned") {
      next[key] = "learned";
    } else {
      delete next[key];
    }
  }

  return merged;
}

export const useProgressStore = create<ProgressState>((set, get) => ({
  progress: [],
  progressMap: {},
  stats: DEFAULT_STATS,
  loading: false,
  error: null,

  loadProgress: async () => {
    try {
      // getSession() reads from AsyncStorage — no network, safe for offline cache reads.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) {
        set({ loading: false });
        return;
      }

      // 1. Hydrate from cache immediately — no spinner if we have cached data
      const cached = await readCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id));
      if (cached) {
        const progressMap = applyPendingProgressQueue(cached.progressMap);
        set({
          progress: cached.progress,
          progressMap,
          stats: cached.stats,
        });
        // Continue to background network refresh below
      } else {
        set({ loading: true, error: null });
      }

      // 2. Fetch from network
      const { data, error } = await supabase
        .from("user_progress")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) {
        // Keep cached data visible; just clear loading
        set({ error: error.message, loading: false });
        return;
      }

      // Build progressMap from rows
      const progressMap: Record<string, "learning" | "learned"> = {};
      for (const row of data || []) {
        if (row.state === "learning" || row.state === "learned") {
          progressMap[String(row.sentence_id)] = row.state;
        }
      }

      const mergedProgressMap = applyPendingProgressQueue(progressMap);

      set({ progress: data || [], progressMap: mergedProgressMap, loading: false });
      await get().loadStats();

      // 3. Persist the fresh snapshot to cache
      void writeCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id), {
        progress: data || [],
        progressMap: mergedProgressMap,
        stats: get().stats,
      });
    } catch {
      set({ error: "Failed to load progress", loading: false });
    }
  },

  // Öğrenme listesine ekle: new → learning
  addToLearning: async (sentenceId: string) => {
    // 1. Optimistic update
    set((state) => ({
      progressMap: { ...state.progressMap, [sentenceId]: "learning" },
    }));

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return;

    // 2. Write to cache immediately (before network) so offline reads are correct
    await writeCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id), {
      progress: get().progress,
      progressMap: get().progressMap,
      stats: get().stats,
    });

    // 3. Try remote write; on failure queue for later
    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      const { error } = await supabase.from("user_progress").upsert(
        {
          user_id: user.id,
          sentence_id: sentenceId,
          state: "learning",
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id,sentence_id" }
      );
      if (!error) return; // success — nothing to queue
    }

    // Offline or remote failed → enqueue
    await useOfflineQueueStore.getState().addItem(
      createQueueItem("progress_add_learning", { sentenceId }, { dedupeKey: `progress:${sentenceId}` })
    );
  },

  // Öğrenildi: learning → learned
  markAsLearned: async (sentenceId: string) => {
    // 1. Optimistic update so UI responds immediately
    set((state) => ({
      progressMap: { ...state.progressMap, [sentenceId]: "learned" },
    }));

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return;

    // 2. Write to cache immediately — prevents loadProgress() or any other
    //    cache reader from seeing stale pre-optimistic state.
    await writeCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id), {
      progress: get().progress,
      progressMap: get().progressMap,
      stats: get().stats,
    });

    // 3. Fire achievement check against optimistic stats (good enough for Phase 1)
    const { stats } = get();
    void useAchievementStore.getState().checkProgressAchievements({
      totalSentencesLearned: stats.totalSentencesLearned,
      currentStreak: stats.currentStreak,
      totalQuizQuestions: stats.totalQuizQuestions,
      totalBuildSentences: stats.totalBuildSentences,
    });

    // 4. Try remote write; on failure queue for later.
    //    NO loadProgress() here — aggregate stats refresh happens in the batch
    //    refresh that AppNavigator runs after queue drain on reconnect.
    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      const { error } = await supabase.from("user_progress").upsert(
        {
          user_id: user.id,
          sentence_id: sentenceId,
          state: "learned",
          learned_at: new Date().toISOString(),
        },
        { onConflict: "user_id,sentence_id" }
      );
      if (!error) return; // success — nothing to queue
    }

    // Offline or remote failed → enqueue
    await useOfflineQueueStore.getState().addItem(
      createQueueItem("progress_mark_learned", { sentenceId }, { dedupeKey: `progress:${sentenceId}` })
    );
  },

  // Unuttum: learned/learning → new (sil)
  forgot: async (sentenceId: string) => {
    // 1. Optimistic update
    set((state) => {
      const { [sentenceId]: _removed, ...rest } = state.progressMap;
      return { progressMap: rest };
    });

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return;

    // 2. Write to cache immediately
    await writeCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id), {
      progress: get().progress,
      progressMap: get().progressMap,
      stats: get().stats,
    });

    // 3. Try remote write; on failure queue for later
    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      const { error } = await supabase
        .from("user_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("sentence_id", sentenceId);
      if (!error) return;
    }

    await useOfflineQueueStore.getState().addItem(
      createQueueItem("progress_forgot", { sentenceId }, { dedupeKey: `progress:${sentenceId}` })
    );
  },

  loadStats: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) return;

      const now = new Date();
      const today = now.toISOString().split("T")[0];

      // Streak & learned counts come from user_progress (the table actually written to).
      // study_sessions is a legacy table that is never written to in the current flow.
      const { data: learnedRows } = await supabase
        .from("user_progress")
        .select("learned_at")
        .eq("user_id", user.id)
        .eq("state", "learned")
        .not("learned_at", "is", null);

      const { data: allProgressRows } = await supabase
        .from("user_progress")
        .select("state")
        .eq("user_id", user.id);

      const { data: quizResults } = await supabase
        .from("quiz_results")
        .select("is_correct, answered_at, quiz_type")
        .eq("user_id", user.id);

      const { data: quizWithCategory } = await supabase
        .from("quiz_results")
        .select("is_correct, quiz_type, sentences(categories(name_en))")
        .eq("user_id", user.id);

      const { data: studySessionRows } = await supabase
        .from("study_sessions")
        .select("created_at")
        .eq("user_id", user.id);

      const { data: userLearnedRows } = await supabase
        .from("user_sentences")
        .select("learned_at")
        .eq("user_id", user.id)
        .eq("state", "learned")
        .not("learned_at", "is", null);

      const totalSentencesStudied = allProgressRows?.length || 0;
      const totalSentencesLearned =
        allProgressRows?.filter((r) => r.state === "learned").length || 0;

      const quizOnlyResults = quizResults?.filter((q) => q.quiz_type === "multiple_choice" || q.quiz_type === "fill_blank") || [];
      const totalQuizQuestions = quizOnlyResults.length;
      const totalBuildSentences = quizResults?.filter((q) => q.quiz_type === "build_sentence").length || 0;
      const correctQuizAnswers = quizOnlyResults.filter((q) => q.is_correct).length;
      const quizAccuracy =
        totalQuizQuestions > 0 ? (correctQuizAnswers / totalQuizQuestions) * 100 : 0;

      const quizByMode: ProgressStats["quizByMode"] = {
        multiple_choice: { correct: 0, total: 0 },
        fill_blank: { correct: 0, total: 0 },
        build_sentence: { correct: 0, total: 0 },
      };
      for (const q of quizResults || []) {
        const mode = q.quiz_type as keyof typeof quizByMode;
        if (quizByMode[mode]) {
          quizByMode[mode].total++;
          if (q.is_correct) quizByMode[mode].correct++;
        }
      }

      const quizByCategory: ProgressStats["quizByCategory"] = {};
      for (const q of quizWithCategory || []) {
        const sentenceData = q.sentences as { categories?: { name_en?: string } | null } | null;
        const rawCat = sentenceData?.categories?.name_en;
        const cat = rawCat
          ? rawCat
              .toLowerCase()
              .replace(/\s*&\s*/g, " and ")
              .replace(/[^a-z0-9\s]/g, "")
              .trim()
              .replace(/\s+/g, "_")
          : "other";
        if (!quizByCategory[cat]) quizByCategory[cat] = { correct: 0, total: 0 };
        quizByCategory[cat].total++;
        if (q.is_correct) quizByCategory[cat].correct++;
      }

      // Distinct calendar days with ANY activity: learned + quiz answered + auto mode session
      const learnedDays = [
        ...new Set([
          ...(learnedRows || []).map((r) => r.learned_at!.split("T")[0]),
          ...(userLearnedRows || []).map((r) => (r.learned_at as string).split("T")[0]),
          ...(quizResults || []).filter((r) => r.answered_at != null).map((r) => r.answered_at.split("T")[0]),
          ...(studySessionRows || []).map((r) => r.created_at.split("T")[0]),
        ]),
      ].sort().reverse();

      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;

      // Calculate longestStreak across all history (consecutive day groups)
      for (let i = 0; i < learnedDays.length; i++) {
        if (i === 0) {
          tempStreak = 1;
        } else {
          const diff =
            (new Date(learnedDays[i - 1]).getTime() - new Date(learnedDays[i]).getTime()) /
            MS_PER_DAY;
          if (diff === 1) {
            tempStreak++;
          } else {
            longestStreak = Math.max(longestStreak, tempStreak);
            tempStreak = 1;
          }
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak);

      // currentStreak is only active if user learned today or yesterday
      if (learnedDays.length > 0) {
        const dayDiff =
          (new Date(today).getTime() - new Date(learnedDays[0]).getTime()) / MS_PER_DAY;
        if (dayDiff <= 1) {
          let streak = 1;
          for (let i = 1; i < learnedDays.length; i++) {
            const diff =
              (new Date(learnedDays[i - 1]).getTime() - new Date(learnedDays[i]).getTime()) /
              MS_PER_DAY;
            if (diff === 1) streak++;
            else break;
          }
          currentStreak = streak;
        }
      }

      const lastStudyDate = learnedDays.length > 0 ? learnedDays[0] : null;

      const todayLearnedUserSentences = (userLearnedRows || []).filter((r) =>
        (r.learned_at as string).startsWith(today)
      ).length;
      const userLearnedDates = (userLearnedRows || []).map((r) => r.learned_at as string);

      const stats: ProgressStats = {
        totalSentencesStudied,
        totalSentencesLearned,
        currentStreak,
        longestStreak,
        quizAccuracy,
        totalQuizQuestions,
        totalBuildSentences,
        correctQuizAnswers,
        studyTimeToday: 0,
        studyTimeThisWeek: 0,
        studyTimeThisMonth: 0,
        lastStudyDate,
        quizByMode,
        quizByCategory,
        todayLearnedUserSentences,
        userLearnedDates,
      };

      set({ stats });

      // Update the progress cache with the freshly computed stats
      void writeCache<ProgressCacheSnapshot>(cacheKeyProgress(user.id), {
        progress: get().progress,
        progressMap: get().progressMap,
        stats,
      });
    } catch (error) {
      if (__DEV__) console.error("Error loading stats:", error);
    }
  },

  recordStudySession: async (session) => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user ?? null;
    if (!user) return;

    // Achievement check fires immediately against current stats (optimistic)
    void useAchievementStore.getState().unlockAchievement("first_automode");
    const { stats } = get();
    void useAchievementStore.getState().checkProgressAchievements({
      totalSentencesLearned: stats.totalSentencesLearned,
      currentStreak: stats.currentStreak,
      totalQuizQuestions: stats.totalQuizQuestions,
      totalBuildSentences: stats.totalBuildSentences,
    });

    // Generate clientEventId for idempotent replay on reconnect
    const clientEventId = generateQueueId();
    const createdAt = new Date().toISOString();

    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      const { error } = await supabase
        .from("study_sessions")
        .insert({ ...session, user_id: user.id, created_at: createdAt, client_event_id: clientEventId });
      if (!error) return; // success — nothing to queue
    }

    // Offline or remote failed → enqueue.
    // loadStats() is NOT called here — aggregate stats refresh happens in
    // AppNavigator's batch refresh after queue drain on reconnect.
    void useOfflineQueueStore.getState().addItem(
      createQueueItem("study_session", {
        sentenceId: session.sentence_id,
        durationMinutes: session.duration_minutes,
        completed: session.completed,
        createdAt,
      }, { clientEventId })
    );
  },

  recordQuizResult: async (result) => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user ?? null;
    if (!user) return { success: false, error: "No user logged in" };

    // Generate clientEventId for idempotent replay on reconnect
    const clientEventId = generateQueueId();
    const answeredAt = new Date().toISOString();
    const quizType = result.quiz_type as QuizResultType;
    const sentenceId = result.user_sentence_id ? null : toNullableInteger(result.sentence_id);
    const userSentenceId = result.user_sentence_id ?? null;
    const bypassDailyLimit = result.bypassDailyLimit === true;

    const checkAchievements = () => {
      const { stats } = get();
      void useAchievementStore.getState().checkProgressAchievements({
        totalSentencesLearned: stats.totalSentencesLearned,
        currentStreak: stats.currentStreak,
        totalQuizQuestions: stats.totalQuizQuestions,
        totalBuildSentences: stats.totalBuildSentences,
      });
    };

    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      const serverResult = await recordQuizResultOnServer({
        userId: user.id,
        sentenceId,
        userSentenceId,
        isCorrect: result.is_correct,
        quizType,
        answeredAt,
        clientEventId,
      });

      if (serverResult.success) {
        checkAchievements();
        return {
          success: true,
          limitReached: false,
          status: serverResult.status,
        };
      }

      if (serverResult.limitReached) {
        return {
          success: false,
          limitReached: true,
          status: serverResult.status,
        };
      }
    }

    // Offline or remote failed → enqueue.
    const consumeResult = await consumeOfflineQuizLimit(user.id, quizType, bypassDailyLimit);
    if (!consumeResult.allowed) {
      return {
        success: false,
        limitReached: true,
        missingSnapshot: consumeResult.reason === "missing_snapshot",
        status: consumeResult.status,
      };
    }

    checkAchievements();

    // loadStats() is NOT called here — aggregate stats refresh happens in
    // AppNavigator's batch refresh after queue drain on reconnect.
    await useOfflineQueueStore.getState().addItem(
      createQueueItem("quiz_result", {
        sentenceId,
        userSentenceId,
        isCorrect: result.is_correct,
        quizType,
        answeredAt,
      }, { clientEventId })
    );
    return {
      success: true,
      queued: true,
      limitReached: false,
      status: consumeResult.status,
    };
  },

  getTodayProgress: () => {
    const { progress } = get();
    const today = new Date().toISOString().split("T")[0];
    return progress.filter((p) => p.created_at.startsWith(today));
  },

  getWeekProgress: () => {
    const { progress } = get();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return progress.filter((p) => p.created_at >= weekAgo);
  },

  getMonthProgress: () => {
    const { progress } = get();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return progress.filter((p) => p.created_at >= monthAgo);
  },

  calculateStreak: async () => {
    await get().loadStats();
  },

  clear: () =>
    set({
      progress: [],
      progressMap: {},
      stats: DEFAULT_STATS,
      loading: false,
      error: null,
    }),
}));
