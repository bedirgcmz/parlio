import { create } from "zustand";
import { supabase } from "../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SupportedLanguage } from "@/types";
import {
  getNotificationPermissionStatus,
  syncDailyReminderSchedule,
} from "@/services/notifications";
import { useNetworkStore } from "./useNetworkStore";

interface Settings {
  uiLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  theme: "light" | "dark";
  dailyGoal: number;
  notifications: boolean;
  reminderTime: string; // HH:MM format
  autoModeSpeed: number; // 0.5 to 2.0
  showTranslations: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
}

interface SettingsState extends Settings {
  bootstrapped: boolean;
  loading: boolean;
  initialized: boolean;
  loadedForUserId: string | null;
  pendingLanguagePreferenceNotice: {
    uiLanguage: SupportedLanguage;
    targetLanguage: SupportedLanguage;
  } | null;

  // Actions
  setUILanguage: (lang: SupportedLanguage) => Promise<void>;
  setTargetLanguage: (lang: SupportedLanguage) => Promise<void>;
  setTheme: (theme: "light" | "dark") => Promise<void>;
  setDailyGoal: (goal: number) => Promise<void>;
  setNotifications: (enabled: boolean) => Promise<void>;
  setReminderTime: (time: string) => Promise<void>;
  setAutoModeSpeed: (speed: number) => Promise<void>;
  setShowTranslations: (show: boolean) => Promise<void>;
  setTTSEnabled: (enabled: boolean) => Promise<void>;
  setTTSVoice: (voice: string) => Promise<void>;
  bootstrap: (input: {
    systemLanguage: SupportedLanguage;
    systemTargetLanguage: SupportedLanguage;
    systemTheme: "light" | "dark";
  }) => Promise<void>;
  loadSettings: (force?: boolean) => Promise<void>;
  saveSettings: (settings: Partial<Settings>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  clearPendingLanguagePreferenceNotice: () => void;
  clear: () => void;
}

const DEFAULT_SETTINGS: Settings = {
  uiLanguage: "tr",
  targetLanguage: "en",
  theme: "light",
  dailyGoal: 10,
  notifications: false,
  reminderTime: "19:00",
  autoModeSpeed: 1.0,
  showTranslations: true,
  ttsEnabled: true,
  ttsVoice: "default",
};

const LEGACY_STORAGE_KEY = "user_settings";

function getSettingsStorageKey(userId: string | null): string {
  return userId ? `user_settings:${userId}` : "user_settings:guest";
}

function createSystemDefaults(
  systemLanguage: SupportedLanguage,
  systemTargetLanguage: SupportedLanguage,
  systemTheme: "light" | "dark",
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    uiLanguage: systemLanguage,
    targetLanguage: systemTargetLanguage,
    theme: systemTheme,
  };
}

function createBootstrapAwareDefaults(state: SettingsState): Settings {
  return {
    ...DEFAULT_SETTINGS,
    uiLanguage: state.uiLanguage,
    targetLanguage: state.targetLanguage,
    theme: state.theme,
  };
}

async function persistSettingsToSupabase(userId: string, settings: Settings): Promise<void> {
  const currentUserId = await getCurrentUserId();
  if (currentUserId !== userId) return;

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      ui_language: settings.uiLanguage,
      target_language: settings.targetLanguage,
      theme: settings.theme,
      daily_goal: settings.dailyGoal,
      notifications: settings.notifications,
      reminder_time: settings.reminderTime,
      auto_mode_speed: settings.autoModeSpeed,
      show_translations: settings.showTranslations,
      tts_enabled: settings.ttsEnabled,
      tts_voice: settings.ttsVoice,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error && __DEV__) {
    console.error("Error saving settings to Supabase:", error);
  }
}

function toPersistedSettings(settings: Settings): Settings {
  return {
    uiLanguage: settings.uiLanguage,
    targetLanguage: settings.targetLanguage,
    theme: settings.theme,
    dailyGoal: settings.dailyGoal,
    notifications: settings.notifications,
    reminderTime: settings.reminderTime,
    autoModeSpeed: settings.autoModeSpeed,
    showTranslations: settings.showTranslations,
    ttsEnabled: settings.ttsEnabled,
    ttsVoice: settings.ttsVoice,
  };
}

