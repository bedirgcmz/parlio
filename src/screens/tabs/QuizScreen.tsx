import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Image,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useIsFocused, useRoute, RouteProp } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { useSentenceStore } from "@/store/useSentenceStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useNetworkStore } from "@/store/useNetworkStore";
import { parseKeywords, getKeywordColor, splitWords, stripMarkers } from "@/utils/keywords";
import { KeywordText } from "@/components/KeywordText";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ContentReportSheet } from "@/components/report/ContentReportSheet";
import { ReportIconButton } from "@/components/report/ReportIconButton";
import { FREE_QUIZ_DAILY_LIMIT } from "@/utils/constants";
import { showContentReportAlert } from "@/lib/contentReportAlerts";
import { buildPresetSentenceReportInput } from "@/lib/contentReportSnapshot";
import { submitContentReport } from "@/services/contentReports";
import {
  HomeStackParamList,
  MainStackParamList,
  PillSegment,
  Sentence,
} from "@/types";
import type { ContentReportReason } from "@/types/contentReports";
import { speak, stopSpeaking } from "@/services/tts";
import { useAchievementStore } from "@/store/useAchievementStore";
import { HintBottomSheet } from "@/components/HintBottomSheet";
import { useOnboarding } from "@/providers/OnboardingProvider";
import {
  loadQuizDailyLimitStatus,
  type QuizDailyLimitStatus,
} from "@/services/quizLimits";

type QuizMode = "multiple_choice" | "fill_blank";

interface MCQuestion {
  type: "multiple_choice";
  sentence: Sentence;
  options: string[];
  correctAnswer: string;
}

interface FBQuestion {
  type: "fill_blank";
  sentence: Sentence;
  contextText: string; // source text (stripped) — shown as context
  targetSegments: PillSegment[]; // parsed target_text for rendering with blanks
  keywords: string[]; // expected keyword answers (in order)
}

type Question = MCQuestion | FBQuestion;

function generateMCQuestion(sentence: Sentence, allSentences: Sentence[]): MCQuestion | null {
  const others = allSentences.filter((s) => s.id !== sentence.id);
  if (others.length < 3) return null;

  const wrong = [...others]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((s) => stripMarkers(s.source_text));
  const correct = stripMarkers(sentence.source_text);
  const options = [...wrong, correct].sort(() => Math.random() - 0.5);

  return { type: "multiple_choice", sentence, options, correctAnswer: correct };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"«»„"]/g, "")
    .replace(/\s+/g, " ");
}

function generateFBQuestion(sentence: Sentence): FBQuestion | null {
  const targetSegments = parseKeywords(sentence.target_text);
  const keywords = targetSegments.filter((s) => s.isPill).map((s) => s.text.trim());
  if (keywords.length === 0) return null; // skip sentences without keyword markers

  return {
    type: "fill_blank",
    sentence,
    contextText: stripMarkers(sentence.source_text),
    targetSegments,
    keywords,
  };
}

function buildSession(
  sentences: Sentence[],
  mode: QuizMode,
  count: number,
  distractors?: Sentence[],
): Question[] {
  const shuffled = [...sentences].sort(() => Math.random() - 0.5);
  const questions: Question[] = [];

  for (const sentence of shuffled) {
    if (questions.length >= count) break;
    const q =
      mode === "multiple_choice"
        ? generateMCQuestion(sentence, distractors ?? sentences)
        : generateFBQuestion(sentence);
    if (q) questions.push(q);
  }

  return questions;
}

