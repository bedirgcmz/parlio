import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Linking, useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Providers
import { ThemeProvider } from "@/providers/ThemeProvider";
import { I18nProvider } from "@/providers/I18nProvider";
import { OnboardingProvider } from "@/providers/OnboardingProvider";

// Navigation
import AppNavigator from "@/navigation/AppNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Services
import { establishSessionFromCallbackUrl, isAuthCallbackUrl } from "@/lib/authCallback";

// Achievements
import { AchievementToast } from "@/components/AchievementToast";
import { NotificationSyncBridge } from "@/components/NotificationSyncBridge";
import { NotificationPermissionNudge } from "@/components/NotificationPermissionNudge";
import { useAchievementStore } from "@/store/useAchievementStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ensureInstallIntegrity } from "@/lib/installIntegrity";
import i18n from "@/i18n";
import type { SupportedLanguage } from "@/types";

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["tr", "en", "sv", "de", "es", "fr", "pt"];

function resolveStartupLanguagePair(): {
  uiLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
} {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale?.toLowerCase() ?? "en";
  const baseLanguage = locale.split("-")[0] as SupportedLanguage;
  const uiLanguage = SUPPORTED_LANGUAGES.includes(baseLanguage) ? baseLanguage : "en";
  const targetLanguage: SupportedLanguage = uiLanguage === "en" ? "de" : "en";

  return { uiLanguage, targetLanguage };
}

export default function App() {
  const systemColorScheme = useColorScheme();
  const loadAchievements = useAchievementStore((s) => s.loadAchievements);
  const clearAchievements = useAchievementStore((s) => s.clear);
  const activatePasswordRecovery = useAuthStore((s) => s.activatePasswordRecovery);
  const clearPasswordRecovery = useAuthStore((s) => s.clearPasswordRecovery);
  const clearAuthState = useAuthStore((s) => s.clear);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const bootstrapped = useSettingsStore((s) => s.bootstrapped);
  const bootstrapSettings = useSettingsStore((s) => s.bootstrap);
  const clearSettingsState = useSettingsStore((s) => s.clear);
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (bootstrapped) {
      setStartupReady(true);
      return () => {
        cancelled = true;
      };
    }

    setStartupReady(false);

    void (async () => {
      try {
        const integrity = await ensureInstallIntegrity();
        if (integrity.resetPerformed) {
          if (__DEV__) console.log("[install] integrity reset performed");
          clearAuthState();
          clearSettingsState();
          clearAchievements();
        }

        const { uiLanguage, targetLanguage } = resolveStartupLanguagePair();
        await bootstrapSettings({
          systemLanguage: uiLanguage,
          systemTargetLanguage: targetLanguage,
          systemTheme: systemColorScheme === "dark" ? "dark" : "light",
        });

        const bootstrappedLanguage = useSettingsStore.getState().uiLanguage;
        if (bootstrappedLanguage && i18n.language !== bootstrappedLanguage) {
          await i18n.changeLanguage(bootstrappedLanguage);
        }
      } catch (error) {
        console.error("[App] settings bootstrap error:", error);
      } finally {
        if (!cancelled) {
          setStartupReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapped,
    bootstrapSettings,
    clearAchievements,
    clearAuthState,
    clearSettingsState,
    systemColorScheme,
  ]);

  useEffect(() => {
    if (!userId) {
      clearAchievements();
      return;
    }
    loadAchievements().catch((e) => console.error("[App] loadAchievements error:", e));
  }, [userId, loadAchievements, clearAchievements]);

  // Shared handler for both cold-start and warm-start auth deep links.
  useEffect(() => {
    const handleAuthCallback = async (url: string) => {
      if (!isAuthCallbackUrl(url)) return;

      if (__DEV__) {
        console.log("[auth] handle callback url", {
          resetPassword: url.includes("auth/reset-password"),
        });
      }

      const result = await establishSessionFromCallbackUrl(url);

      if (url.includes("auth/reset-password")) {
        if (result.session) {
          activatePasswordRecovery();
        } else {
          clearPasswordRecovery();
          if (result.error) {
            console.error("[App] password recovery session error:", result.error);
          }
        }
      } else if (result.error && !result.duplicate) {
        console.error("[App] auth callback session error:", result.error);
      } else if (!result.session && !result.duplicate) {
        console.error("[App] auth callback missing session");
      }
    };

    // Cold-start: app was killed and opened via deep link
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleAuthCallback(url).catch((e) => console.error("[App] cold-start auth error:", e));
      })
      .catch((e) => console.error("[App] getInitialURL error:", e));

    // Warm-start: app is already running and receives a deep link
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleAuthCallback(url).catch((e) => console.error("[App] warm-start auth error:", e));
    });

    return () => subscription.remove();
  }, []);

  if (!startupReady || !bootstrapped) {
    const backgroundColor = systemColorScheme === "dark" ? "#0B1020" : "#FAF8F4";

    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor,
        }}
      >
        <ActivityIndicator size="small" color="#4DA3FF" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <I18nProvider>
            <ThemeProvider>
              <OnboardingProvider>
                <AppNavigator />
                <AchievementToast />
                <NotificationSyncBridge />
                <NotificationPermissionNudge />
                <StatusBar style="auto" />
              </OnboardingProvider>
            </ThemeProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