function parseStoredSettings(raw: string | null): Settings | null {
  if (!raw) return null;

  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(raw) as Partial<Settings>),
    };
  } catch {
    return null;
  }
}

function hasLanguagePairMismatch(candidate: Settings | null, resolved: Settings): boolean {
  if (!candidate) return false;

  return (
    candidate.uiLanguage !== resolved.uiLanguage ||
    candidate.targetLanguage !== resolved.targetLanguage
  );
}

function areSettingsEqual(left: Settings, right: Settings): boolean {
  return (
    left.uiLanguage === right.uiLanguage &&
    left.targetLanguage === right.targetLanguage &&
    left.theme === right.theme &&
    left.dailyGoal === right.dailyGoal &&
    left.notifications === right.notifications &&
    left.reminderTime === right.reminderTime &&
    left.autoModeSpeed === right.autoModeSpeed &&
    left.showTranslations === right.showTranslations &&
    left.ttsEnabled === right.ttsEnabled &&
    left.ttsVoice === right.ttsVoice
  );
}

async function reconcileNotificationState(settings: Settings): Promise<Settings> {
  if (!settings.notifications) {
    await syncDailyReminderSchedule({
      enabled: false,
      reminderTime: settings.reminderTime,
      uiLanguage: settings.uiLanguage,
      dailyGoal: settings.dailyGoal,
    });
    return settings;
  }

  const syncOk = await syncDailyReminderSchedule({
    enabled: settings.notifications,
    reminderTime: settings.reminderTime,
    uiLanguage: settings.uiLanguage,
    dailyGoal: settings.dailyGoal,
  });

  if (!settings.notifications || syncOk) {
    return settings;
  }

  const permissionStatus = await getNotificationPermissionStatus();
  if (permissionStatus === "denied" || permissionStatus === "undetermined") {
    return settings;
  }

  return {
    ...settings,
    notifications: false,
  };
}

async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.user?.id ?? null;
}

function mapSupabaseSettings(settings: any): Settings {
  return {
    uiLanguage: settings.ui_language ?? DEFAULT_SETTINGS.uiLanguage,
    targetLanguage: settings.target_language ?? DEFAULT_SETTINGS.targetLanguage,
    theme: settings.theme ?? DEFAULT_SETTINGS.theme,
    dailyGoal: settings.daily_goal ?? DEFAULT_SETTINGS.dailyGoal,
    notifications: settings.notifications ?? DEFAULT_SETTINGS.notifications,
    reminderTime: settings.reminder_time ?? DEFAULT_SETTINGS.reminderTime,
    autoModeSpeed: settings.auto_mode_speed ?? DEFAULT_SETTINGS.autoModeSpeed,
    showTranslations: settings.show_translations ?? DEFAULT_SETTINGS.showTranslations,
    ttsEnabled: settings.tts_enabled ?? DEFAULT_SETTINGS.ttsEnabled,
    ttsVoice: settings.tts_voice ?? DEFAULT_SETTINGS.ttsVoice,
  };
}

async function fetchSupabaseSettings(userId: string): Promise<Settings | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapSupabaseSettings(data) : null;
}