export default function QuizScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const { height: screenHeight } = useWindowDimensions();
  const isSmallScreen = screenHeight < 700;
  const navigation =
    useNavigation<
      CompositeNavigationProp<
        NativeStackNavigationProp<HomeStackParamList>,
        NativeStackNavigationProp<MainStackParamList>
      >
    >();
  const route = useRoute<RouteProp<HomeStackParamList, "Quiz">>();
  const { sentences, presetSentences, loadSentences, loadPresetSentences } = useSentenceStore();
  const { progressMap, loadProgress, recordQuizResult } = useProgressStore();
  const { uiLanguage, targetLanguage, ttsEnabled } = useSettingsStore();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isPremium = useAuthStore((s) => s.user?.is_premium ?? false);
  const reconnectCount = useNetworkStore((s) => s.reconnectCount);
  const isFocused = useIsFocused();

  const [mode, setMode] = useState<QuizMode>(
    route.params?.initialMode === "fill_blank" ? "fill_blank" : "multiple_choice"
  );
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [keywordInputs, setKeywordInputs] = useState<string[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [dailyLimitLoaded, setDailyLimitLoaded] = useState(false);
  const [dailyLimitOfflineBlocked, setDailyLimitOfflineBlocked] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<Question[]>([]);
  const [isRetryPhase, setIsRetryPhase] = useState(false);
  const [mainScore, setMainScore] = useState({ correct: 0, total: 0 });
  const { isHintShown, markHintShown } = useOnboarding();
  const [hintQuizVisible, setHintQuizVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quizMuted, setQuizMuted] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const goToSentencesTab = () => navigation.getParent()?.navigate("Sentences" as never);
  const goBackFromEmptyState = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.getParent()?.navigate("Home" as never);
  };

  const renderEmptyActions = () => (
    <View style={styles.emptyActions}>
      <TouchableOpacity
        style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
        onPress={goToSentencesTab}
        activeOpacity={0.85}
      >
        <Ionicons name="list-outline" size={16} color="#fff" />
        <Text style={styles.emptyBtnText}>{t("quiz.go_to_sentences")}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.emptySecondaryBtn,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        onPress={() => navigation.navigate("CategoryBrowser")}
        activeOpacity={0.85}
        >
          <Ionicons name="grid-outline" size={16} color={colors.primary} />
          <Text style={[styles.emptySecondaryBtnText, { color: colors.text }]}>
            {t("common.explore_categories")}
          </Text>
        </TouchableOpacity>
    </View>
  );
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // perfect_quiz: 100% accuracy in a main session (no wrong answers → no retry phase)
  useEffect(() => {
    if (sessionComplete && !isRetryPhase && score.total > 0 && score.correct === score.total) {
      useAchievementStore.getState().unlockAchievement("perfect_quiz");
    }
  }, [sessionComplete]);

  // First quiz completion hint
  useEffect(() => {
    if (sessionComplete && !isRetryPhase && !isHintShown("quizDone")) {
      markHintShown("quizDone");
      setHintQuizVisible(true);
    }
  }, [sessionComplete, isRetryPhase]);
  const kwInputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadDailyLimit = async () => {
      if (!isFocused) return;

      setDailyLimitLoaded(false);
      setDailyLimitOfflineBlocked(false);

      if (!userId) {
        setDailyLimitLoaded(true);
        return;
      }

      const result = await loadQuizDailyLimitStatus(userId, "quiz");
      if (cancelled) return;

      if (result.status) {
        setDailyCount(result.status.usedCount);
        setDailyLimitOfflineBlocked(false);
      } else {
        setDailyCount(0);
        setDailyLimitOfflineBlocked(!isPremium);
      }

      setDailyLimitLoaded(true);
    };

    void loadDailyLimit();
    return () => {
      cancelled = true;
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    };
  }, [userId, isPremium, reconnectCount, isFocused]);

  useEffect(() => {
    setInitialized(false);
    Promise.all([loadSentences(), loadPresetSentences(undefined, isPremium), loadProgress()]).finally(() =>
      setInitialized(true),
    );
  }, [targetLanguage, uiLanguage, isPremium]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSentences(), loadPresetSentences(undefined, isPremium), loadProgress()]);
    setRefreshing(false);
  };

  // Auto-focus first keyword input on fill_blank question load
  useEffect(() => {
    const q = questions[currentIdx];
    if (mode !== "fill_blank" || !q || q.type !== "fill_blank") return;
    const timer = setTimeout(() => kwInputRefs.current[0]?.focus(), 150);
    return () => clearTimeout(timer);
  }, [currentIdx, mode, questions]);

  // Auto-speak MC question when it loads
  useEffect(() => {
    if (!initialized || !isFocused) return;
    const q = questions[currentIdx];
    if (mode !== "multiple_choice" || !q || q.type !== "multiple_choice") return;
    if (!ttsEnabled || quizMuted) return;
    const timer = setTimeout(() => {
      speak(stripMarkers(q.sentence.target_text), targetLanguage);
    }, 150);
    return () => {
      clearTimeout(timer);
      stopSpeaking();
    };
  }, [currentIdx, mode, questions, ttsEnabled, quizMuted, initialized, isFocused]);

  const allSentences: Sentence[] = [
    ...sentences.filter(
      (s) =>
        (s.target_lang ?? targetLanguage) === targetLanguage &&
        (s.source_lang ?? uiLanguage) === uiLanguage,
    ),
    ...presetSentences.filter((s) => progressMap[s.id] !== undefined),
  ];

  const learningSentences = allSentences.filter(
    (s) => s.status === "learning" || progressMap[s.id] === "learning",
  );

  const filteredLearningSentences = learningSentences;

  const sessionSize = isPremium ? 20 : FREE_QUIZ_DAILY_LIMIT;
  const dailyLimitReached =
    !isPremium && (dailyLimitOfflineBlocked || dailyCount >= FREE_QUIZ_DAILY_LIMIT);

  const applyLimitStatus = (status: QuizDailyLimitStatus | null | undefined) => {
    if (!status) return;
    setDailyCount(status.usedCount);
    setDailyLimitOfflineBlocked(false);
  };

  const startSession = () => {
    if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    const qs = buildSession(filteredLearningSentences, mode, sessionSize, allSentences);
    setQuestions(qs);
    setCurrentIdx(0);
    setSelectedOption(null);
    setShowResult(false);
    setKeywordInputs([]);
    setShowHint(false);
    setScore({ correct: 0, total: 0 });
    setSessionComplete(false);
    setWrongQuestions([]);
    setIsRetryPhase(false);
    setMainScore({ correct: 0, total: 0 });
  };

  useEffect(() => {
    if (filteredLearningSentences.length > 0) startSession();
  }, [mode, sentences.length, presetSentences.length, initialized]);

  const currentQ = questions[currentIdx];
  const fbQ = currentQ?.type === "fill_blank" ? (currentQ as FBQuestion) : null;
  const mcQ = currentQ?.type === "multiple_choice" ? (currentQ as MCQuestion) : null;

  const handleSubmitReport = async (reason: ContentReportReason, note: string) => {
    if (!currentQ || !currentQ.sentence.is_preset) return;

    setReportSubmitting(true);
    try {
      const baseInput = buildPresetSentenceReportInput({
        sentence: currentQ.sentence,
        sourceLang: uiLanguage,
        targetLang: targetLanguage,
        screenContext: mode === "fill_blank" ? "quiz_fill_blank" : "quiz_multiple_choice",
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
  };

  // Per-keyword correctness after result reveal
  const kwCorrectness =
    fbQ && showResult
      ? fbQ.keywords.map((kw, idx) => normalize(keywordInputs[idx] ?? "") === normalize(kw))
      : [];

  const commitAnswer = (correct: boolean) => {
    setIsCorrect(correct);
    setShowResult(true);
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    if (!correct) {
      setWrongQuestions((prev) => [...prev, currentQ]);
    }
    // Daily limit and persistence only apply to the main session, not the retry round
    if (!isRetryPhase) {
      setDailyCount((count) => count + 1);
      void recordQuizResult({
        user_id: "",
        sentence_id: currentQ.sentence.is_preset ? currentQ.sentence.id : null,
        user_sentence_id: currentQ.sentence.is_preset ? null : currentQ.sentence.id,
        is_correct: correct,
        quiz_type: currentQ.type,
        bypassDailyLimit: isPremium,
      }).then((result) => {
        applyLimitStatus(result.status);
        if (result.missingSnapshot) {
          setDailyLimitOfflineBlocked(true);
        }
      });
    }
  };

  const handleMCAnswer = (answer: string) => {
    if (showResult || dailyLimitReached) return;
    setSelectedOption(answer);
    commitAnswer(answer === (currentQ as MCQuestion).correctAnswer);
  };

  const handleFBSubmit = () => {
    if (showResult || dailyLimitReached) return;
    const q = currentQ as FBQuestion;
    const correct = q.keywords.every(
      (kw, idx) => normalize(keywordInputs[idx] ?? "") === normalize(kw),
    );
    commitAnswer(correct);
  };

  const goNext = () => {
    if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    const next = currentIdx + 1;
    if (next >= questions.length) {
      if (!isRetryPhase && wrongQuestions.length > 0) {
        setMainScore(score);
        setQuestions([...wrongQuestions]);
        setWrongQuestions([]);
        setCurrentIdx(0);
        setSelectedOption(null);
        setShowResult(false);
        setKeywordInputs([]);
        setShowHint(false);
        setScore({ correct: 0, total: 0 });
        setIsRetryPhase(true);
      } else {
        setSessionComplete(true);
      }
    } else {
      setCurrentIdx(next);
      setSelectedOption(null);
      setShowResult(false);
      setKeywordInputs([]);
      setShowHint(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!initialized || !dailyLimitLoaded) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (learningSentences.length < 2) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBackButton}
            onPress={goBackFromEmptyState}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text
            style={[
              styles.headerTitle,
              styles.headerTitleCentered,
              isSmallScreen && { fontSize: 18 },
              { color: colors.text },
            ]}
          >
            {t("quiz.title")}
          </Text>
          <View style={styles.headerSideSpacer} />
        </View>
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={[styles.emptyCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={styles.emptyIcon}>{route.params?.initialMode === "fill_blank" ? "✏️" : "📚"}</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t(route.params?.initialMode === "fill_blank" ? "quiz.dictation_empty_title" : "quiz.empty_title")}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {t(route.params?.initialMode === "fill_blank" ? "quiz.dictation_empty_hint" : "quiz.empty_hint")}
            </Text>
            {renderEmptyActions()}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Shared Header + Segment ───────────────────────────────────────────────
  const renderHeader = () => (
    <>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={goBackFromEmptyState}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[
            styles.headerTitle,
            styles.headerTitleCentered,
            isSmallScreen && { fontSize: 18 },
            { color: colors.text },
          ]}
        >
          {t("quiz.title")}
        </Text>
        <View style={styles.headerRightControls}>
          <View style={[styles.scoreBadge, { backgroundColor: colors.primary + "18" }]}>
            <Text style={[styles.scoreText, { color: colors.primary }]}>
              ✓ {score.correct}/{score.total}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.segmentContainer, { backgroundColor: colors.backgroundSecondary }]}>
        {(["multiple_choice", "fill_blank"] as QuizMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[
              styles.segmentTab,
              mode === m && [styles.segmentTabActive, { backgroundColor: colors.surface }],
            ]}
            onPress={() => setMode(m)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentLabel,
                { color: mode === m ? colors.text : colors.textSecondary },
              ]}
            >
              {m === "multiple_choice" ? t("quiz.multiple_choice") : t("quiz.fill_blank")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  // No keyword sentences for fill_blank
  if (mode === "fill_blank" && initialized && questions.length === 0 && !sessionComplete) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        {renderHeader()}
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={[styles.emptyCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={styles.emptyIcon}>✏️</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t("quiz.no_keywords_title")}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {t("quiz.no_keywords")}
            </Text>
            {renderEmptyActions()}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (mode === "multiple_choice" && initialized && questions.length === 0 && !sessionComplete) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        {renderHeader()}
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={[styles.emptyCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t("quiz.empty_title")}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {t("quiz.empty_hint")}
            </Text>
            {renderEmptyActions()}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Main Render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      {renderHeader()}

      {/* Retry phase banner */}
      {isRetryPhase && (
        <View
          style={[
            styles.retryBanner,
            { backgroundColor: colors.warning + "22", borderColor: colors.warning + "60" },
          ]}
        >
          <Ionicons name="refresh-circle-outline" size={16} color={colors.warning} />
          <Text style={[styles.retryBannerText, { color: colors.warning }]}>
            {t("quiz.reviewing_wrong", { count: questions.length })}
          </Text>
        </View>
      )}

      {/* Progress bar */}
      {questions.length > 0 && (
        <View style={[styles.progressTrack, isSmallScreen && { marginBottom: 8 }, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${((currentIdx + (showResult ? 1 : 0)) / questions.length) * 100}%`,
              },
            ]}
          />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, isSmallScreen && { paddingBottom: 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Daily limit banner */}
        {dailyLimitReached && (
          <View
            style={[
              styles.limitBanner,
              { backgroundColor: colors.warning + "22", borderColor: colors.warning },
            ]}
          >
            <Text style={[styles.limitText, { color: colors.warning }]}>
              {dailyLimitOfflineBlocked ? t("common.offline_body") : t("quiz.daily_limit_reached")}
            </Text>
            {!dailyLimitOfflineBlocked && (
              <TouchableOpacity
                style={[styles.upgradeBannerBtn, { backgroundColor: colors.warning }]}
                onPress={() => navigation.navigate("Paywall", { source: "quiz" })}
                activeOpacity={0.85}
              >
                <Text style={styles.upgradeBannerBtnText}>{t("premium.title")} →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Session complete */}
        {sessionComplete ? (
          <View style={[styles.doneCard, isSmallScreen && { padding: 20, marginTop: 10 }, { backgroundColor: colors.cardBackground }]}>
            <Text style={styles.doneIcon}>🎉</Text>
            {isRetryPhase ? (
              <>
                <View style={styles.doneScoreRow}>
                  <View style={styles.doneScoreBlock}>
                    <Text style={[styles.doneScoreLabel, { color: colors.textTertiary }]}>
                      {t("quiz.first_round")}
                    </Text>
                    <Text style={[styles.doneScoreNum, { color: colors.text }]}>
                      {mainScore.correct}/{mainScore.total}
                    </Text>
                  </View>
                  <View style={[styles.doneScoreDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.doneScoreBlock}>
                    <Text style={[styles.doneScoreLabel, { color: colors.textTertiary }]}>
                      {t("quiz.retry_round")}
                    </Text>
                    <Text style={[styles.doneScoreNum, { color: colors.primary }]}>
                      {score.correct}/{score.total}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.doneTitle, { color: colors.text }]}>
                  {score.correct}/{score.total} {t("quiz.score")}
                </Text>
                <Text style={[styles.doneSubtitle, { color: colors.textSecondary }]}>
                  {Math.round((score.correct / Math.max(score.total, 1)) * 100)}%{" "}
                  {t("quiz.correct").toLowerCase()}
                </Text>
              </>
            )}
            <TouchableOpacity
              style={[styles.restartBtn, { backgroundColor: colors.primary }]}
              onPress={startSession}
              activeOpacity={0.85}
            >
              <Text style={styles.restartBtnText}>{t("quiz.new_session")}</Text>
            </TouchableOpacity>
          </View>
        ) : currentQ ? (
          <>
            {/* ── Question card ─────────────────────────────────── */}
            <View style={[styles.questionCard, isSmallScreen && { paddingVertical: 8 }, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.questionCardHeader}>
                <Text style={[styles.questionNum, { color: colors.textTertiary }]}>
                  {currentIdx + 1}/{questions.length}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  {currentQ.sentence.is_preset ? (
                    <ReportIconButton onPress={() => setReportVisible(true)} size={24} iconSize={16} />
                  ) : null}
                  <FavoriteButton
                    sentenceId={currentQ.sentence.id}
                    isPreset={currentQ.sentence.is_preset ?? false}
                    size={20}
                  />
                  {mcQ && (
                    <TouchableOpacity
                      onPress={() => setQuizMuted((m) => !m)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={quizMuted ? "volume-mute-outline" : "volume-high-outline"}
                        size={20}
                        color={quizMuted ? colors.textTertiary : colors.primary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* FB: direction badge */}
              {fbQ && (
                <View style={[styles.directionBadge, { backgroundColor: colors.primary + "14" }]}>
                  <Text style={[styles.directionLang, { color: colors.textSecondary }]}>
                    {t(`languages.${uiLanguage}`)}
                  </Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.primary} />
                  <Text
                    style={[
                      styles.directionLang,
                      styles.directionLangTarget,
                      { color: colors.primary },
                    ]}
                  >
                    {t(`languages.${targetLanguage}`)}
                  </Text>
                </View>
              )}

              {/* MC: target sentence with keyword colors */}
              {mcQ && (
                <View style={styles.questionPrompt}>
                  <KeywordText
                    text={currentQ.sentence.target_text}
                    baseColor={colors.text}
                    fontSize={16}
                    lineHeight={22}
                    colorSeed={String(currentQ.sentence.id)}
                  />
                </View>
              )}

              {/* FB: source context + inline fill-blank target */}
              {fbQ && (
                <>
                  {/* Source sentence as context — keywords colored, same seed as target */}
                  <View style={styles.fbContextWrapper}>
                    <KeywordText
                      text={fbQ.sentence.source_text}
                      baseColor={colors.textSecondary}
                      fontSize={16}
                      lineHeight={24}
                      colorSeed={String(fbQ.sentence.id)}
                    />
                  </View>

                  {/* Divider */}
                  <View style={[styles.fbDivider, { backgroundColor: colors.border }]} />

                  {/* Instruction */}
                  <Text style={[styles.fbInstruction, { color: colors.textTertiary }]}>
                    {t("quiz.fill_blank_instruction")}
                  </Text>

                  {/* Target sentence with inline keyword inputs */}
                  <View style={styles.fbSentenceRow}>
                    {fbQ.targetSegments.flatMap((seg, segIdx) => {
                      if (!seg.isPill) {
                        return splitWords(seg.text).map((word, wordIdx) => (
                          <Text
                            key={`txt-${segIdx}-${wordIdx}`}
                            style={[styles.fbWord, { color: colors.text }]}
                          >
                            {word}
                          </Text>
                        ));
                      }

                      const kwIdx = seg.pillIndex!;
                      const kwColor = getKeywordColor(kwIdx, isDark, String(fbQ.sentence.id));
                      const kwIsCorrect = showResult ? kwCorrectness[kwIdx] : null;
                      const borderColor = showResult
                        ? kwIsCorrect
                          ? "#2ECC71"
                          : "#E53E3E"
                        : kwColor;
                      const textColor = showResult
                        ? kwIsCorrect
                          ? "#2ECC71"
                          : "#E53E3E"
                        : colors.text;
                      return [
                        <View key={`kw-${segIdx}`} style={styles.kwWrapper}>
                          {/* Hint: first 3 chars of expected keyword */}
                          {showHint && (
                            <Text style={[styles.kwHint, { color: kwColor }]}>
                              {seg.text.slice(0, 3)}…
                            </Text>
                          )}

                          {/*
                           * kwSizer: ghost text sizes the container, input fills it absolutely.
                           * This makes the input auto-fit any keyword length (1–4 words).
                           */}
                          <View style={styles.kwSizer}>
                            {/* Invisible text that drives the container width */}
                            <Text style={styles.kwSizerText}>{seg.text}</Text>

                            <TextInput
                              ref={(ref) => {
                                kwInputRefs.current[kwIdx] = ref;
                              }}
                              style={[
                                styles.kwInput,
                                {
                                  borderBottomColor: borderColor,
                                  color: textColor,
                                },
                              ]}
                              value={keywordInputs[kwIdx] ?? ""}
                              onChangeText={(val) => {
                                const next = [...keywordInputs];
                                next[kwIdx] = val;
                                setKeywordInputs(next);
                              }}
                              editable={!showResult && !dailyLimitReached}
                              autoCapitalize="none"
                              autoCorrect={false}
                              spellCheck={false}
                              returnKeyType={kwIdx < fbQ.keywords.length - 1 ? "next" : "done"}
                              onSubmitEditing={() => {
                                if (kwIdx < fbQ.keywords.length - 1) {
                                  kwInputRefs.current[kwIdx + 1]?.focus();
                                } else {
                                  handleFBSubmit();
                                }
                              }}
                            />
                          </View>
                        </View>,
                      ];
                    })}
                  </View>

                  {/* Correct answer box (shown when wrong) */}
                  {showResult && !isCorrect && (
                    <View
                      style={[
                        styles.fbCorrectBox,
                        {
                          backgroundColor: colors.success + "18",
                          borderColor: colors.success + "40",
                        },
                      ]}
                    >
                      <Text style={[styles.fbCorrectLabel, { color: colors.success }]}>
                        ✓ {t("quiz.correct_answer_is")}
                      </Text>
                      <KeywordText
                        text={fbQ.sentence.target_text}
                        baseColor={colors.text}
                        fontSize={15}
                        lineHeight={22}
                        colorSeed={String(fbQ.sentence.id)}
                      />
                    </View>
                  )}
                </>
              )}
            </View>

            {/* ── MC options ────────────────────────────────────── */}
            {mcQ && (
              <View style={styles.optionsContainer}>
                {mcQ.options.map((opt, idx) => {
                  let bg = colors.surface;
                  let borderColor = colors.border;
                  let textColor = colors.text;

                  if (showResult) {
                    if (opt === mcQ.correctAnswer) {
                      bg = "#2ECC7122";
                      borderColor = "#2ECC71";
                      textColor = "#2ECC71";
                    } else if (opt === selectedOption && opt !== mcQ.correctAnswer) {
                      bg = "#E53E3E22";
                      borderColor = "#E53E3E";
                      textColor = "#E53E3E";
                    }
                  } else if (opt === selectedOption) {
                    bg = colors.primary + "22";
                    borderColor = colors.primary;
                  }

                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.optionBtn, { backgroundColor: bg, borderColor }]}
                      onPress={() => handleMCAnswer(opt)}
                      disabled={showResult || dailyLimitReached}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.optionText, { color: textColor }]}>{opt}</Text>
                      {showResult && opt === mcQ.correctAnswer && (
                        <Ionicons name="checkmark-circle" size={18} color="#2ECC71" />
                      )}
                      {showResult && opt === selectedOption && opt !== mcQ.correctAnswer && (
                        <Ionicons name="close-circle" size={18} color="#E53E3E" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── FB: result banner + hint + action buttons ─────── */}
            {fbQ && (
              <View style={styles.fbContainer}>
                {showResult && (
                  <View
                    style={[
                      styles.resultBanner,
                      { backgroundColor: isCorrect ? "#2ECC7118" : "#E53E3E18" },
                    ]}
                  >
                    <Text style={[styles.resultText, { color: isCorrect ? "#2ECC71" : "#E53E3E" }]}>
                      {isCorrect ? `🎉 ${t("quiz.correct")}` : `✗ ${t("quiz.incorrect")}`}
                    </Text>
                  </View>
                )}

                <View style={styles.fbButtonRow}>
                  {!showHint && !showResult && (
                    <TouchableOpacity
                      style={[styles.hintBtn, { borderColor: colors.border }]}
                      onPress={() => setShowHint(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.hintBtnText, { color: colors.textSecondary }]}>
                        💡 {t("quiz.hint")}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {!showResult ? (
                    <TouchableOpacity
                      style={[
                        styles.submitBtn,
                        {
                          backgroundColor: colors.primary,
                          opacity: fbQ.keywords.some((_, i) => (keywordInputs[i] ?? "").trim())
                            ? 1
                            : 0.45,
                        },
                      ]}
                      onPress={handleFBSubmit}
                      disabled={
                        !fbQ.keywords.some((_, i) => (keywordInputs[i] ?? "").trim()) ||
                        dailyLimitReached
                      }
                      activeOpacity={0.85}
                    >
                      <Text style={styles.submitBtnText}>{t("quiz.submit")}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                      onPress={goNext}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.submitBtnText}>{t("quiz.next_question")}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* ── Visual image ─────────────────────────────────── */}
            {currentQ.sentence.visual_image_url && (
              <View style={styles.visualImageWrapper}>
                <View style={[styles.visualImageClip, isSmallScreen && { width: 120, height: 120 }]}>
                  <Image
                    source={{ uri: currentQ.sentence.visual_image_url }}
                    style={styles.visualImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            )}

            {/* ── MC: result banner + Next button ──────────────── */}
            {mcQ && showResult && (
              <>
                <View
                  style={[
                    styles.resultBanner,
                    { backgroundColor: isCorrect ? "#2ECC7118" : "#E53E3E18" },
                  ]}
                >
                  <Text style={[styles.resultText, { color: isCorrect ? "#2ECC71" : "#E53E3E" }]}>
                    {isCorrect
                      ? `🎉 ${t("quiz.correct")}`
                      : `✗ ${t("quiz.incorrect")} ${t("quiz.correct_answer_is")} "${mcQ.correctAnswer}"`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: colors.primary, marginTop: 10 }]}
                  onPress={goNext}
                  activeOpacity={0.85}
                >
                  <Text style={styles.submitBtnText}>{t("quiz.next_question")}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
      <HintBottomSheet
        visible={hintQuizVisible}
        title={t("hints.quiz_done_title")}
        body={t("hints.quiz_done_body")}
        onClose={() => setHintQuizVisible(false)}
      />
      <ContentReportSheet
        visible={reportVisible}
        loading={reportSubmitting}
        contentType="preset_sentence"
        onClose={() => !reportSubmitting && setReportVisible(false)}
        onSubmit={handleSubmitReport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyIcon: { fontSize: 44 },
  emptyText: { fontSize: 15, textAlign: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
    position: "relative",
    minHeight: 44,
  },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerTitleCentered: {
    position: "absolute",
    left: 72,
    right: 72,
    textAlign: "center",
  },
  headerBackButton: {
    width: 36,
    height: 36,
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 2,
  },
  headerRightControls: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 2,
  },
  headerSideSpacer: {
    width: 36,
    height: 36,
  },
  scoreBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  scoreText: { fontSize: 13, fontWeight: "700" },
  segmentContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderRadius: 25,
    padding: 4,
    marginBottom: 10,
  },
  segmentTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 9,
  },
  segmentTabActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentLabel: { fontSize: 13, fontWeight: "500" },
  progressTrack: {
    height: 3,
    marginHorizontal: 20,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: { height: 3, borderRadius: 2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  limitBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  limitText: { fontSize: 13, lineHeight: 18, flex: 1 },
  upgradeBannerBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  upgradeBannerBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  questionCard: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  questionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  questionNum: { fontSize: 12 },
  questionPrompt: { marginBottom: 6 },
  directionBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 12,
  },
  directionLang: { fontSize: 12, fontWeight: "500" },
  directionLangTarget: { fontWeight: "700" },

  // ── Fill-blank styles ──────────────────────────────────────────────────
  fbContextWrapper: {
    marginBottom: 14,
  },
  fbDivider: {
    height: 1,
    marginBottom: 12,
  },
  fbInstruction: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  fbSentenceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 0,
  },
  fbWord: {
    fontSize: 17,
    lineHeight: 30,
    fontWeight: "500",
  },
  kwWrapper: {
    alignItems: "center",
    marginHorizontal: 2,
    marginBottom: 4,
  },
  kwHint: {
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  // Ghost text drives the container width; input fills it absolutely
  kwSizer: {
    position: "relative",
  },
  kwSizerText: {
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingBottom: 5,
    paddingTop: 2,
    lineHeight: 30,
    opacity: 0,
  },
  kwInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    fontSize: 17,
    fontWeight: "700",
    borderBottomWidth: 2.5,
    paddingHorizontal: 4,
    paddingBottom: 3,
    paddingTop: 2,
    textAlign: "center",
    backgroundColor: "transparent",
  },
  fbCorrectBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  fbCorrectLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Visual image ────────────────────────────────────────────────────────
  visualImageWrapper: {
    alignItems: "center",
    marginTop: -20,
    marginBottom: -25,
  },
  visualImageClip: {
    width: 170,
    height: 170,
    overflow: "hidden",
  },
  visualImage: {
    position: "absolute",
    top: -16,
    left: -16,
    right: -16,
    bottom: -16,
  },

  // ── MC options ──────────────────────────────────────────────────────────
  optionsContainer: { gap: 10, marginBottom: 4 },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 10,
  },
  optionText: { fontSize: 15, flex: 1 },

  // ── Shared result / action ──────────────────────────────────────────────
  resultBanner: { borderRadius: 10, padding: 12, marginTop: 4 },
  resultText: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  fbContainer: { gap: 10 },
  fbButtonRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  hintBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  hintBtnText: { fontSize: 13 },
  submitBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  doneCard: {
    borderRadius: 18,
    padding: 32,
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  doneIcon: { fontSize: 52 },
  doneTitle: { fontSize: 20, fontWeight: "700" },
  doneSubtitle: { fontSize: 14 },
  restartBtn: {
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  restartBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  retryBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  retryBannerText: { fontSize: 13, fontWeight: "600" },
  doneScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginVertical: 4,
  },
  doneScoreBlock: { alignItems: "center", gap: 4 },
  doneScoreLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  doneScoreNum: { fontSize: 22, fontWeight: "700" },
  doneScoreDivider: { width: 1, height: 40 },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyScroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  emptyCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  emptyHint: { fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  emptyActions: {
    width: "100%",
    gap: 10,
    marginTop: 8,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
  },
  emptyBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  emptySecondaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  emptySecondaryBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
