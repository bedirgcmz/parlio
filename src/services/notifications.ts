import { Platform } from "react-native";
import i18n from "@/i18n";
import { SupportedLanguage } from "@/types";
import { LEAGUE_THRESHOLDS, type LeagueType } from "@/types/game";

// expo-notifications throws a fatal error on Android Expo Go SDK 53+
// (remote push notifications were removed from Expo Go).
// We lazy-require it so the crash is caught and the app still starts.
// Local notification scheduling works fine in development builds.

type NotificationsModule = typeof import("expo-notifications");

let N: NotificationsModule | null = null;
try {
  N = require("expo-notifications") as NotificationsModule;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Not available in Expo Go on Android SDK 53+
}

const DAILY_REMINDER_ID = "parlio_daily_reminder";
const STREAK_SAVER_ID = "parlio_streak_saver";
const GOAL_NUDGE_ID = "parlio_goal_nudge";
const COMEBACK_ID = "parlio_comeback";
const WEEKLY_REVIEW_ID = "parlio_weekly_review";
const GAME_MOMENTUM_ID = "parlio_game_momentum";

const NOTIFICATION_IDS = [
  DAILY_REMINDER_ID,
  STREAK_SAVER_ID,
  GOAL_NUDGE_ID,
  COMEBACK_ID,
  WEEKLY_REVIEW_ID,
  GAME_MOMENTUM_ID,
] as const;

const DEFAULT_REMINDER_TITLE = "Parlio";
const DEFAULT_REMINDER_BODY = "Time for your daily language practice.";
const WEEKDAY_SUNDAY = 1;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const QUIET_START_HOUR = 9;
const QUIET_END_HOUR = 21;

type TriggerInput = Parameters<NotificationsModule["scheduleNotificationAsync"]>[0]["trigger"];

type NotificationPlanSnapshot = {
  enabled: boolean;
  reminderTime: string;
  uiLanguage?: SupportedLanguage;
  dailyGoal?: number;
  todayLearned?: number;
  currentStreak?: number;
  lastStudyDate?: string | null;
  totalSentencesLearned?: number;
  gamesPlayed?: number;
  lastPlayedAt?: string | null;
  league?: LeagueType | null;
  cumulativeScore?: number | null;
  requestPermissions?: boolean;
  overrideDailyTitle?: string;
  overrideDailyBody?: string;
};

type PlannedNotification = {
  id: string;
  title: string;
  body: string;
  trigger: TriggerInput;
};

export type NotificationPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

function getCurrentLanguage(preferred?: SupportedLanguage): SupportedLanguage {
  if (preferred) return preferred;
  const lang = i18n.resolvedLanguage ?? i18n.language;
  return ["tr", "en", "sv", "de", "es", "fr", "pt"].includes(lang)
    ? (lang as SupportedLanguage)
    : "en";
}

