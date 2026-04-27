import React, { useEffect, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "@/store/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useNetworkStore } from "@/store/useNetworkStore";
import { useSentenceStore } from "@/store/useSentenceStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useGameStore } from "@/store/useGameStore";
import { useOfflineQueueStore } from "@/store/useOfflineQueueStore";
import { useReadingStore } from "@/store/useReadingStore";
import { View, Text, StyleSheet, ActivityIndicator, Alert, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { setReturningWelcomeShownCount } from "@/lib/startupUx";

// Screens
import AuthNavigator from "./AuthNavigator";
import MainNavigator from "./MainNavigator";
import WelcomeScreen from "@/screens/onboarding/WelcomeScreen";
import CompleteResetPasswordScreen from "@/screens/auth/CompleteResetPasswordScreen";
import i18n from "@/i18n";

const Stack = createNativeStackNavigator();
const REMEMBERED_SHELL_MIN_MS = 1400;
const LANGUAGE_NOTICE_DELAY_MS = 900;

function StartupLoadingScreen({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const { colors } = useTheme();

  return (
    <View style={[startupStyles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          startupStyles.card,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.border,
            shadowColor: colors.text,
          },
        ]}
      >
        <View
          style={[
            startupStyles.badge,
            {
              backgroundColor: colors.accent + "16",
              borderColor: colors.accent + "22",
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
          <Text style={[startupStyles.badgeText, { color: colors.accent }]}>Parlio</Text>
        </View>

        <Text style={[startupStyles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[startupStyles.body, { color: colors.textSecondary }]}>{body}</Text>

        <View
          style={[
            startupStyles.loadingPill,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.borderLight,
            },
          ]}
        >
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[startupStyles.loadingPillText, { color: colors.textSecondary }]}>
            {body}
          </Text>
        </View>
      </View>
    </View>
  );
}

function WelcomeBackToast({
  message,
  onDone,
}: {
  message: string | null;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) {
      translateY.setValue(-80);
      opacity.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -80,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(onDone);
    }, 2300);

    return () => clearTimeout(timer);
  }, [message, onDone, opacity, translateY]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        startupStyles.toast,
        {
          top: insets.top + 10,
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
          shadowColor: colors.text,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[startupStyles.toastIconWrap, { backgroundColor: colors.success + "18" }]}>
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
      </View>
      <Text style={[startupStyles.toastText, { color: colors.text }]}>{message}</Text>
    </Animated.View>
  );
}

export default function AppNavigator() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, initialized, initialize, passwordRecoveryActive } = useAuthStore();
  const pendingReturningWelcome = useAuthStore((s) => s.pendingReturningWelcome);
  const consumePendingReturningWelcome = useAuthStore((s) => s.consumePendingReturningWelcome);
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);
  const targetLanguage = useSettingsStore((s) => s.targetLanguage);
  const settingsInitialized = useSettingsStore((s) => s.initialized);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const loadedForUserId = useSettingsStore((s) => s.loadedForUserId);
  const pendingLanguagePreferenceNotice = useSettingsStore((s) => s.pendingLanguagePreferenceNotice);
  const clearPendingLanguagePreferenceNotice = useSettingsStore((s) => s.clearPendingLanguagePreferenceNotice);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const currentUserId = user?.id ?? null;
  const settingsReadyForCurrentUser = settingsInitialized && loadedForUserId === currentUserId;

  // Network store
  const reconnectCount = useNetworkStore((s) => s.reconnectCount);
  const isOnline = useNetworkStore((s) => s.isOnline);
  const initializeNetwork = useNetworkStore((s) => s.initialize);

  // Track which reconnect events we've already handled
  const handledReconnectCount = useRef(0);
  // Track eager load per user so we don't repeat it on every render
  const eagerLoadedForUser = useRef<string | null>(null);
  const shownLanguageNoticeKey = useRef<string | null>(null);
  const scheduledLanguageNoticeKey = useRef<string | null>(null);
  const languageNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returningWelcomeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returningWelcomeStartedAtRef = useRef<number | null>(null);
  const [welcomeBackToast, setWelcomeBackToast] = useState<string | null>(null);
  const [returningWelcomeVisible, setReturningWelcomeVisible] = useState(false);

  // ── Auth initialisation ───────────────────────────────────────────────────
  useEffect(() => {
    initialize().catch((e) => console.error("[AppNavigator] init failed:", e));
  }, [initialize]);

  // ── Settings load (triggered on auth state change) ────────────────────────
  useEffect(() => {
    if (!initialized) return;
    loadSettings(true).catch((e) => console.error("[AppNavigator] settings load failed:", e));
  }, [initialized, user?.id, loadSettings]);

  // ── Network monitor: initialise once, clean up on unmount ─────────────────
  useEffect(() => {
    const cleanup = initializeNetwork();
    return cleanup;
  }, [initializeNetwork]);

  // ── Eager cache population: fires once per user when online + settings ready ─
  // Ensures all stores are loaded and cached on the first online session so
  // subsequent cold-starts work correctly offline. Without this, cache is only
  // written lazily (when individual screens are visited), meaning the user has
  // to visit every tab at least once before offline mode has anything to show.
  useEffect(() => {
    if (!user?.id) {
      // Reset on logout so next login triggers a fresh eager load
      eagerLoadedForUser.current = null;
      return;
    }
    if (!settingsReadyForCurrentUser) return;
    if (isOnline !== true) return; // null = unknown, false = offline — skip both
    if (eagerLoadedForUser.current === user.id) return; // already done for this user

    eagerLoadedForUser.current = user.id;

    console.log("[AppNavigator] eager cache population — user online, loading all stores");

    const { is_premium } = useAuthStore.getState().user ?? { is_premium: false };

    // ── Queue-first startup drain ─────────────────────────────────────────────
    // processQueue() is only triggered in the reconnect handler, which fires
    // when isOnline goes false → true. When the app starts with internet already
    // available (null → true), reconnectCount never increments and processQueue
    // is never called. Draining here before store refreshes mirrors the reconnect
    // handler's queue-first order and covers the startup-online scenario.
    void (async () => {
      await useOfflineQueueStore.getState().processQueue();
      await useGameStore.getState().retryPendingScore();

      void useSentenceStore.getState().loadCategories();
      void useSentenceStore.getState().loadFavorites();
      void useSentenceStore.getState().loadSentences();
      void useProgressStore.getState().loadProgress();
      void useGameStore.getState().loadUserStats();
      void useSentenceStore.getState().loadPresetSentences(undefined, is_premium);
      void useReadingStore.getState().fetchProgress(user.id);
      void useReadingStore.getState().fetchNextText(user.id, false, is_premium);
    })();
  }, [user?.id, settingsReadyForCurrentUser, isOnline]);

  // ── Reconnect: refresh stores when connectivity is restored ───────────────
  useEffect(() => {
    // Ignore the initial value (reconnectCount starts at 0, only act on increments)
    if (reconnectCount === 0) return;
    // Skip if we've already handled this particular reconnect event
    if (reconnectCount <= handledReconnectCount.current) return;

    handledReconnectCount.current = reconnectCount;

    if (!user?.id) return;

    console.log("[AppNavigator] connectivity restored — draining queue then refreshing stores");

    // ── Queue-first reconnect ─────────────────────────────────────────────────
    // IMPORTANT: drain the offline queue BEFORE refreshing stores from the
    // network. If we refresh first, the server's stale state overwrites the
    // optimistic local state that the queue items are about to fix.
    //
    // Order:
    //  1. processQueue()      — commit pending progress/favorites/quiz/study
    //  2. retryPendingScore() — commit pending game scores (separate queue)
    //  3. parallel store refreshes — now safe, server has the correct state
    void (async () => {
      await useOfflineQueueStore.getState().processQueue();
      await useGameStore.getState().retryPendingScore();
      await loadSettings(true).catch((error) => {
        console.error("[AppNavigator] reconnect settings reconcile failed:", error);
      });

      // Parallel store refreshes — cache-first, no spinner if data already visible
      void useSentenceStore.getState().loadCategories();
      void useSentenceStore.getState().loadFavorites();
      void useSentenceStore.getState().loadSentences();
      void useProgressStore.getState().loadProgress();
      void useGameStore.getState().loadUserStats();
      void useReadingStore.getState().fetchProgress(user.id);

      // Preset sentences depend on settings (lang pair / premium) —
      // only refresh if settings are ready so we use the correct cache key.
      if (settingsReadyForCurrentUser) {
        const { is_premium } = useAuthStore.getState().user ?? { is_premium: false };
        void useSentenceStore.getState().loadPresetSentences(undefined, is_premium);
        // NOTE: fetchNextText is intentionally NOT called here. Reconnect fires
        // while the user may already be mid-read (currentText set from cache).
        // Calling fetchNextText would overwrite the active text and show a spinner.
        // fetchProgress above is sufficient for stats sync; the reading text
        // refreshes naturally when the user navigates to the Reading tab.
      }
    })();
  }, [loadSettings, reconnectCount, user?.id, settingsReadyForCurrentUser]);

  // ── Language preference alert ──────────────────────────────────────────────
  useEffect(() => {
    if (languageNoticeTimerRef.current) {
      clearTimeout(languageNoticeTimerRef.current);
      languageNoticeTimerRef.current = null;
    }

    if (!user || !pendingLanguagePreferenceNotice) {
      scheduledLanguageNoticeKey.current = null;
      return;
    }
    if (!settingsReadyForCurrentUser || settingsLoading) {
      scheduledLanguageNoticeKey.current = null;
      return;
    }
    if (i18n.language !== pendingLanguagePreferenceNotice.uiLanguage) {
      scheduledLanguageNoticeKey.current = null;
      return;
    }
    if (returningWelcomeVisible || welcomeBackToast) {
      scheduledLanguageNoticeKey.current = null;
      return;
    }

    const noticeKey = [
      user.id,
      pendingLanguagePreferenceNotice.uiLanguage,
      pendingLanguagePreferenceNotice.targetLanguage,
      uiLanguage,
      targetLanguage,
    ].join(":");

    if (
      shownLanguageNoticeKey.current === noticeKey ||
      scheduledLanguageNoticeKey.current === noticeKey
    ) {
      return;
    }

    scheduledLanguageNoticeKey.current = noticeKey;

    const moreTabLabel = t("tabs.more", { defaultValue: "More" });
    const settingsLabel = t("common.settings", { defaultValue: t("settings.title") });

    languageNoticeTimerRef.current = setTimeout(() => {
      scheduledLanguageNoticeKey.current = null;
      shownLanguageNoticeKey.current = noticeKey;
      clearPendingLanguagePreferenceNotice();

      Alert.alert(
        t("onboarding.saved_language_settings_title"),
        t("onboarding.saved_language_settings_body", {
          pair: `${uiLanguage.toUpperCase()}-${targetLanguage.toUpperCase()}`,
          moreTab: moreTabLabel,
          settingsLabel,
        }),
        [
          {
            text: t("common.ok"),
            onPress: () => {
              shownLanguageNoticeKey.current = null;
            },
          },
        ],
      );
    }, LANGUAGE_NOTICE_DELAY_MS);

    return () => {
      if (languageNoticeTimerRef.current) {
        clearTimeout(languageNoticeTimerRef.current);
        languageNoticeTimerRef.current = null;
      }
      if (scheduledLanguageNoticeKey.current === noticeKey) {
        scheduledLanguageNoticeKey.current = null;
      }
    };
  }, [
    clearPendingLanguagePreferenceNotice,
    pendingLanguagePreferenceNotice,
    returningWelcomeVisible,
    settingsLoading,
    settingsReadyForCurrentUser,
    t,
    targetLanguage,
    uiLanguage,
    user,
    welcomeBackToast,
  ]);

  useEffect(() => {
    if (pendingLanguagePreferenceNotice) return;
    shownLanguageNoticeKey.current = null;
    scheduledLanguageNoticeKey.current = null;
  }, [pendingLanguagePreferenceNotice, user?.id]);

  const activeReturningWelcome =
    pendingReturningWelcome && user?.id === pendingReturningWelcome.userId
      ? pendingReturningWelcome
      : null;
  const waitingOnAppReady = !initialized || !settingsReadyForCurrentUser || settingsLoading;

  useEffect(() => {
    if (returningWelcomeHideTimerRef.current) {
      clearTimeout(returningWelcomeHideTimerRef.current);
      returningWelcomeHideTimerRef.current = null;
    }

    if (!activeReturningWelcome) {
      returningWelcomeStartedAtRef.current = null;
      setReturningWelcomeVisible(false);
      return;
    }

    if (returningWelcomeStartedAtRef.current == null) {
      returningWelcomeStartedAtRef.current = Date.now();
    }

    setReturningWelcomeVisible(true);

    if (waitingOnAppReady) {
      return;
    }

    const elapsed = Date.now() - returningWelcomeStartedAtRef.current;
    const remaining = Math.max(0, REMEMBERED_SHELL_MIN_MS - elapsed);

    const { userId, signInCount } = activeReturningWelcome;

    returningWelcomeHideTimerRef.current = setTimeout(() => {
      returningWelcomeStartedAtRef.current = null;
      setReturningWelcomeVisible(false);
      consumePendingReturningWelcome();
      setWelcomeBackToast(t("onboarding.welcome_back_toast"));
      void setReturningWelcomeShownCount(userId, signInCount);
    }, remaining);

    return () => {
      if (returningWelcomeHideTimerRef.current) {
        clearTimeout(returningWelcomeHideTimerRef.current);
        returningWelcomeHideTimerRef.current = null;
      }
    };
  }, [
    activeReturningWelcome,
    consumePendingReturningWelcome,
    t,
    waitingOnAppReady,
  ]);

  // Show loading while initialising
  if (returningWelcomeVisible) {
    return (
      <StartupLoadingScreen
        title={t("onboarding.remembered_title")}
        body={t("onboarding.remembered_body")}
      />
    );
  }

  if (!initialized || !settingsReadyForCurrentUser || settingsLoading) {
    return (
      <StartupLoadingScreen
        title={t("common.loading")}
        body={t("onboarding.startup_preparing_body")}
      />
    );
  }

  return (
    <View style={offlineStyles.root}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {passwordRecoveryActive ? (
            <Stack.Screen name="PasswordRecovery" component={CompleteResetPasswordScreen} />
          ) : user ? (
            <Stack.Screen name="Main" component={MainNavigator} />
          ) : (
            <>
              <Stack.Screen name="Welcome" component={WelcomeScreen} />
              <Stack.Screen name="AuthFlow" component={AuthNavigator} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {/* Global offline pill — absolutely positioned with pointerEvents="none"
          so touches pass through to the content underneath.
          Trade-off: won't appear above React Native Modal overlays (separate
          UIWindow layer on iOS), but this is acceptable — the pill must never
          block navigation. */}
      {isOnline === false && (
        <View pointerEvents="none" style={offlineStyles.pillHost}>
          <View style={[offlineStyles.pill, { top: insets.top + 8 }]}>
            <Ionicons name="wifi-outline" size={13} color="#fff" />
            <Text style={offlineStyles.pillText}>{t("common.offline_indicator")}</Text>
          </View>
        </View>
      )}

      <WelcomeBackToast message={welcomeBackToast} onDone={() => setWelcomeBackToast(null)} />
    </View>
  );
}

const startupStyles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 24,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 10,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 16,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  loadingPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  loadingPillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  toastIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  toastText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
});

const offlineStyles = StyleSheet.create({
  root: { flex: 1 },
  pillHost: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  pill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(30,30,30,0.82)",
  },
  pillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
