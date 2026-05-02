import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { ContentReportSheet } from "@/components/report/ContentReportSheet";
import { ReportIconButton } from "@/components/report/ReportIconButton";
import { useAuthStore } from "@/store/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useDialogStore } from "@/store/useDialogStore";
import { showContentReportAlert } from "@/lib/contentReportAlerts";
import { buildDialogTurnReportInput } from "@/lib/contentReportSnapshot";
import { submitContentReport } from "@/services/contentReports";
import { speak, stopSpeaking } from "@/services/tts";
import {
  HomeStackParamList,
  SupportedLanguage,
  DialogTurn,
  DialogTurnOption,
} from "@/types";
import type { ContentReportReason } from "@/types/contentReports";

type Nav = NativeStackNavigationProp<HomeStackParamList>;

const CORRECT_COLOR = "#22C55E";
const WRONG_COLOR   = "#EF4444";
const ACCENT        = "#06B6D4";

// How long to wait after a correct answer before showing the next character message
const AUTO_ADVANCE_DELAY_MS = 700;

// ─── helpers ────────────────────────────────────────────────────────────────

function getLangKey<T extends Record<string, any>>(
  obj: T,
  prefix: string,
  lang: SupportedLanguage,
  fallbackKey: string
): string {
  return (obj[`${prefix}_${lang}`] as string) || (obj[fallbackKey] as string) || "";
}

function getMessage(turn: DialogTurn, lang: SupportedLanguage): string {
  return getLangKey(turn, "message", lang, "message_en");
}

