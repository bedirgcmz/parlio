import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/store/useNetworkStore";
import { FREE_BUILD_SENTENCE_DAILY_LIMIT, FREE_QUIZ_DAILY_LIMIT } from "@/utils/constants";

export type QuizResultType = "multiple_choice" | "fill_blank" | "build_sentence";
export type QuizLimitGroup = "quiz" | "build_sentence";

export interface QuizDailyLimitStatus {
  group: QuizLimitGroup;
  usedCount: number;
  dailyLimit: number;
  remainingCount: number;
  limitReached: boolean;
  isPremium: boolean;
  serverDate: string;
  verifiedAt: number;
  source: "server" | "cache";
}

export interface QuizLimitLoadResult {
  status: QuizDailyLimitStatus | null;
  source: "server" | "cache" | "missing_cache" | "error";
  error?: string;
}

export interface QuizLimitConsumeResult {
  allowed: boolean;
  status: QuizDailyLimitStatus | null;
  reason?: "limit_reached" | "missing_snapshot";
}

export interface ServerQuizRecordResult {
  success: boolean;
  limitReached: boolean;
  duplicate: boolean;
  inserted: boolean;
  status: QuizDailyLimitStatus | null;
  error?: string;
}

type LimitRpcRow = {
  quiz_type?: string;
  used_count?: number;
  daily_limit?: number;
  remaining_count?: number;
  limit_reached?: boolean;
  is_premium?: boolean;
  server_date?: string;
};

type RecordRpcRow = LimitRpcRow & {
  inserted?: boolean;
  duplicate?: boolean;
};

const SNAPSHOT_KEY_PREFIX = "@parlio/quiz_daily_limit_v1";
const PREMIUM_UNLIMITED_LIMIT = 999999;