function getTranslator(language?: SupportedLanguage) {
  return i18n.getFixedT(getCurrentLanguage(language));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function diffLocalDays(later: Date, earlier: Date): number {
  return Math.floor(
    (getLocalDayStart(later).getTime() - getLocalDayStart(earlier).getTime()) / ONE_DAY_MS,
  );
}

function buildDateAtTime(base: Date, hour: number, minute: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function getQuietHour(reminderHour: number): number {
  if (reminderHour < QUIET_START_HOUR || reminderHour >= QUIET_END_HOUR) {
    return 19;
  }
  return reminderHour;
}

function normalizeOneShotDate(candidate: Date, reminderHour: number, reminderMinute: number): Date {
  const now = new Date();
  let next = new Date(candidate);

  if (next.getTime() <= now.getTime() + 5_000) {
    next = new Date(now.getTime() + 15 * 60 * 1000);
  }

  const quietHour = getQuietHour(reminderHour);

  if (next.getHours() < QUIET_START_HOUR) {
    next = buildDateAtTime(next, quietHour, reminderMinute);
  } else if (next.getHours() >= QUIET_END_HOUR) {
    const tomorrow = new Date(next);
    tomorrow.setDate(tomorrow.getDate() + 1);
    next = buildDateAtTime(tomorrow, quietHour, reminderMinute);
  }

  if (next.getTime() <= now.getTime() + 5_000) {
    next = new Date(now.getTime() + 15 * 60 * 1000);
  }

  return next;
}

function getLeagueProgressCopy(
  t: ReturnType<typeof getTranslator>,
  league: LeagueType | null | undefined,
  cumulativeScore: number | null | undefined,
): string {
  if (!league || typeof cumulativeScore !== "number") {
    return t("notifications_plan.game_momentum.body_generic");
  }

  const threshold = LEAGUE_THRESHOLDS[league];
  if (!threshold?.next) {
    return t("notifications_plan.game_momentum.body_generic");
  }

  const remaining = Math.max(threshold.max - cumulativeScore + 1, 0);
  if (remaining <= 0) {
    return t("notifications_plan.game_momentum.body_generic");
  }

  return t("games.hub.league_progress", {
    pts: remaining,
    next: t(`games.league.${threshold.next}` as const),
  });
}

function buildNotificationPlan(snapshot: NotificationPlanSnapshot): PlannedNotification[] {
  const language = getCurrentLanguage(snapshot.uiLanguage);
  const t = getTranslator(language);
  const dailyGoal = Math.max(snapshot.dailyGoal ?? 10, 1);
  const todayLearned = Math.max(snapshot.todayLearned ?? 0, 0);
  const currentStreak = Math.max(snapshot.currentStreak ?? 0, 0);
  const totalSentencesLearned = Math.max(snapshot.totalSentencesLearned ?? 0, 0);
  const gamesPlayed = Math.max(snapshot.gamesPlayed ?? 0, 0);
  const lastStudyDate = parseDate(snapshot.lastStudyDate);
  const lastPlayedAt = parseDate(snapshot.lastPlayedAt);
  const now = new Date();
  const { hour, minute } = parseReminderTime(snapshot.reminderTime);

  const plans: PlannedNotification[] = [
    {
      id: DAILY_REMINDER_ID,
      title: snapshot.overrideDailyTitle ?? t("notifications_plan.daily.title"),
      body: snapshot.overrideDailyBody ?? t("notifications_plan.daily.body", { goal: dailyGoal }),
      trigger: {
        type: N!.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    },
    {
      id: WEEKLY_REVIEW_ID,
      title: t("notifications_plan.weekly_review.title"),
      body: t("notifications_plan.weekly_review.body", { streak: Math.max(currentStreak, 1) }),
      trigger: {
        type: N!.SchedulableTriggerInputTypes.WEEKLY,
        weekday: WEEKDAY_SUNDAY,
        hour,
        minute,
      },
    },
  ];

  if (todayLearned > 0 && todayLearned < dailyGoal) {
    const remaining = Math.max(dailyGoal - todayLearned, 1);
    plans.push({
      id: GOAL_NUDGE_ID,
      title: t("notifications_plan.goal_nudge.title", { remaining }),
      body: t("notifications_plan.goal_nudge.body", {
        done: todayLearned,
        goal: dailyGoal,
      }),
      trigger: {
        type: N!.SchedulableTriggerInputTypes.DATE,
        date: normalizeOneShotDate(
          new Date(now.getTime() + 75 * 60 * 1000),
          hour,
          minute,
        ),
      },
    });
  }

  const studiedToday = lastStudyDate ? isSameLocalDay(lastStudyDate, now) : todayLearned > 0;
  const reminderToday = buildDateAtTime(now, hour, minute);
  const reminderPassedToday = now.getTime() >= reminderToday.getTime();

  if (currentStreak > 0 && !studiedToday && reminderPassedToday) {
    const streakSaverDate = new Date(now.getTime() + 90 * 60 * 1000);
    if (isSameLocalDay(streakSaverDate, now) && streakSaverDate.getHours() < QUIET_END_HOUR) {
      plans.push({
        id: STREAK_SAVER_ID,
        title: t("notifications_plan.streak_saver.title", { streak: currentStreak }),
        body: t("notifications_plan.streak_saver.body"),
        trigger: {
          type: N!.SchedulableTriggerInputTypes.DATE,
          date: streakSaverDate,
        },
      });
    }
  }

  const inactivityDays = lastStudyDate ? diffLocalDays(now, lastStudyDate) : 0;
  if (totalSentencesLearned > 0 && inactivityDays >= 2) {
    plans.push({
      id: COMEBACK_ID,
      title: t("notifications_plan.comeback.title"),
      body: t("notifications_plan.comeback.body"),
      trigger: {
        type: N!.SchedulableTriggerInputTypes.DATE,
        date: normalizeOneShotDate(
          new Date(now.getTime() + 3 * ONE_HOUR_MS),
          hour,
          minute,
        ),
      },
    });
  }

  const gameInactivityDays = lastPlayedAt ? diffLocalDays(now, lastPlayedAt) : 0;
  if (gamesPlayed > 0 && gameInactivityDays >= 2 && inactivityDays < 2) {
    plans.push({
      id: GAME_MOMENTUM_ID,
      title: t("notifications_plan.game_momentum.title", {
        league: snapshot.league ? t(`games.league.${snapshot.league}` as const) : t("games.league.bronze"),
      }),
      body: getLeagueProgressCopy(t, snapshot.league, snapshot.cumulativeScore),
      trigger: {
        type: N!.SchedulableTriggerInputTypes.DATE,
        date: normalizeOneShotDate(
          new Date(now.getTime() + 4 * ONE_HOUR_MS),
          hour,
          minute,
        ),
      },
    });
  }

  return plans;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!N) return false;
  try {
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("default", {
        name: "Parlio",
        importance: N.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: existingStatus } = await N.getPermissionsAsync();
    if (existingStatus === "granted") return true;
    const { status } = await N.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (!N) return "unavailable";

  try {
    const { status } = await N.getPermissionsAsync();
    if (status === "granted" || status === "denied" || status === "undetermined") {
      return status;
    }
  } catch {
    return "unavailable";
  }

  return "undetermined";
}

export async function cancelAllPracticeNotifications(): Promise<void> {
  if (!N) return;
  await Promise.all(
    NOTIFICATION_IDS.map(async (id) => {
      try {
        await N!.cancelScheduledNotificationAsync(id);
      } catch {
        // already cancelled or never scheduled
      }
    }),
  );
}

export async function scheduleDailyReminder(
  hour: number,
  minute: number,
  title: string,
  body: string,
): Promise<boolean> {
  if (!N) return false;
  try {
    await cancelDailyReminder();
    await N.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_ID,
      content: { title, body, sound: true },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelDailyReminder(): Promise<void> {
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // already cancelled or never scheduled
  }
}

export function parseReminderTime(timeStr: string): { hour: number; minute: number } {
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return { hour: Number.isNaN(h) ? 19 : h, minute: Number.isNaN(m) ? 0 : m };
}

export async function syncNotificationPlan(
  snapshot: NotificationPlanSnapshot,
): Promise<boolean> {
  if (!N) return false;

  if (!snapshot.enabled) {
    await cancelAllPracticeNotifications();
    return true;
  }

  let granted = false;
  if (snapshot.requestPermissions) {
    granted = await requestNotificationPermissions();
  } else {
    try {
      const perms = await N.getPermissionsAsync();
      granted = perms.status === "granted";
    } catch {
      granted = false;
    }
  }

  if (!granted) return false;

  const plans = buildNotificationPlan(snapshot);

  try {
    await cancelAllPracticeNotifications();

    for (const plan of plans) {
      await N.scheduleNotificationAsync({
        identifier: plan.id,
        content: {
          title: plan.title,
          body: plan.body,
          sound: true,
        },
        trigger: plan.trigger,
      });
    }

    return true;
  } catch {
    return false;
  }
}

export async function syncDailyReminderSchedule(params: {
  enabled: boolean;
  reminderTime: string;
  title?: string;
  body?: string;
  uiLanguage?: SupportedLanguage;
  dailyGoal?: number;
  requestPermissions?: boolean;
}): Promise<boolean> {
  return syncNotificationPlan({
    enabled: params.enabled,
    reminderTime: params.reminderTime,
    uiLanguage: params.uiLanguage ?? getCurrentLanguage(),
    dailyGoal: params.dailyGoal ?? 10,
    todayLearned: 0,
    currentStreak: 0,
    lastStudyDate: null,
    totalSentencesLearned: 0,
    gamesPlayed: 0,
    lastPlayedAt: null,
    requestPermissions: params.requestPermissions,
    overrideDailyTitle: params.title,
    overrideDailyBody: params.body,
  });
}
