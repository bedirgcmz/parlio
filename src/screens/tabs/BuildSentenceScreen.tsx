import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  useWindowDimensions,
  Modal,
  Pressable,
} from "react-native";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { useSentenceStore } from "@/store/useSentenceStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ContentReportSheet } from "@/components/report/ContentReportSheet";
import { ReportIconButton } from "@/components/report/ReportIconButton";
import { showContentReportAlert } from "@/lib/contentReportAlerts";
import { buildPresetSentenceReportInput } from "@/lib/contentReportSnapshot";
import { submitContentReport } from "@/services/contentReports";
import { HomeStackParamList, MainStackParamList, Sentence } from "@/types";
import type { ContentReportReason } from "@/types/contentReports";
import { buildWordChips, WordChip } from "@/utils/buildSentence";
import { stripMarkers } from "@/utils/keywords";
import { VisualBadge } from "@/components/VisualBadge";
import { QUIZ_CORRECT_COLOR, QUIZ_WRONG_COLOR, FREE_BUILD_SENTENCE_DAILY_LIMIT } from "@/utils/constants";
import * as Haptics from "expo-haptics";
import { useAuthStore } from "@/store/useAuthStore";
import { useNetworkStore } from "@/store/useNetworkStore";
import { useAchievementStore } from "@/store/useAchievementStore";
import {
  loadQuizDailyLimitStatus,
  type QuizDailyLimitStatus,
} from "@/services/quizLimits";

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList>,
  NativeStackNavigationProp<MainStackParamList>
>;


// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  title,
  current,
  total,
  onBack,
  colors,
  rightAccessory,
}: {
  title: string;
  current: number;
  total: number;
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  rightAccessory?: React.ReactNode;
}) {
  return (
    <View style={[headerStyles.row, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} hitSlop={8} style={headerStyles.back}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[headerStyles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={headerStyles.rightArea}>
        {rightAccessory}
        {total > 0 ? (
          <Text style={[headerStyles.counter, { color: colors.textSecondary }]}>
            {current + 1} / {total}
          </Text>
        ) : (
          <View style={headerStyles.counterPlaceholder} />
        )}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  back: {
    width: 32,
    alignItems: "center",
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  counter: {
    width: 48,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "500",
  },
  rightArea: {
    minWidth: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  counterPlaceholder: {
    width: 48,
  },
});

// ─── SourceCard ───────────────────────────────────────────────────────────────

function SourceCard({
  sentence,
  label,
  colors,
}: {
  sentence: Sentence;
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const sourceText = stripMarkers(sentence.source_text);
  return (
    <View style={[sourceStyles.card, { backgroundColor: colors.cardBackground, shadowColor: colors.text }]}>
      <Text style={[sourceStyles.label, { color: colors.textTertiary }]}>{label}</Text>
      <View style={sourceStyles.row}>
        <VisualBadge
          imageUrl={sentence.visual_image_url}
          size={48}
          borderRadius={8}
          backgroundColor={colors.backgroundSecondary}
          borderColor={colors.border}
          placeholderColor={colors.textTertiary}
          imageOverflow={{ top: 10, bottom: 10, horizontal: 10 }}
        />
        <Text style={[sourceStyles.text, { color: colors.text }]}>{sourceText}</Text>
      </View>
    </View>
  );
}

const sourceStyles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginTop: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    gap: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 26,
  },
});

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({
  title,
  desc,
  colors,
  t,
  onPrimary,
  onSecondary,
}: {
  title: string;
  desc: string;
  colors: ReturnType<typeof useTheme>["colors"];
  t: (k: string) => string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <View style={emptyStyles.container}>
      <Text style={emptyStyles.emoji}>📚</Text>
      <Text style={[emptyStyles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[emptyStyles.desc, { color: colors.textSecondary }]}>{desc}</Text>
      <View style={emptyStyles.actions}>
        <TouchableOpacity
          style={[emptyStyles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={onPrimary}
          activeOpacity={0.85}
        >
          <Ionicons name="list-outline" size={16} color="#FFFFFF" />
          <Text style={emptyStyles.primaryButtonText}>{t("quiz.go_to_sentences")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            emptyStyles.secondaryButton,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onPress={onSecondary}
          activeOpacity={0.85}
        >
          <Ionicons name="grid-outline" size={16} color={colors.primary} />
          <Text style={[emptyStyles.secondaryButtonText, { color: colors.text }]}>
            {t("common.explore_categories")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emoji: { fontSize: 48 },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  desc: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  actions: {
    width: "100%",
    marginTop: 4,
    gap: 10,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BuildSentenceScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const { height: screenHeight } = useWindowDimensions();
  const isSmallScreen = screenHeight < 700;

  const { sentences, presetSentences, loadSentences, loadPresetSentences } = useSentenceStore();
  const { progressMap, loadProgress, recordQuizResult } = useProgressStore();
  const { targetLanguage, uiLanguage } = useSettingsStore();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isPremium = useAuthStore((s) => s.user?.is_premium ?? false);
  const reconnectCount = useNetworkStore((s) => s.reconnectCount);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // Word chip state — rebuilt whenever sentence changes
  const [wordBank, setWordBank] = useState<WordChip[]>([]);
  const [dropZone, setDropZone] = useState<WordChip[]>([]);
  const [correctOrder, setCorrectOrder] = useState<string[]>([]);

  // Selection state for select/swap/replace interaction
  const [selectedDropChipId, setSelectedDropChipId] = useState<string | null>(null);

  // Info modal
  const [infoVisible, setInfoVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Validate / feedback state
  type Phase = "arranging" | "correct" | "wrong";
  const [phase, setPhase] = useState<Phase>("arranging");
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [sessionComplete, setSessionComplete] = useState(false);

  // Daily limit
  const [dailyCount, setDailyCount] = useState(0);
  const [dailyCountLoaded, setDailyCountLoaded] = useState(false);
  const [dailyLimitOfflineBlocked, setDailyLimitOfflineBlocked] = useState(false);
  const dailyLimitReached =
    !isPremium && (dailyLimitOfflineBlocked || dailyCount >= FREE_BUILD_SENTENCE_DAILY_LIMIT);

  // Learning list — stored in state so updating it triggers a re-render and
  // allows the word-chip effect ([currentSentence?.id]) to fire correctly.
  const [learningSentences, setLearningSentences] = useState<Sentence[]>([]);

  useEffect(() => {
    setInitialized(false);
    Promise.all([loadSentences(), loadPresetSentences(undefined, isPremium), loadProgress()]).finally(() =>
      setInitialized(true)
    );
  }, [targetLanguage, uiLanguage, isPremium]);

  useEffect(() => {
    let cancelled = false;

    const loadDailyLimit = async () => {
      setDailyCountLoaded(false);
      setDailyLimitOfflineBlocked(false);

      if (!userId) {
        setDailyCountLoaded(true);
        return;
      }

      const result = await loadQuizDailyLimitStatus(userId, "build_sentence");
      if (cancelled) return;

      if (result.status) {
        setDailyCount(result.status.usedCount);
        setDailyLimitOfflineBlocked(false);
      } else {
        setDailyCount(0);
        setDailyLimitOfflineBlocked(!isPremium);
      }

      setDailyCountLoaded(true);
    };

    void loadDailyLimit();
    return () => {
      cancelled = true;
    };
  }, [userId, isPremium, reconnectCount]);

  const applyLimitStatus = (status: QuizDailyLimitStatus | null | undefined) => {
    if (!status) return;
    setDailyCount(status.usedCount);
    setDailyLimitOfflineBlocked(false);
  };

  // Build & shuffle the learning list once after data loads.
  // Read directly from Zustand store state to avoid stale-closure race between
  // `setInitialized(true)` and the Zustand subscription re-render propagating.
  useEffect(() => {
    if (!initialized) return;
    const { sentences: s, presetSentences: ps } = useSentenceStore.getState();
    const { progressMap: pm } = useProgressStore.getState();
    const { targetLanguage: tl, uiLanguage: ul } = useSettingsStore.getState();
    const learning = [
      ...s.filter((sent) => sent.status === "learning" && (sent.target_lang ?? tl) === tl && (sent.source_lang ?? ul) === ul),
      ...ps.filter((sent) => pm[sent.id] === "learning"),
    ];
    setLearningSentences([...learning].sort(() => Math.random() - 0.5));
    setCurrentIndex(0);
  }, [initialized]);

  const total = learningSentences.length;
  const currentSentence = learningSentences[currentIndex] ?? null;

  const handleSubmitReport = useCallback(
    async (reason: ContentReportReason, note: string) => {
      if (!currentSentence || !currentSentence.is_preset) return;

      setReportSubmitting(true);
      try {
        const baseInput = buildPresetSentenceReportInput({
          sentence: currentSentence,
          sourceLang: uiLanguage,
          targetLang: targetLanguage,
          screenContext: "build_sentence",
        });

        const result = await submitContentReport({
          ...baseInput,
          reportReason: reason,
          userNote: note,
        });

        setReportVisible(false);
        showContentReportAlert(t, result);
      } finally {
        setReportSubmitting(false);
      }
    },
    [currentSentence, t, targetLanguage, uiLanguage],
  );

  // Rebuild word chips whenever the current sentence changes
  useEffect(() => {
    if (!currentSentence) return;
    const { chips, correctOrder: order } = buildWordChips(
      currentSentence,
      learningSentences,
      3,
    );
    setWordBank(chips);
    setDropZone([]);
    setCorrectOrder(order);
    setSelectedDropChipId(null);
  }, [currentSentence?.id]);

  const handleBankChipPress = useCallback((chip: WordChip) => {
    if (phase !== "arranging") return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedDropChipId !== null) {
      // Replace: bank chip takes selected's position, selected goes back to bank
      const selectedChip = dropZone.find((c) => c.id === selectedDropChipId);
      setDropZone((prev) => prev.map((c) => (c.id === selectedDropChipId ? chip : c)));
      setWordBank((prev) => [
        ...prev.filter((c) => c.id !== chip.id),
        ...(selectedChip ? [selectedChip] : []),
      ]);
      setSelectedDropChipId(null);
    } else {
      // No selection — normal append
      setWordBank((prev) => prev.filter((c) => c.id !== chip.id));
      setDropZone((prev) => [...prev, chip]);
    }
  }, [phase, selectedDropChipId, dropZone]);

  const handleLongPressDropChip = useCallback((chip: WordChip) => {
    if (phase !== "arranging") return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDropZone((prev) => prev.filter((c) => c.id !== chip.id));
    setWordBank((prev) => [...prev, chip]);
    setSelectedDropChipId((prev) => (prev === chip.id ? null : prev));
  }, [phase]);

  const handleUndo = useCallback(() => {
    if (phase !== "arranging" || dropZone.length === 0) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const lastChip = dropZone[dropZone.length - 1];
    setDropZone((prev) => prev.slice(0, -1));
    setWordBank((prev) => [...prev, lastChip]);
    setSelectedDropChipId((prev) => (prev === lastChip.id ? null : prev));
  }, [phase, dropZone]);

  const handleDropChipPress = useCallback((chip: WordChip) => {
    if (phase !== "arranging") return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedDropChipId((selectedId) => {
      if (selectedId === null) {
        // 1) No selection → select this chip
        return chip.id;
      }
      if (selectedId === chip.id) {
        // 2) Same chip tapped → deselect
        return null;
      }
      // 3) Different chip selected → swap positions
      setDropZone((prev) => {
        const next = [...prev];
        const idxA = next.findIndex((c) => c.id === selectedId);
        const idxB = next.findIndex((c) => c.id === chip.id);
        if (idxA !== -1 && idxB !== -1) {
          [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
        }
        return next;
      });
      return null; // clear selection after swap
    });
  }, [phase]);

  const handleValidate = useCallback(() => {
    if (dailyLimitReached) return;

    const placed = dropZone.map((c) => c.normalized);
    const isCorrect =
      placed.length === correctOrder.length &&
      placed.every((w, i) => w === correctOrder[i]);

    if (isCorrect) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setPhase(isCorrect ? "correct" : "wrong");
    const newTotal = score.total + 1;
    const newCorrect = score.correct + (isCorrect ? 1 : 0);
    setScore({ correct: newCorrect, total: newTotal });
    setDailyCount((count) => count + 1);

    // Persist to quiz_results for stats & daily limit tracking
    if (currentSentence) {
      void recordQuizResult({
        user_id: "",
        sentence_id: currentSentence.is_preset ? currentSentence.id : null,
        user_sentence_id: currentSentence.is_preset ? null : currentSentence.id,
        is_correct: isCorrect,
        quiz_type: "build_sentence",
        bypassDailyLimit: isPremium,
      }).then((result) => {
        applyLimitStatus(result.status);
        if (result.missingSnapshot) {
          setDailyLimitOfflineBlocked(true);
        }
      });
    }

    // Achievement check for build_total milestones
    useAchievementStore.getState().checkProgressAchievements({
      totalSentencesLearned: 0,
      currentStreak: 0,
      totalQuizQuestions: 0,
      totalBuildSentences: dailyCount + 1, // approximate; loadStats has exact total
    });
  }, [dropZone, correctOrder, dailyLimitReached, currentSentence, recordQuizResult, score, dailyCount, isPremium]);

  const handleGoNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= total) {
      // Check perfect_build: all answers correct in this session
      const finalCorrect = score.correct + (phase === "correct" ? 0 : 0); // score already updated
      const isPerfect = score.total > 0 && score.correct === score.total;
      if (isPerfect) {
        useAchievementStore.getState().checkProgressAchievements({
          totalSentencesLearned: 0,
          currentStreak: 0,
          totalQuizQuestions: 0,
          perfectBuildSession: true,
        });
      }
      setSessionComplete(true);
      return;
    }
    setPhase("arranging");
    setCurrentIndex(nextIndex);
  }, [currentIndex, total, score, phase]);

  const handleRestart = useCallback(() => {
    const { sentences: s, presetSentences: ps } = useSentenceStore.getState();
    const { progressMap: pm } = useProgressStore.getState();
    const { targetLanguage: tl, uiLanguage: ul } = useSettingsStore.getState();
    const learning = [
      ...s.filter((sent) => sent.status === "learning" && (sent.target_lang ?? tl) === tl && (sent.source_lang ?? ul) === ul),
      ...ps.filter((sent) => pm[sent.id] === "learning"),
    ];
    setLearningSentences([...learning].sort(() => Math.random() - 0.5));
    setCurrentIndex(0);
    setPhase("arranging");
    setScore({ correct: 0, total: 0 });
    setSessionComplete(false);
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!initialized || !dailyCountLoaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <Header
          title={t("build_sentence.title")}
          current={0}
          total={0}
          onBack={() => navigation.goBack()}
          colors={colors}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (total === 0 || !currentSentence) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <Header
          title={t("build_sentence.title")}
          current={0}
          total={0}
          onBack={() => navigation.goBack()}
          colors={colors}
        />
        <EmptyState
          title={t("build_sentence.empty_title")}
          desc={t("build_sentence.empty_desc")}
          colors={colors}
          t={t}
          onPrimary={() => navigation.getParent()?.navigate("Sentences" as never)}
          onSecondary={() => navigation.navigate("CategoryBrowser")}
        />
      </SafeAreaView>
    );
  }

  // ── Daily limit wall ─────────────────────────────────────────────────────
  if (dailyLimitReached && phase === "arranging") {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <Header
          title={t("build_sentence.title")}
          current={currentIndex}
          total={total}
          onBack={() => navigation.goBack()}
          colors={colors}
        />
        <View style={styles.center}>
          <Text style={[styles.completeEmoji, isSmallScreen && { fontSize: 40, marginBottom: 4 }]}>⏳</Text>
          <Text style={[styles.completeTitle, isSmallScreen && { fontSize: 18, marginBottom: 4 }, { color: colors.text }]}>
            {dailyLimitOfflineBlocked ? t("common.offline_title") : t("build_sentence.limit_title")}
          </Text>
          <Text style={[styles.limitDesc, isSmallScreen && { paddingHorizontal: 20, marginBottom: 16 }, { color: colors.textSecondary }]}>
            {dailyLimitOfflineBlocked ? t("common.offline_body") : t("build_sentence.limit_desc")}
          </Text>
          {!dailyLimitOfflineBlocked && (
            <TouchableOpacity
              style={[styles.primaryBtn, styles.premiumBtn]}
              onPress={() => navigation.navigate("Paywall", { source: "quiz" })}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryBtnText}>✨ Premium</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Session complete ──────────────────────────────────────────────────────
  if (sessionComplete) {
    const accuracy = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <Header
          title={t("build_sentence.title")}
          current={total - 1}
          total={total}
          onBack={() => navigation.goBack()}
          colors={colors}
        />
        <View style={styles.center}>
          <Text style={[styles.completeEmoji, isSmallScreen && { fontSize: 40, marginBottom: 4 }]}>🏆</Text>
          <Text style={[styles.completeTitle, isSmallScreen && { fontSize: 18, marginBottom: 4 }, { color: colors.text }]}>
            {t("build_sentence.session_complete")}
          </Text>
          <Text style={[styles.completeScore, isSmallScreen && { fontSize: 14 }, { color: colors.textSecondary }]}>
            {t("build_sentence.session_score", { correct: score.correct, total: score.total })}
          </Text>
          <Text style={[styles.completeAccuracy, isSmallScreen && { fontSize: 32, marginBottom: 16 }, { color: colors.primary }]}>
            {accuracy}%
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.completeBtn, { backgroundColor: colors.primary }]}
            onPress={handleRestart}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>{t("build_sentence.restart")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  const dropZoneBorderColor =
    phase === "correct"
      ? QUIZ_CORRECT_COLOR
      : phase === "wrong"
        ? QUIZ_WRONG_COLOR
        : dropZone.length > 0
          ? colors.primary
          : colors.border;

  const canValidate = dropZone.length === correctOrder.length && phase === "arranging";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <Header
        title={t("build_sentence.title")}
        current={currentIndex}
        total={total}
        onBack={() => navigation.goBack()}
        colors={colors}
        rightAccessory={
          currentSentence?.is_preset ? (
            <ReportIconButton onPress={() => setReportVisible(true)} size={28} iconSize={17} />
          ) : undefined
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Source sentence card */}
        <SourceCard
          sentence={currentSentence}
          label={t("build_sentence.source_label")}
          colors={colors}
        />

        {/* ── Drop zone ── */}
        {/* Drop zone header row: helper text + undo button */}
        <View style={styles.dropZoneHeader}>
          <Text style={[styles.dropZoneHelperText, { color: selectedDropChipId ? colors.primary : colors.textTertiary }]}>
            {selectedDropChipId
              ? t("build_sentence.helper_selected")
              : dropZone.length > 0
                ? t("build_sentence.helper_default")
                : ""}
          </Text>
          <View style={styles.dropZoneActions}>
            {phase === "arranging" && dropZone.length > 0 && (
              <TouchableOpacity onPress={handleUndo} hitSlop={10} style={styles.undoBtn}>
                <Ionicons name="arrow-undo-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setInfoVisible(true)} hitSlop={10} style={styles.infoBtn}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
        <View
          style={[
            styles.dropZone,
            isSmallScreen && { marginTop: 4, minHeight: 72 },
            {
              backgroundColor: colors.surface ?? colors.backgroundSecondary,
              borderColor: dropZoneBorderColor,
              borderStyle: phase === "arranging" && dropZone.length === 0 ? "dashed" : "solid",
            },
          ]}
        >
          {dropZone.length === 0 ? (
            <Text style={[styles.dropHint, { color: colors.textTertiary }]}>
              {t("build_sentence.drop_hint")}
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {dropZone.map((chip) => {
                const isSelected = phase === "arranging" && chip.id === selectedDropChipId;
                const chipBg =
                  phase === "correct"
                    ? QUIZ_CORRECT_COLOR + "22"
                    : phase === "wrong"
                      ? QUIZ_WRONG_COLOR + "22"
                      : isSelected
                        ? colors.primary + "33"
                        : colors.primary + "18";
                const chipBorder =
                  phase === "correct"
                    ? QUIZ_CORRECT_COLOR
                    : phase === "wrong"
                      ? QUIZ_WRONG_COLOR
                      : colors.primary;
                const chipTextColor =
                  phase === "correct"
                    ? QUIZ_CORRECT_COLOR
                    : phase === "wrong"
                      ? QUIZ_WRONG_COLOR
                      : colors.primary;
                return (
                  <TouchableOpacity
                    key={chip.id}
                    onPress={() => handleDropChipPress(chip)}
                    onLongPress={() => handleLongPressDropChip(chip)}
                    delayLongPress={350}
                    activeOpacity={phase === "arranging" ? 0.7 : 1}
                    disabled={phase !== "arranging"}
                    style={[
                      styles.chip,
                      styles.chipPlaced,
                      { backgroundColor: chipBg, borderColor: chipBorder },
                      isSelected && styles.chipSelected,
                    ]}
                  >
                    <Text style={[styles.chipText, { color: chipTextColor, fontWeight: isSelected ? "700" : "500" }]}>
                      {chip.display}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Feedback bar ── */}
        {phase !== "arranging" && (
          <View
            style={[
              styles.feedbackBar,
              {
                backgroundColor:
                  phase === "correct" ? QUIZ_CORRECT_COLOR + "18" : QUIZ_WRONG_COLOR + "18",
                borderColor:
                  phase === "correct" ? QUIZ_CORRECT_COLOR : QUIZ_WRONG_COLOR,
              },
            ]}
          >
            <Ionicons
              name={phase === "correct" ? "checkmark-circle" : "close-circle"}
              size={20}
              color={phase === "correct" ? QUIZ_CORRECT_COLOR : QUIZ_WRONG_COLOR}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.feedbackText,
                  { color: phase === "correct" ? QUIZ_CORRECT_COLOR : QUIZ_WRONG_COLOR },
                ]}
              >
                {phase === "correct"
                  ? t("build_sentence.correct_feedback")
                  : t("build_sentence.wrong_feedback")}
              </Text>
              {phase === "wrong" && (
                <Text style={[styles.correctAnswerLabel, { color: colors.textSecondary }]}>
                  {t("build_sentence.correct_answer_label")}{" "}
                  <Text style={{ fontWeight: "600", color: colors.text }}>
                    {correctOrder.join(" ")}
                  </Text>
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ── Divider ── */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* ── Word bank ── */}
        <View style={styles.wordBankContainer}>
          <View style={styles.chipRow}>
            {wordBank.map((chip) => (
              <TouchableOpacity
                key={chip.id}
                onPress={() => handleBankChipPress(chip)}
                activeOpacity={0.7}
                disabled={phase !== "arranging"}
                style={[
                  styles.chip,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                  phase !== "arranging" && styles.chipDisabled,
                ]}
              >
                <Text style={[styles.chipText, { color: colors.text }]}>{chip.display}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <ContentReportSheet
        visible={reportVisible}
        loading={reportSubmitting}
        contentType="preset_sentence"
        onClose={() => !reportSubmitting && setReportVisible(false)}
        onSubmit={handleSubmitReport}
      />

      {/* ── Bottom action button ── */}
      <View style={[styles.bottomBar, isSmallScreen && { paddingVertical: 8 }, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {phase === "arranging" ? (
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              isSmallScreen && { height: 44 },
              { backgroundColor: canValidate ? colors.primary : colors.border },
            ]}
            onPress={handleValidate}
            disabled={!canValidate}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryBtnText, !canValidate && { color: colors.textTertiary }]}>
              {t("build_sentence.validate")}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              isSmallScreen && { height: 44 },
              {
                backgroundColor:
                  phase === "correct" ? QUIZ_CORRECT_COLOR : QUIZ_WRONG_COLOR,
              },
            ]}
            onPress={handleGoNext}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>{t("build_sentence.continue")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Info Modal ── */}
      <Modal
        visible={infoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setInfoVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.cardBackground }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("build_sentence.info_title")}
            </Text>

            {[
              { icon: "add-circle-outline" as const, key: "build_sentence.info_add" },
              { icon: "swap-horizontal-outline" as const, key: "build_sentence.info_replace" },
              { icon: "repeat-outline" as const, key: "build_sentence.info_swap" },
              { icon: "backspace-outline" as const, key: "build_sentence.info_remove" },
            ].map(({ icon, key }) => (
              <View key={key} style={styles.modalRow}>
                <Ionicons name={icon} size={18} color={colors.primary} style={styles.modalRowIcon} />
                <Text style={[styles.modalRowText, { color: colors.text }]}>{t(key)}</Text>
              </View>
            ))}

            <View style={[styles.modalNote, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="bulb-outline" size={14} color={colors.textSecondary} style={{ marginTop: 1 }} />
              <Text style={[styles.modalNoteText, { color: colors.textSecondary }]}>
                {t("build_sentence.info_note")}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.modalClose, { backgroundColor: colors.primary }]}
              onPress={() => setInfoVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCloseText}>{t("common.got_it")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  dropZoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    minHeight: 20,
  },
  dropZoneHelperText: {
    fontSize: 11,
    fontWeight: "500",
    flex: 1,
  },
  dropZoneActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  undoBtn: {
    padding: 4,
  },
  infoBtn: {
    padding: 4,
  },
  dropZone: {
    marginHorizontal: 16,
    marginTop: 0,
    minHeight: 88,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 12,
    justifyContent: "center",
  },
  dropHint: {
    fontSize: 13,
    textAlign: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 20,
  },
  wordBankContainer: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  chipPlaced: {
    borderStyle: "solid",
  },
  chipSelected: {
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    fontSize: 15,
    fontWeight: "500",
  },
  feedbackBar: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  correctAnswerLabel: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  completeEmoji: { fontSize: 56, marginBottom: 8 },
  completeTitle: { fontSize: 22, fontWeight: "800", marginBottom: 6, textAlign: "center" },
  completeScore: { fontSize: 16, marginBottom: 4 },
  completeAccuracy: { fontSize: 42, fontWeight: "800", marginBottom: 24 },
  completeBtn: { alignSelf: "stretch", marginHorizontal: 32 },
  limitDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 32,
    marginTop: 8,
    marginBottom: 24,
  },
  premiumBtn: {
    width: 200,
    backgroundColor: "#7C5CF6",
  },
  // ── Info Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    gap: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 2,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  modalRowIcon: {
    marginTop: 1,
    width: 20,
  },
  modalRowText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  modalNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginTop: 2,
  },
  modalNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  modalClose: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  modalCloseText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