function snapshotKey(userId: string, group: QuizLimitGroup) {
  return `${SNAPSHOT_KEY_PREFIX}:${userId}:${group}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localLimitWindow(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    dayStart: start.toISOString(),
    dayEnd: end.toISOString(),
    limitDate: localDateString(date),
  };
}

export function quizTypeToLimitGroup(quizType: QuizResultType): QuizLimitGroup {
  return quizType === "build_sentence" ? "build_sentence" : "quiz";
}

function groupToRpcQuizType(group: QuizLimitGroup): QuizResultType {
  return group === "build_sentence" ? "build_sentence" : "multiple_choice";
}

function fallbackLimit(group: QuizLimitGroup, isPremium: boolean) {
  if (isPremium) return PREMIUM_UNLIMITED_LIMIT;
  return group === "build_sentence" ? FREE_BUILD_SENTENCE_DAILY_LIMIT : FREE_QUIZ_DAILY_LIMIT;
}

function normalizeStatus(
  row: LimitRpcRow,
  group: QuizLimitGroup,
  source: "server" | "cache"
): QuizDailyLimitStatus {
  const isPremium = row.is_premium === true;
  const dailyLimit = Number(row.daily_limit ?? fallbackLimit(group, isPremium));
  const usedCount = Number(row.used_count ?? 0);
  const remainingCount = Number(
    row.remaining_count ?? Math.max(dailyLimit - usedCount, 0)
  );

  return {
    group,
    usedCount,
    dailyLimit,
    remainingCount,
    limitReached: row.limit_reached ?? (!isPremium && remainingCount <= 0),
    isPremium,
    serverDate: row.server_date ?? localDateString(),
    verifiedAt: Date.now(),
    source,
  };
}

function isFreshForToday(status: QuizDailyLimitStatus) {
  return status.serverDate === localDateString();
}

async function writeSnapshot(userId: string, status: QuizDailyLimitStatus): Promise<void> {
  try {
    await AsyncStorage.setItem(
      snapshotKey(userId, status.group),
      JSON.stringify({ ...status, source: "cache" })
    );
  } catch {
    // Non-fatal. Server remains authoritative when online.
  }
}

export async function readQuizLimitSnapshot(
  userId: string,
  group: QuizLimitGroup
): Promise<QuizDailyLimitStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(userId, group));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<QuizDailyLimitStatus>;
    if (
      parsed.group !== group ||
      typeof parsed.usedCount !== "number" ||
      typeof parsed.dailyLimit !== "number" ||
      typeof parsed.remainingCount !== "number" ||
      typeof parsed.serverDate !== "string"
    ) {
      await AsyncStorage.removeItem(snapshotKey(userId, group)).catch(() => {});
      return null;
    }

    const status: QuizDailyLimitStatus = {
      group,
      usedCount: parsed.usedCount,
      dailyLimit: parsed.dailyLimit,
      remainingCount: parsed.remainingCount,
      limitReached: parsed.limitReached ?? parsed.remainingCount <= 0,
      isPremium: parsed.isPremium === true,
      serverDate: parsed.serverDate,
      verifiedAt: typeof parsed.verifiedAt === "number" ? parsed.verifiedAt : 0,
      source: "cache",
    };

    if (!isFreshForToday(status)) {
      await AsyncStorage.removeItem(snapshotKey(userId, group)).catch(() => {});
      return null;
    }

    return status;
  } catch {
    return null;
  }
}

export async function loadQuizDailyLimitStatus(
  userId: string,
  group: QuizLimitGroup
): Promise<QuizLimitLoadResult> {
  if (useNetworkStore.getState().isOnline === false) {
    const cached = await readQuizLimitSnapshot(userId, group);
    if (cached) return { status: cached, source: "cache" };
    return { status: null, source: "missing_cache" };
  }

  try {
    const window = localLimitWindow();
    const { data, error } = await supabase.rpc("get_quiz_daily_limit_status", {
      p_quiz_type: groupToRpcQuizType(group),
      p_day_start: window.dayStart,
      p_day_end: window.dayEnd,
      p_limit_date: window.limitDate,
    });

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      const status = normalizeStatus((row ?? {}) as LimitRpcRow, group, "server");
      await writeSnapshot(userId, status);
      return { status, source: "server" };
    }

    const cached = await readQuizLimitSnapshot(userId, group);
    if (cached) return { status: cached, source: "cache", error: error.message };
    return { status: null, source: "error", error: error.message };
  } catch (error) {
    const cached = await readQuizLimitSnapshot(userId, group);
    if (cached) return { status: cached, source: "cache" };
    return {
      status: null,
      source: "missing_cache",
      error: error instanceof Error ? error.message : undefined,
    };
  }
}

export async function consumeOfflineQuizLimit(
  userId: string,
  quizType: QuizResultType,
  bypassLimit: boolean
): Promise<QuizLimitConsumeResult> {
  const group = quizTypeToLimitGroup(quizType);
  if (bypassLimit) return { allowed: true, status: null };

  const snapshot = await readQuizLimitSnapshot(userId, group);
  if (!snapshot) {
    return { allowed: false, status: null, reason: "missing_snapshot" };
  }

  if (snapshot.limitReached || snapshot.remainingCount <= 0) {
    return { allowed: false, status: snapshot, reason: "limit_reached" };
  }

  const nextStatus: QuizDailyLimitStatus = {
    ...snapshot,
    usedCount: snapshot.usedCount + 1,
    remainingCount: Math.max(snapshot.remainingCount - 1, 0),
    limitReached: snapshot.remainingCount - 1 <= 0,
    verifiedAt: Date.now(),
    source: "cache",
  };

  await writeSnapshot(userId, nextStatus);
  return { allowed: true, status: nextStatus };
}

export async function recordQuizResultOnServer(params: {
  userId: string;
  sentenceId: number | null;
  userSentenceId: string | null;
  isCorrect: boolean;
  quizType: QuizResultType;
  answeredAt: string;
  clientEventId: string;
}): Promise<ServerQuizRecordResult> {
  const group = quizTypeToLimitGroup(params.quizType);
  const window = localLimitWindow(new Date(params.answeredAt));
  const { data, error } = await supabase.rpc("record_quiz_result_with_limit", {
    p_sentence_id: params.sentenceId,
    p_user_sentence_id: params.userSentenceId,
    p_is_correct: params.isCorrect,
    p_quiz_type: params.quizType,
    p_answered_at: params.answeredAt,
    p_client_event_id: params.clientEventId,
    p_day_start: window.dayStart,
    p_day_end: window.dayEnd,
    p_limit_date: window.limitDate,
  });

  if (error) {
    return {
      success: false,
      limitReached: false,
      duplicate: false,
      inserted: false,
      status: null,
      error: error.message,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RecordRpcRow | null;
  const status = normalizeStatus(row ?? {}, group, "server");
  await writeSnapshot(params.userId, status);

  const inserted = row?.inserted === true;
  const duplicate = row?.duplicate === true;
  const limitReached = row?.limit_reached === true && !inserted && !duplicate;

  return {
    success: inserted || duplicate,
    limitReached,
    duplicate,
    inserted,
    status,
  };
}
