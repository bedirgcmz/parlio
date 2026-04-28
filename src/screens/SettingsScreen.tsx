import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  Linking,
  Platform,
  Modal,
  ActivityIndicator,
} from "react-native";

const PRIVACY_POLICY_URL = "https://parlio-privacy-terms-page.vercel.app/privacy";
const TERMS_URL = "https://parlio-privacy-terms-page.vercel.app/terms";
const FEEDBACK_EMAIL = "bgswedenappdev@gmail.com";
const IOS_APP_STORE_ID = "6761177577";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/providers/ThemeProvider";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useNetworkStore } from "@/store/useNetworkStore";
import { useI18n } from "@/providers/I18nProvider";
import { MainStackParamList, SupportedLanguage } from "@/types";
import { TimePicker, LangPicker } from "@/components/SettingsPicker";
import {
  syncDailyReminderSchedule,
} from "@/services/notifications";

const DAILY_GOAL_OPTIONS = [5, 10, 20, 30];

function SectionTitle({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <Text style={[sStyles.sectionTitle, { color: colors.textSecondary }]}>{label}</Text>
  );
}

function SettingRow({
  icon,
  label,
  children,
  colors,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return (
    <View style={[sStyles.row, { borderBottomColor: colors.divider }]}>
      <View style={sStyles.rowLeft}>
        <Text style={sStyles.rowIcon}>{icon}</Text>
        <Text style={[sStyles.rowLabel, { color: colors.text }]}>{label}</Text>
      </View>
      <View style={sStyles.rowRight}>{children}</View>
    </View>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors, isDark, toggleTheme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { changeLanguage } = useI18n();
  const {
    uiLanguage,
    targetLanguage,
    dailyGoal,
    notifications,
    reminderTime,
    setUILanguage,
    setTargetLanguage,
    setTheme,
    setDailyGoal,
    setNotifications,
    setReminderTime,
  } = useSettingsStore();
  const { user, signOut, deleteAccount, updateProfile } = useAuthStore();
  const [deletingAccount, setDeletingAccount] = React.useState(false);
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleClose = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate("Tabs");
  };

  const handleLeaderboardVisibleToggle = async (value: boolean) => {
    await updateProfile({ leaderboard_visible: value } as never);
  };

  const handleUILanguageChange = async (lang: SupportedLanguage) => {
    await changeLanguage(lang);
  };

  const handleTargetLanguageChange = async (lang: SupportedLanguage) => {
    await setTargetLanguage(lang);
  };

  const handleThemeToggle = () => {
    const newTheme = isDark ? "light" : "dark";
    setTheme(newTheme);
    toggleTheme();
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    if (enabled) {
      const scheduled = await syncDailyReminderSchedule({
        enabled: true,
        reminderTime,
        title: t("settings.notif_title"),
        body: t("settings.notif_body"),
        requestPermissions: true,
      });
      if (!scheduled) {
        Alert.alert(t("settings.notifications"), t("settings.notif_permission_denied"));
        return;
      }
      setNotifications(true);
    } else {
      await syncDailyReminderSchedule({ enabled: false, reminderTime });
      setNotifications(false);
    }
  };

  const handleReminderTimeChange = async (time: string) => {
    await setReminderTime(time);
    if (notifications) {
      await syncDailyReminderSchedule({
        enabled: true,
        reminderTime: time,
        title: t("settings.notif_title"),
        body: t("settings.notif_body"),
      });
    }
  };

  const handleFeedback = () => {
    const subject = encodeURIComponent("Parlio – Geri Bildirim");
    const body = encodeURIComponent(
      "Merhaba Parlio ekibi,\n\nUygulama hakkında bir önerim / şikayetim var:\n\n[Mesajınızı buraya yazın]\n\n---\nParlio uygulamasından gönderildi.",
    );
    Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`);
  };

  const handleRateApp = () => {
    if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/store/apps/details?id=com.parlio.app").catch(() =>
        Linking.openURL("market://details?id=com.parlio.app"),
      );
    } else {
      const url = IOS_APP_STORE_ID
        ? `https://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`
        : "https://apps.apple.com/developer/id000000000";
      Linking.openURL(url);
    }
  };

  const handleDeleteAccount = () => {
    if (useNetworkStore.getState().isOnline === false) {
      Alert.alert(t("common.offline_title"), t("common.offline_body"));
      return;
    }

    Alert.alert(
      t("settings.delete_account"),
      t("settings.delete_account_warning"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setDeletingAccount(true);
            const result = await deleteAccount();
            if (isMountedRef.current) {
              setDeletingAccount(false);
            }
            if (!result.success) {
              Alert.alert(t("common.error"), result.error ?? t("settings.delete_account_error"));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t("settings.title")}</Text>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Dil Ayarları ─────────────────────────────── */}
        <SectionTitle label={t("settings.ui_language").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: colors.divider }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>🌐</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.ui_language")}
              </Text>
            </View>
            <LangPicker
              value={uiLanguage}
              onChange={handleUILanguageChange}
              colors={colors}
            />
          </View>
          <View style={[sStyles.row, { borderBottomColor: "transparent" }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>🎯</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.target_language")}
              </Text>
            </View>
            <LangPicker
              value={targetLanguage}
              onChange={handleTargetLanguageChange}
              colors={colors}
            />
          </View>
        </View>

        {/* ── Görünüm ───────────────────────────────────── */}
        <SectionTitle label={t("settings.theme").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <SettingRow icon="🌙" label={t("settings.dark")} colors={colors}>
            <Switch
              value={isDark}
              onValueChange={handleThemeToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </SettingRow>
        </View>

        {/* ── Hedef ─────────────────────────────────────── */}
        <SectionTitle label={t("settings.daily_goal").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: "transparent" }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>📅</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.daily_goal")}
              </Text>
            </View>
            <View style={sStyles.goalChips}>
              {DAILY_GOAL_OPTIONS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[
                    sStyles.goalChip,
                    {
                      backgroundColor: dailyGoal === g ? colors.primary : colors.backgroundSecondary,
                      borderColor: dailyGoal === g ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setDailyGoal(g)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      sStyles.goalChipText,
                      { color: dailyGoal === g ? "#fff" : colors.textSecondary },
                    ]}
                  >
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── Bildirimler ───────────────────────────────── */}
        <SectionTitle label={t("settings.notifications").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: notifications ? colors.divider : "transparent" }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>🔔</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.notifications")}
              </Text>
            </View>
            <Switch
              value={notifications}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {notifications && (
            <View style={[sStyles.row, { borderBottomColor: "transparent" }]}>
              <View style={sStyles.rowLeft}>
                <Text style={sStyles.rowIcon}>🕐</Text>
                <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                  {t("settings.reminder_time")}
                </Text>
              </View>
              <View style={sStyles.rowRight}>
                <TimePicker
                  value={reminderTime}
                  onChange={handleReminderTimeChange}
                  colors={colors}
                />
              </View>
            </View>
          )}
        </View>

        {/* ── Hesap ─────────────────────────────────────── */}
        <SectionTitle label={t("settings.account").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: colors.divider }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>✉️</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>Email</Text>
            </View>
            <Text style={[sStyles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          {user?.is_premium && (
            <TouchableOpacity
              style={[sStyles.row, { borderBottomColor: colors.divider }]}
              onPress={() =>
                Linking.openURL(
                  Platform.OS === "android"
                    ? "https://play.google.com/store/account/subscriptions?package=com.parlio.app"
                    : "https://apps.apple.com/account/subscriptions",
                )
              }
              activeOpacity={0.8}
            >
              <View style={sStyles.rowLeft}>
                <Text style={sStyles.rowIcon}>⭐</Text>
                <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                  {t("settings.manage_subscription")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[sStyles.row, { borderBottomColor: "transparent" }]}
            onPress={handleDeleteAccount}
            activeOpacity={0.8}
          >
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>🗑️</Text>
              <Text style={[sStyles.rowLabel, { color: colors.error }]}>
                {t("settings.delete_account")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ── Gizlilik ──────────────────────────────────── */}
        <SectionTitle label={t("leaderboard.badge_label").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: "transparent" }]}>
            <View style={[sStyles.rowLeft, { flex: 1, paddingRight: 8 }]}>
              <Text style={sStyles.rowIcon}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                  {t("settings.leaderboard_visible")}
                </Text>
                <Text style={[{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }]}>
                  {t("settings.leaderboard_visible_desc")}
                </Text>
              </View>
            </View>
            <Switch
              value={user?.leaderboard_visible ?? true}
              onValueChange={handleLeaderboardVisibleToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* ── Hakkında ──────────────────────────────────── */}
        <SectionTitle label={t("settings.about").toUpperCase()} colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
          <View style={[sStyles.row, { borderBottomColor: colors.divider }]}>
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>ℹ️</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.version")}
              </Text>
            </View>
            <Text style={[sStyles.rowValue, { color: colors.textSecondary }]}>1.0.0</Text>
          </View>
          <TouchableOpacity
            style={[sStyles.row, { borderBottomColor: colors.divider }]}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            activeOpacity={0.8}
          >
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>🔒</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("premium.privacy_policy")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[sStyles.row, { borderBottomColor: colors.divider }]}
            onPress={() => Linking.openURL(TERMS_URL)}
            activeOpacity={0.8}
          >
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>📋</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("premium.terms_of_service")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[sStyles.row, { borderBottomColor: colors.divider }]}
            onPress={handleFeedback}
            activeOpacity={0.8}
          >
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>💬</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.send_feedback")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[sStyles.row, { borderBottomColor: "transparent" }]}
            onPress={handleRateApp}
            activeOpacity={0.8}
          >
            <View style={sStyles.rowLeft}>
              <Text style={sStyles.rowIcon}>⭐</Text>
              <Text style={[sStyles.rowLabel, { color: colors.text }]}>
                {t("settings.rate_app")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={deletingAccount} transparent animationType="fade">
        <View style={overlayStyles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={overlayStyles.overlayText}>{t("common.loading")}</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { padding: 16 },
  section: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
});

const sStyles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 14,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rowIcon: { fontSize: 18 },
  rowLabel: { fontSize: 15 },
  rowRight: { flexShrink: 0 },
  rowValue: { fontSize: 13, maxWidth: 160 },
  goalChips: { flexDirection: "row", gap: 6 },
  goalChip: {
    width: 36,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  goalChipText: { fontSize: 12, fontWeight: "600" },
});

const overlayStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  overlayText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
