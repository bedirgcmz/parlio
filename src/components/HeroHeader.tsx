import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet, type DimensionValue } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/useAuthStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { GradientView } from "@/components/GradientView";
import { countTodayLearned } from "@/utils/progressHelpers";

export function HeroHeader() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const displayName = useAuthStore((state) => state.user?.display_name ?? "");
  const { stats, progress, loadProgress } = useProgressStore();
  const { dailyGoal } = useSettingsStore();

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const todayLearned = useMemo(
    () => countTodayLearned(progress) + stats.todayLearnedUserSentences,
    [progress, stats.todayLearnedUserSentences]
  );

  const hour = new Date().getHours();
  const greetingKey =
    hour < 12
      ? "home.greeting_morning"
      : hour < 18
        ? "home.greeting_afternoon"
        : "home.greeting_evening";
  const greetingEmoji = hour < 12 ? "🌅" : hour < 18 ? "☀️" : "🌙";

  const firstName = displayName.split(" ")[0] ?? "";
  const goalProgress = Math.min(todayLearned / Math.max(dailyGoal, 1), 1);
  const progressPct = `${Math.round(goalProgress * 100)}%`;

  // Solid equivalents of the transparent tints — works on both iOS & Android.
  // rgba(77,163,255,0.07) over light bg ≈ #EBF3FF; over dark bg ≈ #1A2540
  // rgba(139,92,246,0.07) over light bg ≈ #F0EBFF; over dark bg ≈ #201A38
  const cardGradient: [string, string] = isDark
    ? ["#1A2540", "#201A38"]
    : ["#EBF3FF", "#F0EBFF"];

  const borderColor = isDark ? "rgba(139,92,246,0.22)" : "rgba(77,163,255,0.18)";
  const progressBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  return (
    // Outer: handles border + shadow. backgroundColor matches card so Android
    // elevation renders the shadow correctly (elevation needs a bg color).
    <View
      style={[
        styles.cardOuter,
        {
          borderColor,
          backgroundColor: isDark ? "#1A2540" : "#EBF3FF",
          shadowColor: isDark ? "#8B5CF6" : "#4DA3FF",
        },
      ]}
    >
      {/* Inner: clips gradient to rounded corners */}
      <View style={styles.cardInner}>
        <GradientView
          colors={cardGradient}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        {/* Greeting row */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: colors.text }]}>
              {greetingEmoji} {t(greetingKey)}{firstName ? `, ${firstName}` : ""}!
            </Text>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              {todayLearned >= dailyGoal ? t("home.goal_done") : t("home.goal_hint")}
            </Text>
          </View>

          {/* Streak badge */}
          {stats.currentStreak > 0 && (
            <View
              style={[
                styles.streakBadge,
                {
                  backgroundColor: isDark
                    ? "rgba(245,158,11,0.20)"
                    : "rgba(245,158,11,0.14)",
                },
              ]}
            >
              <Text style={styles.streakFire}>🔥</Text>
              <Text style={[styles.streakCount, { color: "#F59E0B" }]}>
                {stats.currentStreak}
              </Text>
              <Text style={[styles.streakLabel, { color: "#F59E0B" }]}>
                {t("home.streak_days")}
              </Text>
            </View>
          )}
        </View>

        {/* Progress bar */}
        <View style={styles.progressSection}>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              {t("home.daily_goal")}
            </Text>
            <Text style={[styles.progressCount, { color: colors.textSecondary }]}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>{todayLearned}</Text>
              {" / "}{dailyGoal}
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: progressBg }]}>
            <GradientView
              colors={["#4DA3FF", "#49C98A"]}
              style={[styles.progressFill, { width: progressPct as DimensionValue }]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardOuter: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  cardInner: {
    borderRadius: 19,
    overflow: "hidden",
    padding: 12,
    paddingHorizontal: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  greeting: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 26,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  streakFire: { fontSize: 14 },
  streakCount: { fontSize: 16, fontWeight: "700" },
  streakLabel: { fontSize: 11, fontWeight: "500" },
  progressSection: {
    gap: 7,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: { fontSize: 12, fontWeight: "500" },
  progressCount: { fontSize: 12 },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 7,
    borderRadius: 4,
  },
});