async function persistSettingsLocally(userId: string | null, settings: Settings): Promise<void> {
  const payload = JSON.stringify(toPersistedSettings(settings));
  const storageKey = getSettingsStorageKey(userId);

  await AsyncStorage.setItem(storageKey, payload);

  if (userId) {
    await AsyncStorage.setItem(getSettingsStorageKey(null), payload);
  }

  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  bootstrapped: false,
  loading: false,
  initialized: false,
  loadedForUserId: null,
  pendingLanguagePreferenceNotice: null,

  setUILanguage: async (lang) => {
    set({ uiLanguage: lang });
    await get().saveSettings({ uiLanguage: lang });
  },

  setTargetLanguage: async (lang) => {
    set({ targetLanguage: lang });
    await get().saveSettings({ targetLanguage: lang });
  },

  setTheme: async (theme) => {
    set({ theme });
    await get().saveSettings({ theme });
  },

  setDailyGoal: async (goal) => {
    set({ dailyGoal: goal });
    await get().saveSettings({ dailyGoal: goal });
  },

  setNotifications: async (enabled) => {
    set({ notifications: enabled });
    await get().saveSettings({ notifications: enabled });
  },

  setReminderTime: async (time) => {
    set({ reminderTime: time });
    await get().saveSettings({ reminderTime: time });
  },

  setAutoModeSpeed: async (speed) => {
    set({ autoModeSpeed: speed });
    await get().saveSettings({ autoModeSpeed: speed });
  },

  setShowTranslations: async (show) => {
    set({ showTranslations: show });
    await get().saveSettings({ showTranslations: show });
  },

  setTTSEnabled: async (enabled) => {
    set({ ttsEnabled: enabled });
    await get().saveSettings({ ttsEnabled: enabled });
  },

  setTTSVoice: async (voice) => {
    set({ ttsVoice: voice });
    await get().saveSettings({ ttsVoice: voice });
  },

  bootstrap: async ({ systemLanguage, systemTargetLanguage, systemTheme }) => {
    if (get().bootstrapped) return;

    try {
      const userId = await getCurrentUserId();
      const userStorageKey = getSettingsStorageKey(userId);
      const guestStorageKey = getSettingsStorageKey(null);
      const systemDefaults = createSystemDefaults(
        systemLanguage,
        systemTargetLanguage,
        systemTheme,
      );

      const readLegacyInto = async (storageKey: string): Promise<string | null> => {
        let stored = await AsyncStorage.getItem(storageKey);
        if (!stored) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            stored = legacy;
            await AsyncStorage.setItem(storageKey, legacy).catch(() => {});
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
          }
        }
        return stored;
      };

      if (userId) {
        const cachedUser = parseStoredSettings(await readLegacyInto(userStorageKey));
        if (cachedUser) {
          set((state) => ({
            ...state,
            ...cachedUser,
            bootstrapped: true,
          }));
          return;
        }

        const guestSettings = parseStoredSettings(await AsyncStorage.getItem(guestStorageKey));
        if (guestSettings) {
          set((state) => ({
            ...state,
            ...guestSettings,
            bootstrapped: true,
          }));
          return;
        }

        set((state) => ({
          ...state,
          ...systemDefaults,
          bootstrapped: true,
        }));
        return;
      }

      const guestSettings = parseStoredSettings(await readLegacyInto(guestStorageKey));
      set((state) => ({
        ...state,
        ...(guestSettings ?? systemDefaults),
        bootstrapped: true,
      }));
    } catch (error) {
      if (__DEV__) console.error("Error bootstrapping settings:", error);
      set((state) => ({
        ...state,
        ...createSystemDefaults(systemLanguage, systemTargetLanguage, systemTheme),
        bootstrapped: true,
      }));
    }
  },

  loadSettings: async (force = false) => {
    try {
      const userId = await getCurrentUserId();
      const storageKey = getSettingsStorageKey(userId);
      const guestStorageKey = getSettingsStorageKey(null);
      if (!force && get().initialized && get().loadedForUserId === userId) {
        return;
      }

      const applyResolvedSettings = async (
        resolvedSettings: Settings,
        options: {
          userId: string | null;
          pendingLanguagePreferenceNotice: SettingsState["pendingLanguagePreferenceNotice"];
        },
      ) => {
        const currentUserId = await getCurrentUserId();
        if (currentUserId !== options.userId) {
          return;
        }

        set({
          ...resolvedSettings,
          bootstrapped: true,
          loading: false,
          initialized: true,
          loadedForUserId: options.userId,
          pendingLanguagePreferenceNotice: options.pendingLanguagePreferenceNotice,
        });
        await persistSettingsLocally(options.userId, resolvedSettings);
      };

      if (userId) {
        const guestSettings = parseStoredSettings(await AsyncStorage.getItem(guestStorageKey));

        let cachedUserRaw = await AsyncStorage.getItem(storageKey);
        if (!cachedUserRaw) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            cachedUserRaw = legacy;
            await AsyncStorage.setItem(storageKey, legacy).catch(() => {});
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
          }
        }

        const cachedUserSettings = parseStoredSettings(cachedUserRaw);
        if (cachedUserSettings) {
          const resolvedSettings = await reconcileNotificationState(cachedUserSettings);

          await applyResolvedSettings(resolvedSettings, {
            userId,
            pendingLanguagePreferenceNotice: hasLanguagePairMismatch(guestSettings, resolvedSettings)
              ? {
                  uiLanguage: resolvedSettings.uiLanguage,
                  targetLanguage: resolvedSettings.targetLanguage,
                }
              : null,
          });

          if (useNetworkStore.getState().isOnline === false) {
            return;
          }

          try {
            const serverSettings = await fetchSupabaseSettings(userId);

            if (!serverSettings) {
              await persistSettingsToSupabase(userId, resolvedSettings).catch((error) => {
                if (__DEV__) console.error("Error backfilling cached settings to Supabase:", error);
              });
              return;
            }

            const resolvedServerSettings = await reconcileNotificationState(serverSettings);
            await persistSettingsLocally(userId, resolvedServerSettings);

            if (areSettingsEqual(toPersistedSettings(get()), resolvedServerSettings)) {
              return;
            }

            set({
              ...resolvedServerSettings,
              bootstrapped: true,
              loading: false,
              initialized: true,
              loadedForUserId: userId,
              pendingLanguagePreferenceNotice: hasLanguagePairMismatch(
                guestSettings,
                resolvedServerSettings,
              )
                ? {
                    uiLanguage: resolvedServerSettings.uiLanguage,
                    targetLanguage: resolvedServerSettings.targetLanguage,
                  }
                : null,
            });
          } catch (error) {
            if (__DEV__) console.error("Error reconciling settings from Supabase:", error);
          }

          return;
        }

        if (useNetworkStore.getState().isOnline === false) {
          if (guestSettings) {
            const resolvedSettings = await reconcileNotificationState(guestSettings);

            await applyResolvedSettings(resolvedSettings, {
              userId,
              pendingLanguagePreferenceNotice: null,
            });
            return;
          }

          const resolvedDefaults = await reconcileNotificationState(
            createBootstrapAwareDefaults(get()),
          );

          await applyResolvedSettings(resolvedDefaults, {
            userId,
            pendingLanguagePreferenceNotice: null,
          });
          return;
        }

        set({ loading: true });

        let settings: Settings | null = null;
        try {
          settings = await fetchSupabaseSettings(userId);
        } catch (error) {
          if (__DEV__) console.error("Error fetching settings from Supabase:", error);

          if (guestSettings) {
            const resolvedSettings = await reconcileNotificationState(guestSettings);

            await applyResolvedSettings(resolvedSettings, {
              userId,
              pendingLanguagePreferenceNotice: null,
            });
            return;
          }

          const resolvedDefaults = await reconcileNotificationState(
            createBootstrapAwareDefaults(get()),
          );
          await applyResolvedSettings(resolvedDefaults, {
            userId,
            pendingLanguagePreferenceNotice: null,
          });
          return;
        }

        if (settings) {
          const resolvedSettings = await reconcileNotificationState(settings);

          await applyResolvedSettings(resolvedSettings, {
            userId,
            pendingLanguagePreferenceNotice: hasLanguagePairMismatch(guestSettings, resolvedSettings)
              ? {
                  uiLanguage: resolvedSettings.uiLanguage,
                  targetLanguage: resolvedSettings.targetLanguage,
                }
              : null,
          });
          return;
        }

        // First-time authenticated user: carry guest selection forward only if
        // the server truly has no saved settings for this account.
        if (guestSettings) {
          const resolvedSettings = await reconcileNotificationState(guestSettings);

          await applyResolvedSettings(resolvedSettings, {
            userId,
            pendingLanguagePreferenceNotice: null,
          });

          await persistSettingsToSupabase(userId, resolvedSettings).catch((error) => {
            if (__DEV__) console.error("Error syncing guest settings to Supabase:", error);
          });
          return;
        }

        const resolvedDefaults = await reconcileNotificationState(
          createBootstrapAwareDefaults(get()),
        );
        await applyResolvedSettings(resolvedDefaults, {
          userId,
          pendingLanguagePreferenceNotice: null,
        });
        return;
      }

      // Guest flow: use guest storage first, then legacy, then defaults.
      let stored = await AsyncStorage.getItem(storageKey);
      if (!stored) {
        const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          stored = legacy;
          await AsyncStorage.setItem(storageKey, legacy).catch(() => {});
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
        }
      }

      const guestResolved = parseStoredSettings(stored);
      if (guestResolved) {
        const resolvedSettings = await reconcileNotificationState(guestResolved);
        await applyResolvedSettings(resolvedSettings, {
          userId: null,
          pendingLanguagePreferenceNotice: null,
        });
        return;
      }

      const resolvedDefaults = await reconcileNotificationState(
        createBootstrapAwareDefaults(get()),
      );
      await applyResolvedSettings(resolvedDefaults, {
        userId,
        pendingLanguagePreferenceNotice: null,
      });
    } catch (error) {
      if (__DEV__) console.error("Error loading settings:", error);
      set({
        ...createBootstrapAwareDefaults(get()),
        bootstrapped: true,
        loading: false,
        initialized: true,
        loadedForUserId: null,
        pendingLanguagePreferenceNotice: null,
      });
    }
  },

  saveSettings: async (updates) => {
    const currentSettings = get();
    const requestedSettings: Settings = {
      uiLanguage: updates.uiLanguage ?? currentSettings.uiLanguage,
      targetLanguage: updates.targetLanguage ?? currentSettings.targetLanguage,
      theme: updates.theme ?? currentSettings.theme,
      dailyGoal: updates.dailyGoal ?? currentSettings.dailyGoal,
      notifications: updates.notifications ?? currentSettings.notifications,
      reminderTime: updates.reminderTime ?? currentSettings.reminderTime,
      autoModeSpeed: updates.autoModeSpeed ?? currentSettings.autoModeSpeed,
      showTranslations: updates.showTranslations ?? currentSettings.showTranslations,
      ttsEnabled: updates.ttsEnabled ?? currentSettings.ttsEnabled,
      ttsVoice: updates.ttsVoice ?? currentSettings.ttsVoice,
    };

    try {
      const userId = await getCurrentUserId();
      const storageKey = getSettingsStorageKey(userId);
      const guestStorageKey = getSettingsStorageKey(null);
      const resolvedSettings = await reconcileNotificationState(requestedSettings);

      set({
        ...resolvedSettings,
        bootstrapped: true,
        loadedForUserId: userId,
        pendingLanguagePreferenceNotice: null,
      });

      // Save to AsyncStorage
      await AsyncStorage.setItem(storageKey, JSON.stringify(toPersistedSettings(resolvedSettings)));
      await AsyncStorage.setItem(guestStorageKey, JSON.stringify(toPersistedSettings(resolvedSettings)));
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});

      // Save to Supabase if user is logged in
      if (userId) {
        await persistSettingsToSupabase(userId, resolvedSettings);
      }
    } catch (error) {
      if (__DEV__) console.error("Error saving settings:", error);
    }
  },

  resetToDefaults: async () => {
    set((state) => ({
      ...DEFAULT_SETTINGS,
      bootstrapped: true,
      loading: false,
      initialized: true,
      loadedForUserId: state.loadedForUserId,
      pendingLanguagePreferenceNotice: null,
    }));
    await get().saveSettings(DEFAULT_SETTINGS);
  },

  clearPendingLanguagePreferenceNotice: () =>
    set({
      pendingLanguagePreferenceNotice: null,
    }),

  clear: () =>
    set({
      ...DEFAULT_SETTINGS,
      bootstrapped: false,
      loading: false,
      initialized: false,
      loadedForUserId: null,
      pendingLanguagePreferenceNotice: null,
    }),
}));
