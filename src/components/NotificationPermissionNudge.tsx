import React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  getNotificationPermissionStatus,
  syncDailyReminderSchedule,
} from "@/services/notifications";

const NUDGE_KEY_PREFIX = "notification_permission_nudge_v1:";

function getNudgeKey(userId: string): string {
  return `${NUDGE_KEY_PREFIX}${userId}`;
}

export function NotificationPermissionNudge() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const initialized = useSettingsStore((s) => s.initialized);
  const notifications = useSettingsStore((s) => s.notifications);
  const reminderTime = useSettingsStore((s) => s.reminderTime);
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);
  const dailyGoal = useSettingsStore((s) => s.dailyGoal);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!initialized || !userId) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const dismissed = await AsyncStorage.getItem(getNudgeKey(userId));
          if (dismissed || cancelled) return;

          const status = await getNotificationPermissionStatus();
          if (status === "granted" || status === "unavailable" || cancelled) return;

          setVisible(true);
        } catch {
          // If storage or permission lookup fails, stay quiet.
        }
      })();
    }, 1600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialized, userId, notifications]);

  const rememberChoice = React.useCallback(async () => {
    if (!userId) return;
    await AsyncStorage.setItem(getNudgeKey(userId), "true").catch(() => {});
  }, [userId]);

  const handleDismiss = async () => {
    await rememberChoice();
    setVisible(false);
  };

  const handleEnable = async () => {
    setBusy(true);
    const scheduled = await syncDailyReminderSchedule({
      enabled: true,
      reminderTime,
      uiLanguage,
      dailyGoal,
      requestPermissions: true,
      title: t("settings.notif_title"),
      body: t("settings.notif_body"),
    });

    await rememberChoice();
    setBusy(false);
    setVisible(false);

    if (scheduled) {
      await setNotifications(true);
      Alert.alert(
        t("notification_permission.enabled_title"),
        t("notification_permission.enabled_body"),
      );
      return;
    }

    Alert.alert(
      t("notification_permission.denied_title"),
      t("notification_permission.denied_body"),
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.iconBubble, { backgroundColor: `${colors.primary}18` }]}>
            <Text style={[styles.iconText, { color: colors.primary }]}>!</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            {t("notification_permission.title")}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {t("notification_permission.body")}
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
            onPress={handleEnable}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {t("notification_permission.primary")}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            activeOpacity={0.75}
            onPress={handleDismiss}
            disabled={busy}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
              {t("notification_permission.secondary")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.38)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  iconText: {
    fontSize: 24,
    fontWeight: "800",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 20,
  },
  primaryButton: {
    width: "100%",
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