function getOptionText(option: DialogTurnOption, lang: SupportedLanguage): string {
  return getLangKey(option, "text", lang, "text_en");
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

// ─── local types ─────────────────────────────────────────────────────────────

interface CompletedTurnEntry {
  turn: DialogTurn;
  chosenOption: DialogTurnOption;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DialogPlayScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const scrollRef = useRef<ScrollView>(null);

  const { user } = useAuthStore();
  const { uiLanguage, targetLanguage } = useSettingsStore();
  const lang = (targetLanguage as SupportedLanguage) ?? "en";

  const {
    activeScenario,
    turns,
    currentTurnIndex,
    selectOption,
    advanceToNextTurn,
    completeSession,
    abandonSession,
    error,
  } = useDialogStore();

  // Local state: accumulating chat history
  const [history, setHistory] = useState<CompletedTurnEntry[]>([]);
  // Which option the user has tapped in the current turn (for red feedback)
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  // Prevent double-taps during the auto-advance delay
  const [isProcessing, setIsProcessing] = useState(false);
  // True when the last turn is answered correctly
  const [sessionDone, setSessionDone] = useState(false);
  // Finishing (calling completeSession) in progress
  const [finishing, setFinishing] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [dialogAudioEnabled, setDialogAudioEnabled] = useState(true);
  const [translatedMessageIds, setTranslatedMessageIds] = useState<string[]>([]);
  const [translatedOptionIds, setTranslatedOptionIds] = useState<string[]>([]);

  const currentTurn = turns[currentTurnIndex] ?? null;
  const isLastTurn  = currentTurnIndex === turns.length - 1;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  // Scroll whenever history grows or current turn changes
  useEffect(() => {
    scrollToBottom();
  }, [history.length, currentTurnIndex, sessionDone]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const speakDialogText = useCallback(
    (text: string) => {
      if (!dialogAudioEnabled || !text.trim()) return;
      stopSpeaking();
      speak(text, lang);
    },
    [dialogAudioEnabled, lang]
  );

  const handleToggleDialogAudio = () => {
    setDialogAudioEnabled((enabled) => {
      if (enabled) stopSpeaking();
      return !enabled;
    });
  };

  const handleOptionPress = async (option: DialogTurnOption) => {
    if (!user || isProcessing || sessionDone) return;

    setPendingOptionId(option.id);

    if (!option.is_correct) {
      // Wrong → red flash, stay on same turn
      const saved = await selectOption(user.id, option.id, option);
      if (!saved) {
        setPendingOptionId(null);
        Alert.alert(t("common.error"), t("common.save_failed"));
      }
      return;
    }

    // Correct ─ lock interactions
    setIsProcessing(true);
    const saved = await selectOption(user.id, option.id, option);
    if (!saved) {
      setPendingOptionId(null);
      setIsProcessing(false);
      Alert.alert(t("common.error"), t("common.save_failed"));
      return;
    }

    // Freeze a small moment so the green highlight is visible
    await new Promise((r) => setTimeout(r, AUTO_ADVANCE_DELAY_MS));

    // Commit this turn into history
    setHistory((prev) => [...prev, { turn: currentTurn!, chosenOption: option }]);
    setPendingOptionId(null);

    if (isLastTurn) {
      setSessionDone(true);
      setIsProcessing(false);
    } else {
      advanceToNextTurn();
      setIsProcessing(false);
    }
  };

  const handleFinish = async () => {
    if (!user || finishing) return;
    setFinishing(true);
    await completeSession(user.id);
    navigation.replace("DialogComplete");
  };

  const handleBack = async () => {
    if (user) await abandonSession(user.id);
    navigation.goBack();
  };

  if (!activeScenario || !currentTurn) {
    if (error || turns.length === 0) {
      return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
          <View style={styles.errorState}>
            <Text style={[styles.errorTitle, { color: colors.text }]}>{t("common.error")}</Text>
            <Text style={[styles.errorBody, { color: colors.textSecondary }]}>
              {t("dialog.setup.start_failed")}
            </Text>
            <TouchableOpacity
              style={[styles.errorButton, { backgroundColor: ACCENT }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Text style={styles.errorButtonText}>{t("common.back")}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <ActivityIndicator color={ACCENT} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const scenarioTitle = getLangKey(activeScenario as any, "title", lang, "title_en");
  const totalTurns    = turns.length;

  const handleSubmitReport = async (reason: ContentReportReason, note: string) => {
    if (!activeScenario || !currentTurn) return;

    setReportSubmitting(true);
    try {
      const lastHistoryEntry = history[history.length - 1] ?? null;
      const baseInput = buildDialogTurnReportInput({
        scenario: activeScenario,
        turn: currentTurn,
        sourceLang: uiLanguage,
        targetLang: targetLanguage,
        visibleScenarioTitle: scenarioTitle,
        visibleMessage: getMessage(currentTurn, lang),
        visibleOptions: (currentTurn.options ?? []).map((option) => ({
          id: option.id,
          optionIndex: option.option_index,
          isCorrect: option.is_correct,
          visibleText: getOptionText(option, lang),
        })),
        screenContext: "dialog_play",
        previousContext: lastHistoryEntry
          ? {
              turnId: lastHistoryEntry.turn.id,
              turnIndex: lastHistoryEntry.turn.turn_index,
              message: getMessage(lastHistoryEntry.turn, lang),
              chosenOption: getOptionText(lastHistoryEntry.chosenOption, lang),
            }
          : null,
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {scenarioTitle}
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {activeScenario.character_name} · {activeScenario.character_role}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[
              styles.headerIconBtn,
              {
                backgroundColor: dialogAudioEnabled ? ACCENT + "18" : colors.cardBackground,
                borderColor: dialogAudioEnabled ? ACCENT + "35" : colors.border,
              },
            ]}
            onPress={handleToggleDialogAudio}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={dialogAudioEnabled ? "volume-high-outline" : "volume-mute-outline"}
              size={17}
              color={dialogAudioEnabled ? ACCENT : colors.textTertiary}
            />
          </TouchableOpacity>
          <ReportIconButton onPress={() => setReportVisible(true)} size={32} iconSize={17} />
          <View style={[styles.turnPill, { backgroundColor: ACCENT + "22" }]}>
            <Text style={[styles.turnPillText, { color: ACCENT }]}>
              {Math.min(history.length + (sessionDone ? 0 : 1), totalTurns)}/{totalTurns}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Progress bar ── */}
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: ACCENT,
              width: `${((history.length + (sessionDone ? 1 : 0)) / totalTurns) * 100}%` as any,
            },
          ]}
        />
      </View>

      {/* ── Chat scroll ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Completed turns (history) ── */}
        {history.map((entry, idx) => (
          <React.Fragment key={idx}>
            {/* Character message — LEFT */}
            <CharacterBubble
              text={
                translatedMessageIds.includes(entry.turn.id)
                  ? getMessage(entry.turn, uiLanguage)
                  : getMessage(entry.turn, lang)
              }
              name={activeScenario.character_name}
              colors={colors}
              audioEnabled={dialogAudioEnabled}
              translated={translatedMessageIds.includes(entry.turn.id)}
              onSpeak={() => speakDialogText(getMessage(entry.turn, lang))}
              onToggleTranslate={() =>
                setTranslatedMessageIds((prev) => toggleId(prev, entry.turn.id))
              }
            />
            {/* User's correct answer — RIGHT (sent bubble) */}
            <UserSentBubble
              text={
                translatedOptionIds.includes(entry.chosenOption.id)
                  ? getOptionText(entry.chosenOption, uiLanguage)
                  : getOptionText(entry.chosenOption, lang)
              }
              colors={colors}
              audioEnabled={dialogAudioEnabled}
              translated={translatedOptionIds.includes(entry.chosenOption.id)}
              onSpeak={() => speakDialogText(getOptionText(entry.chosenOption, lang))}
              onToggleTranslate={() =>
                setTranslatedOptionIds((prev) => toggleId(prev, entry.chosenOption.id))
              }
            />
          </React.Fragment>
        ))}

        {/* ── Current turn (if not done) ── */}
        {!sessionDone && currentTurn && (
          <>
            <CharacterBubble
              text={
                translatedMessageIds.includes(currentTurn.id)
                  ? getMessage(currentTurn, uiLanguage)
                  : getMessage(currentTurn, lang)
              }
              name={activeScenario.character_name}
              colors={colors}
              audioEnabled={dialogAudioEnabled}
              translated={translatedMessageIds.includes(currentTurn.id)}
              onSpeak={() => speakDialogText(getMessage(currentTurn, lang))}
              onToggleTranslate={() =>
                setTranslatedMessageIds((prev) => toggleId(prev, currentTurn.id))
              }
            />

            {/* Options */}
            <View style={styles.optionsWrap}>
              <Text style={[styles.chooseLabel, { color: colors.textTertiary }]}>
                {t("dialog.play.choose_reply")}
              </Text>

              {(currentTurn.options ?? []).map((option) => {
                const isSelected  = pendingOptionId === option.id;
                const isWrong     = isSelected && !option.is_correct;
                const isCorrectSel = isSelected && option.is_correct;
                const isTranslated = translatedOptionIds.includes(option.id);
                const optionText = isTranslated
                  ? getOptionText(option, uiLanguage)
                  : getOptionText(option, lang);

                return (
                  <View key={option.id} style={styles.optionRow}>
                    <BubbleActions
                      colors={colors}
                      audioEnabled={dialogAudioEnabled}
                      translated={isTranslated}
                      onSpeak={() => speakDialogText(getOptionText(option, lang))}
                      onToggleTranslate={() =>
                        setTranslatedOptionIds((prev) => toggleId(prev, option.id))
                      }
                    />
                    <TouchableOpacity
                      style={[
                        styles.optionBubble,
                        {
                          backgroundColor: isCorrectSel
                            ? CORRECT_COLOR + "22"
                            : isWrong
                            ? WRONG_COLOR + "22"
                            : colors.cardBackground,
                          borderColor: isCorrectSel
                            ? CORRECT_COLOR
                            : isWrong
                            ? WRONG_COLOR
                            : colors.border,
                        },
                      ]}
                      onPress={() => handleOptionPress(option)}
                      activeOpacity={0.75}
                      disabled={isProcessing}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          {
                            color: isCorrectSel
                              ? CORRECT_COLOR
                              : isWrong
                              ? WRONG_COLOR
                              : colors.text,
                          },
                        ]}
                      >
                        {optionText}
                      </Text>

                      {isCorrectSel && (
                        <Ionicons name="checkmark-circle" size={18} color={CORRECT_COLOR} />
                      )}
                      {isWrong && (
                        <Ionicons name="close-circle" size={18} color={WRONG_COLOR} />
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Spacer so content isn't hidden behind the finish button */}
        <View style={{ height: sessionDone ? 100 : 32 }} />
      </ScrollView>

      <ContentReportSheet
        visible={reportVisible}
        loading={reportSubmitting}
        contentType="dialog_turn"
        onClose={() => !reportSubmitting && setReportVisible(false)}
        onSubmit={handleSubmitReport}
      />

      {/* ── Finish button (only after last correct answer) ── */}
      {sessionDone && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.finishBtn, { backgroundColor: "#8B5CF6" }]}
            onPress={handleFinish}
            activeOpacity={0.85}
          >
            {finishing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.finishBtnText}>{t("dialog.play.finish")}</Text>
                <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function BubbleActions({
  colors,
  audioEnabled,
  translated,
  onSpeak,
  onToggleTranslate,
}: {
  colors: any;
  audioEnabled: boolean;
  translated: boolean;
  onSpeak: () => void;
  onToggleTranslate: () => void;
}) {
  return (
    <View style={styles.bubbleActions}>
      <TouchableOpacity
        style={styles.bubbleActionBtn}
        onPress={onSpeak}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
      >
        <Ionicons
          name={audioEnabled ? "volume-high-outline" : "volume-mute-outline"}
          size={16}
          color={audioEnabled ? colors.textTertiary : colors.border}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.bubbleActionBtn}
        onPress={onToggleTranslate}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
      >
        <Ionicons
          name="language-outline"
          size={16}
          color={translated ? ACCENT : colors.textTertiary}
        />
      </TouchableOpacity>
    </View>
  );
}

function CharacterBubble({
  text,
  name,
  colors,
  audioEnabled,
  translated,
  onSpeak,
  onToggleTranslate,
}: {
  text: string;
  name: string;
  colors: any;
  audioEnabled: boolean;
  translated: boolean;
  onSpeak: () => void;
  onToggleTranslate: () => void;
}) {
  return (
    <View style={styles.characterRow}>
      <View style={[styles.avatarCircle, { backgroundColor: ACCENT + "33" }]}>
        <Ionicons name="person" size={16} color={ACCENT} />
      </View>
      <View style={styles.characterBubbleWrap}>
        <Text style={[styles.speakerName, { color: colors.textSecondary }]}>{name}</Text>
        <View style={styles.characterBubbleLine}>
          <View
            style={[
              styles.characterBubble,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.characterText, { color: colors.text }]}>{text}</Text>
          </View>
          <BubbleActions
            colors={colors}
            audioEnabled={audioEnabled}
            translated={translated}
            onSpeak={onSpeak}
            onToggleTranslate={onToggleTranslate}
          />
        </View>
      </View>
    </View>
  );
}

function UserSentBubble({
  text,
  colors,
  audioEnabled,
  translated,
  onSpeak,
  onToggleTranslate,
}: {
  text: string;
  colors: any;
  audioEnabled: boolean;
  translated: boolean;
  onSpeak: () => void;
  onToggleTranslate: () => void;
}) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubbleLine}>
        <BubbleActions
          colors={colors}
          audioEnabled={audioEnabled}
          translated={translated}
          onSpeak={onSpeak}
          onToggleTranslate={onToggleTranslate}
        />
        <View style={[styles.userBubble, { backgroundColor: ACCENT }]}>
          <Text style={styles.userBubbleText}>{text}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:           { flex: 1 },
  errorState:          { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  errorTitle:          { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  errorBody:           { fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 20 },
  errorButton:         { minWidth: 140, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  errorButtonText:     { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Header
  header:              { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  backBtn:             { width: 36, alignItems: "flex-start" },
  headerCenter:        { flex: 1 },
  headerTitle:         { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  headerSub:           { fontSize: 12, lineHeight: 16 },
  headerRight:         { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconBtn:       { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  turnPill:            { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  turnPillText:        { fontSize: 13, fontWeight: "700" },

  // Progress
  progressTrack:       { height: 3 },
  progressFill:        { height: 3 },

  // Chat
  chatScroll:          { flex: 1 },
  chatContent:         { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 12 },

  // Character bubble (left)
  characterRow:        { flexDirection: "row", alignItems: "flex-start", marginBottom: 10, gap: 8 },
  avatarCircle:        { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 16 },
  characterBubbleWrap: { flex: 1 },
  speakerName:         { fontSize: 11, fontWeight: "600", marginBottom: 3, marginLeft: 2 },
  characterBubbleLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  characterBubble:     { borderRadius: 18, borderTopLeftRadius: 4, borderWidth: 1, padding: 13, alignSelf: "flex-start", maxWidth: "80%" },
  characterText:       { fontSize: 15, lineHeight: 22 },
  bubbleActions:       { flexDirection: "row", alignItems: "center", gap: 1, paddingTop: 2 },
  bubbleActionBtn:     { width: 24, height: 24, alignItems: "center", justifyContent: "center" },

  // User bubble (right — sent)
  userRow:             { alignItems: "flex-end", marginBottom: 16 },
  userBubbleLine:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end", gap: 6, maxWidth: "96%" },
  userBubble:          { borderRadius: 18, borderTopRightRadius: 4, paddingVertical: 11, paddingHorizontal: 16, maxWidth: "80%" },
  userBubbleText:      { color: "#fff", fontSize: 14, lineHeight: 20 },

  // Options
  optionsWrap:         { alignItems: "flex-end", gap: 8, marginBottom: 8 },
  chooseLabel:         { fontSize: 10, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 },
  optionRow:           { flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end", gap: 6, width: "100%" },
  optionBubble:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 18, borderTopRightRadius: 4, borderWidth: 1.5, paddingVertical: 11, paddingHorizontal: 15, width: "78%" },
  optionText:          { fontSize: 14, lineHeight: 20, flex: 1 },

  // Bottom
  bottomBar:           { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  finishBtn:           { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 16 },
  finishBtnText:       { color: "#fff", fontSize: 16, fontWeight: "700" },
});
