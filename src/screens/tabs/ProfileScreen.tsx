import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/useAuthStore";
import { isNetworkError, useNetworkStore } from "@/store/useNetworkStore";
import { useSentenceStore } from "@/store/useSentenceStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import ActivityChart from "@/components/ActivityChart";
import LeaderboardModal from "@/components/LeaderboardModal";
import { countTodayLearned } from "@/utils/progressHelpers";
import { useLeaderboardStore } from "@/store/useLeaderboardStore";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, uploadAvatar, removeAvatar, updateProfile } = useAuthStore();
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(user?.display_name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const nameInputRef = useRef<TextInput>(null);
  const { sentences, loadSentences } = useSentenceStore();
  const { stats, progressMap, progress, loadProgress } = useProgressStore();
  const { dailyGoal } = useSettingsStore();
  const isPremium = useAuthStore((s) => s.user?.is_premium ?? false);
  const navigation = useNavigation();
  const [avatarKey, setAvatarKey] = useState(0);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const { myEntry, loadLeaderboard } = useLeaderboardStore();

  useEffect(() => {
    loadSentences();
    loadProgress();
    loadLeaderboard();
  }, [loadSentences, loadProgress, loadLeaderboard]);

  const presetLearnedCount = Object.values(progressMap).filter((s) => s === "learned").length;
  const presetLearningCount = Object.values(progressMap).filter((s) => s === "learning").length;
  const userLearnedCount = sentences.filter((s) => s.status === "learned").length;
  const userLearningCount = sentences.filter((s) => s.status === "learning").length;
  const totalStudied =
    Object.keys(progressMap).length +
    sentences.filter((s) => s.status !== "new").length;
  const learnedCount = presetLearnedCount + userLearnedCount;
  const learningCount = presetLearningCount + userLearningCount;
  const todayLearned = countTodayLearned(progress) + stats.todayLearnedUserSentences;
  const dailyGoalProgress = Math.min(todayLearned / dailyGoal, 1);

  const initials = (user?.display_name || user?.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const startEditName = () => {
    setNameValue(user?.display_name || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const saveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === user?.display_name) {
      setEditingName(false);
      return;
    }
    if (useNetworkStore.getState().isOnline === false) {
      Alert.alert(t("common.offline_title"), t("common.offline_body"));
      return;
    }
    setNameSaving(true);
    const res = await updateProfile({ display_name: trimmed });
    setNameSaving(false);
    setEditingName(false);
    if (!res.success) {
      if (
        useNetworkStore.getState().isOnline === false ||
        (res.error && isNetworkError({ message: res.error }))
      ) {
        Alert.alert(t("common.offline_title"), t("common.offline_body"));
        return;
      }
      Alert.alert(t("common.error"), res.error ?? t("profile.name_update_error"));
    }
  };

  const handleAvatarPress = () => setPhotoSheetVisible(true);

  const pickFromCamera = async () => {
    setPhotoSheetVisible(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled)
      await doUpload(result.assets[0].uri, result.assets[0].base64 ?? undefined);
  };

  const pickFromGallery = async () => {
    setPhotoSheetVisible(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled)
      await doUpload(result.assets[0].uri, result.assets[0].base64 ?? undefined);
  };

  const handleRemovePhoto = () => {
    setPhotoSheetVisible(false);
    Alert.alert(t("profile.photo_remove"), t("profile.photo_remove_confirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.yes"),
        style: "destructive",
        onPress: async () => {
          setAvatarUploading(true);
          const res = await removeAvatar();
          setAvatarUploading(false);
          if (res.success) {
            setAvatarLoadError(false);
            setAvatarKey(0);
          } else {
            Alert.alert(t("common.error"), res.error ?? t("profile.photo_upload_error"));
          }
        },
      },
    ]);
  };

  const doUpload = async (uri: string, base64?: string) => {
    setAvatarUploading(true);
    setAvatarLoadError(false);
    try {
      const res = await uploadAvatar(uri, base64);
      if (res.success) {
        setAvatarKey((k) => k + 1);
      } else {
        Alert.alert(t("common.error"), res.error ?? t("profile.photo_upload_error"));
      }
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={[styles.screenTitle, { color: colors.text }]}>{t("profile.title")}</Text>

        {/* Avatar + user info */}
        <View style={[styles.userCard, { backgroundColor: colors.cardBackground }]}>
          <TouchableOpacity
            style={[styles.avatar, { backgroundColor: colors.primary }]}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
          >
            {user?.avatar_url && !avatarLoadError ? (
              <Image
                source={{
                  uri: avatarKey > 0 ? `${user.avatar_url}?v=${avatarKey}` : user.avatar_url,
                }}
                style={styles.avatarImage}
                onError={() => setAvatarLoadError(true)}
              />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
            {avatarUploading ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            ) : (
              <View style={styles.avatarCameraIcon}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.userInfo}>
            <View style={styles.nameRow}>
              {editingName ? (
                <TextInput
                  ref={nameInputRef}
                  style={[
                    styles.nameInput,
                    { color: colors.text, borderBottomColor: colors.primary },
                  ]}
                  value={nameValue}
                  onChangeText={setNameValue}
                  onSubmitEditing={saveName}
                  returnKeyType="done"
                  autoCapitalize="words"
                  maxLength={40}
                />
              ) : (
                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                  {user?.display_name || user?.email?.split("@")[0] || "—"}
                </Text>
              )}
              <TouchableOpacity
                onPress={editingName ? saveName : startEditName}
                hitSlop={10}
                disabled={nameSaving}
                style={styles.nameEditBtn}
              >
                {nameSaving ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name={editingName ? "checkmark-circle" : "pencil-outline"}
                    size={18}
                    color={editingName ? colors.primary : colors.textSecondary}
                  />
                )}
              </TouchableOpacity>
            </View>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]} numberOfLines={1}>
              {user?.email}
            </Text>
            {isPremium && !editingName && (
              <View style={[styles.premiumBadge, { backgroundColor: colors.premiumAccent + "18" }]}>
                <Ionicons name="star" size={11} color={colors.premiumAccent} />
                <Text style={[styles.premiumBadgeText, { color: colors.premiumAccent }]}>
                  {t("common.premium_badge")}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Streak + Daily Goal */}
        <View style={styles.streakRow}>
          <View style={[styles.streakCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={styles.streakIcon}>🔥</Text>
            <Text style={[styles.streakNumber, { color: colors.text }]}>{stats.currentStreak}</Text>
            <Text style={[styles.streakLabel, { color: colors.textSecondary }]}>
              {t("profile.streak")}
            </Text>
            {stats.longestStreak > 0 && (
              <View style={styles.streakBestRow}>
                <Text style={styles.streakBestIcon}>🏆</Text>
                <Text style={[styles.streakBestText, { color: colors.textTertiary }]}>
                  {stats.longestStreak} {t("profile.days")}
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.goalCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.goalTitle, { color: colors.text }]}>
              {t("profile.today_goal")}
            </Text>
            <Text style={[styles.goalProgress, { color: colors.textSecondary }]}>
              {todayLearned}/{dailyGoal}
            </Text>
            <View style={[styles.goalTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.goalFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${dailyGoalProgress * 100}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Leaderboard badge card */}
        <TouchableOpacity
          style={[styles.leaderboardCard, { backgroundColor: colors.cardBackground }]}
          onPress={() => setLeaderboardVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.leaderboardIcon}>🏆</Text>
          <View style={styles.leaderboardInfo}>
            <Text style={[styles.leaderboardLabel, { color: colors.text }]}>
              {t("leaderboard.badge_label")}
            </Text>
            <Text style={[styles.leaderboardSub, { color: colors.textSecondary }]}>
              {myEntry
                ? t("leaderboard.your_rank", { rank: myEntry.learned_rank })
                : t("leaderboard.not_ranked")}
            </Text>
          </View>
          <Text style={[styles.leaderboardDetail, { color: colors.primary }]}>
            {t("leaderboard.badge_detail")}
          </Text>
        </TouchableOpacity>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          {[
            { label: t("profile.sentences_studied"), value: totalStudied, icon: "📖" },
            { label: t("profile.sentences_learned"), value: learnedCount, icon: "✅" },
            {
              label: t("profile.quiz_accuracy"),
              value: stats.totalQuizQuestions > 0 ? `${Math.round(stats.quizAccuracy)}%` : "—",
              icon: "🎯",
            },
            { label: t("profile.learning"), value: learningCount, icon: "📝" },
            {
              label: t("profile.build_sentence_total"),
              value: stats.quizByMode.build_sentence.total,
              icon: "🧩",
            },
          ].map((stat, i) => (
            <View key={i} style={[styles.statCard, { backgroundColor: colors.cardBackground }]}>
              <Text style={styles.statIcon}>{stat.icon}</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Quiz breakdown */}
        {stats.totalQuizQuestions > 0 && (
          <View style={[styles.quizCard, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.quizCardTitle, { color: colors.text }]}>
              {t("profile.quiz_breakdown")}
            </Text>
            <Text style={[styles.quizAccuracySummary, { color: colors.textSecondary }]}>
              {t("profile.quiz_correct_summary", {
                correct: stats.correctQuizAnswers,
                total: stats.totalQuizQuestions,
              })}
            </Text>

            {/* Mode rows */}
            {(["multiple_choice", "fill_blank", "build_sentence"] as const).map((mode) => {
              const s = stats.quizByMode[mode];
              if (s.total === 0) return null;
              const pct = Math.round((s.correct / s.total) * 100);
              return (
                <View key={mode} style={styles.quizRow}>
                  <Text
                    style={[styles.quizRowLabel, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {t(`quiz.${mode}`)}
                  </Text>
                  <View style={[styles.quizBar, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.quizBarFill,
                        { backgroundColor: colors.primary, width: `${pct}%` },
                      ]}
                    />
                  </View>
                  <Text style={[styles.quizRowPct, { color: colors.text }]}>{pct}%</Text>
                </View>
              );
            })}

            {/* Divider */}
            {Object.keys(stats.quizByCategory).length > 0 && (
              <View style={[styles.quizDivider, { backgroundColor: colors.divider }]} />
            )}

            {/* Category rows — sorted by total desc, top 5 */}
            {Object.entries(stats.quizByCategory)
              .sort((a, b) => b[1].total - a[1].total)
              .slice(0, 5)
              .map(([cat, s]) => {
                const pct = Math.round((s.correct / s.total) * 100);
                const label = t(`categories.${cat}`, { defaultValue: cat });
                return (
                  <View key={cat} style={styles.quizRow}>
                    <Text
                      style={[styles.quizRowLabel, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    <View style={[styles.quizBar, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          styles.quizBarFill,
                          { backgroundColor: colors.success, width: `${pct}%` },
                        ]}
                      />
                    </View>
                    <Text style={[styles.quizRowPct, { color: colors.text }]}>{pct}%</Text>
                  </View>
                );
              })}
          </View>
        )}

        {/* Activity chart */}
        <ActivityChart progress={progress} userLearnedDates={stats.userLearnedDates} />

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Leaderboard modal */}
      <LeaderboardModal
        visible={leaderboardVisible}
        onClose={() => setLeaderboardVisible(false)}
        onUpgrade={() => navigation.navigate("Paywall" as never)}
      />

      {/* Photo action sheet */}
      <Modal
        visible={photoSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPhotoSheetVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setPhotoSheetVisible(false)}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: colors.cardBackground,
                paddingBottom: Math.max(insets.bottom, 12) + 12,
              },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>
              {t("profile.change_photo")}
            </Text>
            <TouchableOpacity style={styles.sheetItem} onPress={pickFromCamera}>
              <Ionicons name="camera-outline" size={22} color={colors.text} />
              <Text style={[styles.sheetItemText, { color: colors.text }]}>
                {t("profile.photo_camera")}
              </Text>
            </TouchableOpacity>
            <View style={[styles.sheetDivider, { backgroundColor: colors.divider }]} />
            <TouchableOpacity style={styles.sheetItem} onPress={pickFromGallery}>
              <Ionicons name="image-outline" size={22} color={colors.text} />
              <Text style={[styles.sheetItemText, { color: colors.text }]}>
                {t("profile.photo_gallery")}
              </Text>
            </TouchableOpacity>
            {!!user?.avatar_url && (
              <>
                <View style={[styles.sheetDivider, { backgroundColor: colors.divider }]} />
                <TouchableOpacity style={styles.sheetItem} onPress={handleRemovePhoto}>
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                  <Text style={[styles.sheetItemText, { color: colors.error }]}>
                    {t("profile.photo_remove")}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            <View style={[styles.sheetDivider, { backgroundColor: colors.divider }]} />
            <TouchableOpacity style={styles.sheetItem} onPress={() => setPhotoSheetVisible(false)}>
              <Text style={[styles.sheetItemText, { color: colors.textSecondary }]}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, gap: 0 },
  screenTitle: { fontSize: 22, fontWeight: "700", marginBottom: 16 },
  nameInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    borderBottomWidth: 1.5,
    paddingBottom: 2,
  },
  nameEditBtn: { marginLeft: 6 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  avatarImage: { width: 54, height: 54, borderRadius: 27 },
  avatarOverlay: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCameraIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#555",
    alignItems: "center",
    justifyContent: "center",
  },
  userInfo: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
  userName: { fontSize: 17, fontWeight: "600", flex: 1 },
  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  premiumBadgeText: { fontSize: 11, fontWeight: "700" },
  userEmail: { fontSize: 13 },
  streakRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  streakCard: {
    width: 110,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  streakIcon: { fontSize: 28 },
  streakNumber: { fontSize: 28, fontWeight: "800" },
  streakLabel: { fontSize: 12 },
  streakBestRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  streakBestIcon: { fontSize: 10 },
  streakBestText: { fontSize: 11, fontWeight: "600" },
  goalCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  goalTitle: { fontSize: 13, fontWeight: "600" },
  goalProgress: { fontSize: 22, fontWeight: "700" },
  goalTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  goalFill: { height: 6, borderRadius: 3 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    width: "47%",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statIcon: { fontSize: 22 },
  statValue: { fontSize: 22, fontWeight: "700" },
  statLabel: { fontSize: 11, textAlign: "center" },
  quizCard: {
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  quizCardTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  quizAccuracySummary: { fontSize: 12, marginBottom: 4 },
  quizRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  quizRowLabel: { fontSize: 12, width: 110 },
  quizBar: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  quizBarFill: { height: 5, borderRadius: 3 },
  quizRowPct: { fontSize: 12, fontWeight: "600", width: 34, textAlign: "right" },
  quizDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  sheetTitle: {
    textAlign: "center",
    fontSize: 13,
    paddingVertical: 12,
  },
  sheetDivider: { height: StyleSheet.hairlineWidth },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sheetItemText: { fontSize: 16 },
  leaderboardCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  leaderboardIcon: { fontSize: 26 },
  leaderboardInfo: { flex: 1 },
  leaderboardLabel: { fontSize: 14, fontWeight: "700" },
  leaderboardSub: { fontSize: 12, marginTop: 2 },
  leaderboardDetail: { fontSize: 13, fontWeight: "700" },
});
