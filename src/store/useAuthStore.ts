import { create } from "zustand";
import { Alert, Platform } from "react-native";
import i18n from "@/i18n";
import * as WebBrowser from "expo-web-browser";
import { clearStoredSupabaseSession, supabase } from "../lib/supabase";
import { getReturningWelcomeShownCount } from "@/lib/startupUx";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cachePremiumVerification,
  clearCachedPremiumGrace,
  getCachedPremiumGrace,
  logInUser,
  logOutUser,
  setupCustomerInfoListener,
} from "@/services/revenueCat";
import * as AppleAuthentication from "expo-apple-authentication";
import { clearAITrialCache } from "@/services/gemini";
import { establishSessionFromCallbackUrl } from "@/lib/authCallback";
import { getInstallId } from "@/lib/installIntegrity";
import type { GameLeaderboard } from "@/types/game";
import { useAchievementStore } from "./useAchievementStore";
import { useGameStore } from "./useGameStore";
import { useLeaderboardStore } from "./useLeaderboardStore";
import { useProgressStore } from "./useProgressStore";
import { useReadingStore } from "./useReadingStore";
import { useSentenceStore } from "./useSentenceStore";
import { useSettingsStore } from "./useSettingsStore";
import { clearUserCache, readCache } from "@/lib/offlineCache";
import { useOfflineQueueStore } from "./useOfflineQueueStore";
import type { Category } from "@/types";

interface User {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  is_premium: boolean;
  premium_override: boolean;
  leaderboard_visible: boolean;
  created_at: string;
}

interface PendingReturningWelcome {
  userId: string;
  signInCount: number;
}

/** Returns true if the manual override is active (set and not expired). */
function isOverrideActive(profile: { premium_override?: boolean; premium_override_expires_at?: string | null } | null | undefined): boolean {
  if (!profile?.premium_override) return false;
  const exp = profile.premium_override_expires_at;
  if (!exp) return true; // permanent
  return new Date(exp) > new Date();
}

async function resolveEffectivePremiumStatus(
  userId: string,
  profile:
    | {
        is_premium?: boolean;
        premium_override?: boolean;
        premium_override_expires_at?: string | null;
      }
    | null
    | undefined,
  rcActive: boolean,
  rcVerified: boolean
): Promise<{ premiumOverrideActive: boolean; isPremium: boolean }> {
  const premiumOverrideActive = isOverrideActive(profile);
  const graceActive = !rcVerified ? await getCachedPremiumGrace(userId) : false;

  return {
    premiumOverrideActive,
    isPremium:
      rcActive ||
      premiumOverrideActive ||
      graceActive ||
      (!rcVerified && (profile?.is_premium ?? false)),
  };
}

interface AuthState {
  user: User | null;
  session: any;
  loading: boolean;
  initialized: boolean;
  startupAuthSource: "restored" | "interactive" | "none";
  profileHydrated: boolean;
  isPremiumVerified: boolean;
  passwordRecoveryActive: boolean;
  pendingReturningWelcome: PendingReturningWelcome | null;

  // Actions
  setPremiumStatus: (active: boolean) => void;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  signInWithApple: () => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<{ success: boolean; error?: string }>;
  uploadAvatar: (
    uri: string,
    base64?: string,
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  removeAvatar: () => Promise<{ success: boolean; error?: string }>;
  updateEmail: (newEmail: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  verifyAndUpdatePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ success: boolean; wrongPassword?: boolean; error?: string }>;
  activatePasswordRecovery: () => void;
  clearPasswordRecovery: () => void;
  consumePendingReturningWelcome: () => void;
  initialize: () => Promise<void>;
  clear: () => void;
}

// Module-level subscription handle — prevents duplicate listeners across
// multiple `initialize` calls (e.g. hot-reload or fast-refresh cycles).
let authSubscription: { unsubscribe: () => void } | null = null;

// Module-level RC listener cleanup — ensures only one listener is active at a time.
let rcListenerRemover: (() => void) | null = null;
let lastHydratedSessionKey: string | null = null;
let inFlightHydrationKey: string | null = null;
let inFlightHydrationPromise: Promise<void> | null = null;
let authStateVersion = 0;
let pendingExplicitCleanupReason: "manual_signout" | "delete_account" | null = null;
let lastCleanupReason: "manual_signout" | "delete_account" | "signed_out" | "store_clear" | null =
  null;
let lastCleanupAt = 0;

const AVATAR_BUCKET = "user_profile_img";
const AVATAR_FILE_PREFIX = "avatar.";
const AVATAR_FALLBACK_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
const LEGACY_SESSION_STORAGE_KEY = "supabase_session";
const EXPLICIT_CLEANUP_GUARD_MS = 3000;

function clearClientStores() {
  useSentenceStore.getState().clear();
  useProgressStore.getState().clear();
  useLeaderboardStore.getState().clear();
  useAchievementStore.getState().clear();
  useReadingStore.getState().clear();
  useGameStore.getState().clear();
  useSettingsStore.getState().clear();
}

/**
 * Pre-populate stores from AsyncStorage cache before the first screen renders.
 *
 * Called in `initialize()` immediately after session detection — before
 * `initialized=true` — so that by the time the nav stack mounts, stores
 * already have meaningful cached data from the previous session.
 *
 * Identity source: the userId passed in from the session (already resolved
 * offline-safely via getSession in initialize()). No network calls here.
 *
 * Hydrates the full set of user-visible data:
 *  - progress / progressMap / stats (progress tab)
 *  - game user stats (games tab)
 *  - categories (public, used everywhere)
 *  - user sentences (my sentences tab)
 *  - favorite IDs (favorites screen)
 *  - preset sentences (main learn tab) — located via user_preset_hint cache
 *  - pending offline score queue (game submission retry)
 */
async function hydrateStoresFromCache(userId: string): Promise<void> {
  await Promise.all([
    // ── Progress map + stats ─────────────────────────────────────────────────
    (async () => {
      const cached = await readCache<{
        progress: any[];
        progressMap: Record<string, "learning" | "learned">;
        stats: any;
      }>(`progress:${userId}`);
      if (cached && Object.keys(cached.progressMap ?? {}).length > 0) {
        useProgressStore.setState({
          progress: cached.progress ?? [],
          progressMap: cached.progressMap,
          stats: cached.stats,
        });
      }
    })(),

    // ── Game user stats ──────────────────────────────────────────────────────
    (async () => {
      const cached = await readCache<any>(`game_stats:${userId}`);
      if (cached) {
        useGameStore.setState({ userStats: cached });
      }
    })(),

    // ── Categories (public — no user scope) ──────────────────────────────────
    (async () => {
      const cached = await readCache<Category[]>("categories");
      if (cached && cached.length > 0) {
        useSentenceStore.setState({ categories: cached });
      }
    })(),

    // ── User sentences ───────────────────────────────────────────────────────
    (async () => {
      const cached = await readCache<any[]>(`user_sentences:${userId}`);
      if (cached && cached.length > 0) {
        useSentenceStore.setState({ sentences: cached });
      }
    })(),

    // ── Favorite IDs ─────────────────────────────────────────────────────────
    (async () => {
      const cached = await readCache<string[]>(`favorites:${userId}`);
      if (cached && cached.length > 0) {
        useSentenceStore.setState({ favoriteIds: cached });
      }
    })(),

    // ── Preset sentences (via stored hint) ───────────────────────────────────
    // IMPORTANT: startup hydration must never trust a stale premium hint, or a
    // user whose entitlement lapsed overnight could see premium-only cached
    // presets while offline. We therefore hydrate only the conservative free
    // cache on cold start. Premium users are upgraded later after live
    // entitlement verification and normal screen-level revalidation.
    //
    // `user_preset_hint:{userId}` is still useful because it tells us which
    // language pair to hydrate for the main learning flow.
    (async () => {
      const hint = await readCache<{
        uiLanguage: string;
        targetLanguage: string;
        isPremium: boolean;
      }>(`user_preset_hint:${userId}`);
      if (hint) {
        const presetKey = `preset_sentences:${hint.uiLanguage}_${hint.targetLanguage}:free`;
        const cached = await readCache<any[]>(presetKey);
        if (cached && cached.length > 0) {
          useSentenceStore.setState({ presetSentences: cached });
        }
      }
    })(),

    // ── Pending offline score queue ──────────────────────────────────────────
    (async () => {
      await useGameStore.getState().loadPersistedPendingScores(userId);
    })(),

    // ── Offline action queue (progress / favorites / quiz / study) ───────────
    (async () => {
      await useOfflineQueueStore.getState().hydrateQueue(userId);
    })(),
  ]);
}

function extractAvatarStoragePath(avatarUrl: string | undefined, userId: string): string | null {
  if (!avatarUrl) return null;

  try {
    const url = new URL(avatarUrl);
    const marker = `/object/public/${AVATAR_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1) return null;

    const storagePath = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return storagePath.startsWith(`${userId}/`) ? storagePath : null;
  } catch {
    return null;
  }
}

async function resolveAvatarPaths(userId: string, avatarUrl?: string): Promise<string[]> {
  const avatarPaths = new Set<string>();

  const currentAvatarPath = extractAvatarStoragePath(avatarUrl, userId);
  if (currentAvatarPath) {
    avatarPaths.add(currentAvatarPath);
  }

  const { data: files, error } = await supabase.storage.from(AVATAR_BUCKET).list(userId, {
    limit: 20,
  });

  if (!error) {
    files
      ?.filter((file) => file.name.startsWith(AVATAR_FILE_PREFIX))
      .forEach((file) => avatarPaths.add(`${userId}/${file.name}`));
  }

  if (avatarPaths.size > 0) {
    return Array.from(avatarPaths);
  }

  return AVATAR_FALLBACK_EXTENSIONS.map((ext) => `${userId}/avatar.${ext}`);
}

function syncProfileCaches(
  userId: string,
  updates: Partial<Pick<User, "display_name" | "avatar_url">>
) {
  const hasDisplayName = Object.prototype.hasOwnProperty.call(updates, "display_name");
  const hasAvatarUrl = Object.prototype.hasOwnProperty.call(updates, "avatar_url");

  if (!hasDisplayName && !hasAvatarUrl) return;

  useLeaderboardStore.setState((state) => {
    const patchEntry = (entry: typeof state.entries[number]) =>
      entry.user_id === userId
        ? {
            ...entry,
            ...(hasDisplayName ? { display_name: updates.display_name || entry.display_name } : {}),
            ...(hasAvatarUrl ? { avatar_url: updates.avatar_url ?? null } : {}),
          }
        : entry;

    return {
      entries: state.entries.map(patchEntry),
      myEntry: state.myEntry ? patchEntry(state.myEntry) : state.myEntry,
      lastFetchedAt: null,
    };
  });

  useGameStore.setState((state) => {
    const patchLeaderboard = (leaderboard: GameLeaderboard | null): GameLeaderboard | null =>
      leaderboard
        ? {
            ...leaderboard,
            entries: leaderboard.entries.map((entry) =>
              entry.userId === userId
                ? {
                    ...entry,
                    ...(hasDisplayName ? { displayName: updates.display_name || entry.displayName } : {}),
                    ...(hasAvatarUrl ? { avatarUrl: updates.avatar_url ?? null } : {}),
                  }
                : entry
            ),
          }
        : leaderboard;

    return {
      leaderboard: {
        speed_round: {
          weekly: patchLeaderboard(state.leaderboard.speed_round.weekly),
          alltime: patchLeaderboard(state.leaderboard.speed_round.alltime),
        },
        word_rain: {
          weekly: patchLeaderboard(state.leaderboard.word_rain.weekly),
          alltime: patchLeaderboard(state.leaderboard.word_rain.alltime),
        },
        memory_match: {
          weekly: patchLeaderboard(state.leaderboard.memory_match.weekly),
          alltime: patchLeaderboard(state.leaderboard.memory_match.alltime),
        },
      },
      leaderboardFetchedAt: {
        speed_round: { weekly: null, alltime: null },
        word_rain: { weekly: null, alltime: null },
        memory_match: { weekly: null, alltime: null },
      },
    };
  });
}

export const useAuthStore = create<AuthState>((set, get) => {
  const extractSessionTokens = (
    session: any
  ): { access_token: string; refresh_token: string } | null => {
    const accessToken = session?.access_token;
    const refreshToken = session?.refresh_token;

    if (!accessToken || !refreshToken) return null;

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  };

  const buildBasicUser = (session: any): User => ({
    id: session.user.id,
    email: session.user.email!,
    display_name: "",
    avatar_url: "",
    is_premium: false,
    premium_override: false,
    leaderboard_visible: true,
    created_at: session.user.created_at,
  });

  const resolvePendingReturningWelcome = async (
    userId: string,
    installId: string | null = null
  ): Promise<PendingReturningWelcome | null> => {
    try {
      const { data, error } = await supabase.rpc("record_interactive_sign_in", {
        p_install_id: installId,
      });

      if (error) {
        console.error("[auth] record_interactive_sign_in failed:", error);
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const signInCount = Number(row?.interactive_sign_in_count);
      const shouldShow = row?.show_returning_welcome === true;

      if (!shouldShow || !Number.isFinite(signInCount)) {
        return null;
      }

      const lastShownCount = await getReturningWelcomeShownCount(userId);
      if (lastShownCount === signInCount) {
        return null;
      }

      return { userId, signInCount };
    } catch (error) {
      console.error("[auth] resolvePendingReturningWelcome failed:", error);
      return null;
    }
  };

  const primeAuthenticatedSession = (session: any) => {
    if (!session?.user) return;

    set((state) => ({
      session,
      profileHydrated:
        state.user && state.user.id === session.user.id ? state.profileHydrated : false,
      user:
        state.user && state.user.id === session.user.id
          ? {
              ...state.user,
              email: session.user.email ?? state.user.email,
              created_at: session.user.created_at ?? state.user.created_at,
            }
          : buildBasicUser(session),
    }));
  };

  const attachRevenueCatListener = () => {
    if (rcListenerRemover) {
      rcListenerRemover();
      rcListenerRemover = null;
    }

    rcListenerRemover = setupCustomerInfoListener((active) => get().setPremiumStatus(active));
  };

  const hydrateAuthenticatedSession = async (session: any) => {
    if (!session?.user) return;

    const hydrationKey = `${session.user.id}:${session.refresh_token ?? session.access_token ?? "session"}`;
    const hydrationVersion = authStateVersion;
    if (lastHydratedSessionKey === hydrationKey) {
      primeAuthenticatedSession(session);
      return;
    }

    if (inFlightHydrationKey === hydrationKey && inFlightHydrationPromise) {
      primeAuthenticatedSession(session);
      await inFlightHydrationPromise;
      return;
    }

    const hydrationPromise = (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      const { active: rcActive, verified: rcVerified } = await logInUser(session.user.id).catch(() => ({
        active: false,
        verified: false,
      }));
      const { premiumOverrideActive, isPremium } = await resolveEffectivePremiumStatus(
        session.user.id,
        profile,
        rcActive,
        rcVerified
      );

      const hydratedUser: User = {
        id: session.user.id,
        email: session.user.email!,
        display_name: profile?.display_name || "",
        avatar_url: profile?.avatar_url || "",
        premium_override: premiumOverrideActive,
        is_premium: isPremium,
        leaderboard_visible: profile?.leaderboard_visible ?? true,
        created_at: session.user.created_at,
      };

      if (hydrationVersion !== authStateVersion) {
        return;
      }

      if (get().session?.user?.id !== session.user.id) {
        return;
      }

      set({
        user: hydratedUser,
        session,
        initialized: true,
        profileHydrated: true,
        isPremiumVerified: rcVerified,
      });

      attachRevenueCatListener();
      lastHydratedSessionKey = hydrationKey;
    })();

    inFlightHydrationKey = hydrationKey;
    inFlightHydrationPromise = hydrationPromise;

    try {
      await hydrationPromise;
    } finally {
      if (inFlightHydrationKey === hydrationKey) {
        inFlightHydrationKey = null;
        inFlightHydrationPromise = null;
      }
    }
  };

  const scheduleHydration = (session: any, source: string) => {
    void hydrateAuthenticatedSession(session).catch((error) => {
      console.error(`[auth] hydration failed from ${source}:`, error);
    });
  };

  const finishInteractiveSignIn = async (
    session: any,
    options?: {
      displayNameOverride?: string | null;
      emailOverride?: string | null;
      installId?: string | null;
    }
  ) => {
    if (!session?.user) {
      throw new Error("Interactive sign-in missing session user");
    }

    const displayNameOverride = options?.displayNameOverride?.trim() || null;

    if (displayNameOverride) {
      await supabase
        .from("profiles")
        .update({ display_name: displayNameOverride })
        .eq("id", session.user.id);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    const { active: rcActive, verified: rcVerified } = await logInUser(session.user.id).catch(
      () => ({ active: false, verified: false })
    );
    const { premiumOverrideActive, isPremium } = await resolveEffectivePremiumStatus(
      session.user.id,
      profile,
      rcActive,
      rcVerified
    );

    const installId = options?.installId ?? (await getInstallId());
    const pendingReturningWelcome = await resolvePendingReturningWelcome(
      session.user.id,
      installId
    );

    const user: User = {
      id: session.user.id,
      email: session.user.email || options?.emailOverride || "",
      display_name: displayNameOverride || profile?.display_name || "",
      avatar_url: profile?.avatar_url || "",
      premium_override: premiumOverrideActive,
      is_premium: isPremium,
      leaderboard_visible: profile?.leaderboard_visible ?? true,
      created_at: session.user.created_at,
    };

    set({
      user,
      session,
      loading: false,
      startupAuthSource: "interactive",
      profileHydrated: true,
      isPremiumVerified: rcVerified,
      pendingReturningWelcome,
    });

    attachRevenueCatListener();
  };

  const clearAuthenticatedState = async (
    reason: "manual_signout" | "delete_account" | "signed_out" | "store_clear"
  ) => {
    authStateVersion += 1;

    if (rcListenerRemover) {
      rcListenerRemover();
      rcListenerRemover = null;
    }

    // Clear user-scoped offline caches before wiping the user reference so we
    // still have the userId available for the key pattern.
    const currentUserId = get().user?.id;
    if (currentUserId) {
      await clearUserCache(currentUserId);
      await clearCachedPremiumGrace(currentUserId);
      // Also clear the offline action queue — queue uses its own prefix so
      // clearUserCache doesn't reach it.
      //
      // This runs on three logout paths:
      //  1. signOut() confirmed — user saw the pending-queue warning and chose
      //     to proceed, so clearing is intentional and expected.
      //  2. deleteAccount() — the account no longer exists server-side; any
      //     queued user-bound writes would fail with FK violations anyway.
      //  3. SIGNED_OUT auth event (JWT expiry / server-side session revoke) —
      //     Phase 1 accepted behaviour: when the session is invalid, queued
      //     writes cannot be synced (they would all fail with 401/403, which
      //     isPermanentError() classifies as permanent → discard). Preserving
      //     the queue indefinitely for an unauthenticated user has no practical
      //     value in Phase 1.
      //     Future phase: if re-auth + queue preservation is required (e.g.
      //     the user re-logs into the same account), handle this path separately
      //     by skipping clearAllItems() here and letting processQueue() drain on
      //     the next successful sign-in.
      await useOfflineQueueStore.getState().clearAllItems();
    }

    clearClientStores();
    set({
      user: null,
      session: null,
      startupAuthSource: "none",
      profileHydrated: true,
      isPremiumVerified: false,
      passwordRecoveryActive: false,
      pendingReturningWelcome: null,
    });

    lastHydratedSessionKey = null;
    inFlightHydrationKey = null;
    inFlightHydrationPromise = null;
    lastCleanupReason = reason;
    lastCleanupAt = Date.now();
    pendingExplicitCleanupReason = null;
    await clearStoredSupabaseSession();
    await AsyncStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    await clearAITrialCache();
  };

  return {
  user: null,
  session: null,
  loading: false,
  initialized: false,
  startupAuthSource: "none",
  profileHydrated: false,
  isPremiumVerified: false,
  passwordRecoveryActive: false,
  pendingReturningWelcome: null,

  setPremiumStatus: (active: boolean) => {
    const { user } = get();
    if (!user) return;
    const wasNotPremium = !user.is_premium;
    // Respect manual override — RC saying false must not revoke an explicit override grant
    const effectivePremium = active || user.premium_override;
    set({ user: { ...user, is_premium: effectivePremium }, isPremiumVerified: true });
    void cachePremiumVerification(user.id, active);
    // Sync upgrade to Supabase via SECURITY DEFINER RPC (only on upgrade, no revoke RPC exists)
    if (active && wasNotPremium) {
      void (async () => { await supabase.rpc("set_premium"); })().catch(() => {});
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        set({ loading: false });
        return { success: false, error: error.message };
      }

      if (data.session?.user) {
        await finishInteractiveSignIn(data.session);
      }

      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: "An unexpected error occurred" };
    }
  },

  signUp: async (email: string, password: string, fullName?: string) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (error) {
        set({ loading: false });
        return { success: false, error: error.message };
      }

      if (data.session?.user) {
        await finishInteractiveSignIn(data.session, {
          displayNameOverride: fullName ?? null,
        });
      } else {
        set({ loading: false, startupAuthSource: "interactive" });
      }
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: "An unexpected error occurred" };
    }
  },

  signInWithApple: async () => {
    if (Platform.OS !== "ios")
      return { success: false, error: "Apple Sign-In is only available on iOS" };
    set({ loading: true });
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        set({ loading: false });
        return { success: false, error: "No identity token received from Apple" };
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      if (error) {
        set({ loading: false });
        return { success: false, error: error.message };
      }

      if (data.session?.user) {
        const displayName = credential.fullName
          ? [credential.fullName.givenName, credential.fullName.familyName]
              .filter(Boolean)
              .join(" ")
          : null;

        await finishInteractiveSignIn(data.session, {
          displayNameOverride: displayName,
          emailOverride: data.user?.email || credential.email || "",
        });
      } else {
        set({ loading: false });
        return { success: false, error: "Could not establish session" };
      }

      return { success: true };
    } catch (error: any) {
      set({ loading: false });
      if (error?.code === "ERR_REQUEST_CANCELED") return { success: false };
      return { success: false, error: error.message ?? "Apple Sign-In failed" };
    }
  },

  signInWithGoogle: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "parlio://auth/callback",
          skipBrowserRedirect: true,
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (error || !data.url) {
        return { success: false, error: error?.message || "Could not get OAuth URL" };
      }

      if (__DEV__) console.log("[auth] google oauth url created");

      const result = await WebBrowser.openAuthSessionAsync(data.url, "parlio://auth/callback");

      if (__DEV__) console.log("[auth] google auth result type:", result.type);

      if (result.type !== "success") {
        return { success: false };
      }

      const callbackResult = await establishSessionFromCallbackUrl(result.url);

      if (__DEV__) {
        console.log("[auth] google callback result:", {
          duplicate: callbackResult.duplicate,
          hasSession: !!callbackResult.session,
          error: callbackResult.error ?? null,
        });
      }

      if (!callbackResult.session) {
        return {
          success: false,
          error: callbackResult.error || "Could not establish session",
        };
      }

      if (__DEV__) console.log("[auth] google sign-in success");
      await finishInteractiveSignIn(callbackResult.session);
      return { success: true };
    } catch (error) {
      if (__DEV__) console.log("[auth] google sign-in error:", error);
      return { success: false, error: "An unexpected error occurred" };
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    // ── Pending queue warning ────────────────────────────────────────────────
    // If there are offline actions waiting to be synced, warn the user before
    // destroying their data. clearAllItems() runs inside clearAuthenticatedState()
    // only after the user confirms they want to proceed.
    const pendingCount =
      useOfflineQueueStore.getState().queue.length +
      useGameStore.getState().pendingScores.length;
    if (pendingCount > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          i18n.t("profile.sign_out_pending_title"),
          i18n.t("profile.sign_out_pending_body", { count: pendingCount }),
          [
            {
              text: i18n.t("common.cancel"),
              style: "cancel",
              onPress: () => resolve(false),
            },
            {
              text: i18n.t("profile.sign_out_anyway"),
              style: "destructive",
              onPress: () => resolve(true),
            },
          ]
        );
      });
      if (!confirmed) return; // User chose to stay
    }

    set({ loading: true });
    try {
      pendingExplicitCleanupReason = "manual_signout";

      // Prefer a server-side sign-out when available, but never trap a user in
      // the app if the network/auth server is unavailable at the exact moment
      // they explicitly asked to leave this device.
      const { error: remoteSignOutError } = await supabase.auth.signOut().catch((error) => ({
        error,
      }));
      if (remoteSignOutError) {
        if (__DEV__) {
          console.log("[auth] remote signout unavailable, continuing with local cleanup");
        }
        await supabase.auth.signOut({ scope: "local" }).catch((error) => {
          if (__DEV__) console.warn("[auth] local signout fallback failed:", error);
        });
      }
      await clearStoredSupabaseSession();
      console.log("[auth] manual_signout_cleanup");
      await clearAuthenticatedState("manual_signout");
      await AsyncStorage.multiRemove(["user_settings", "user_settings:guest"]);
      await logOutUser();
      set({
        loading: false,
      });
    } catch (error) {
      pendingExplicitCleanupReason = null;
      set({ loading: false });
      if (__DEV__) console.error("Sign out error:", error);
    }
  },

  deleteAccount: async () => {
    set({ loading: true });
    try {
      // Refresh session to ensure a fresh, non-expired access token
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        set({ loading: false });
        return { success: false, error: "Session expired. Please sign in again." };
      }

      const { error } = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${refreshData.session.access_token}` },
      });
      if (error) {
        pendingExplicitCleanupReason = null;
        set({ loading: false });
        return { success: false, error: error.message };
      }

      // Edge function deleted the user — clean up locally
      pendingExplicitCleanupReason = "delete_account";
      await supabase.auth.signOut({ scope: "local" }).catch((error) => {
        console.error("[auth] delete_account local signout failed:", error);
      });
      await clearStoredSupabaseSession();
      console.log("[auth] delete_account_cleanup");
      await clearAuthenticatedState("delete_account");
      await AsyncStorage.multiRemove(["user_settings", "user_settings:guest"]);
      await logOutUser();
      set({
        loading: false,
      });
      return { success: true };
    } catch (error: any) {
      pendingExplicitCleanupReason = null;
      set({ loading: false });
      if (__DEV__) console.error("Delete account error:", error);
      return { success: false, error: error.message ?? "An unexpected error occurred" };
    }
  },

  resetPassword: async (email: string) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "parlio://auth/reset-password",
      });

      if (error) {
        set({ loading: false });
        return { success: false, error: error.message };
      }

      set({ loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: "An unexpected error occurred" };
    }
  },

  updateProfile: async (updates: Partial<User>) => {
    const { user } = get();
    if (!user) return { success: false, error: "No user logged in" };

    set({ loading: true });
    try {
      // is_premium is protected by a DB trigger — it can only be changed via
      // the set_premium() RPC (SECURITY DEFINER). Strip it from direct updates
      // so the trigger doesn't reject the request; local state is still synced below.
      const { is_premium: _ignored, ...dbUpdates } = updates;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from("profiles").update(dbUpdates).eq("id", user.id);
        if (error) {
          set({ loading: false });
          return { success: false, error: error.message };
        }
      }

      set({
        user: { ...user, ...updates },
        loading: false,
      });

      syncProfileCaches(user.id, {
        ...(Object.prototype.hasOwnProperty.call(updates, "display_name")
          ? { display_name: updates.display_name }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "avatar_url")
          ? { avatar_url: updates.avatar_url }
          : {}),
      });

      void get().refreshProfile();

      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: "An unexpected error occurred" };
    }
  },

  refreshProfile: async () => {
    const { user, isPremiumVerified } = get();
    if (!user) return { success: false, error: "No user logged in" };

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, is_premium, premium_override, premium_override_expires_at, leaderboard_visible")
        .eq("id", user.id)
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      const premiumOverrideActive = isOverrideActive(profile);
      const graceActive = !isPremiumVerified
        ? await getCachedPremiumGrace(user.id)
        : false;
      const syncedPremium = isPremiumVerified
        ? user.is_premium || premiumOverrideActive
        : user.is_premium ||
          premiumOverrideActive ||
          graceActive ||
          (profile?.is_premium ?? false);

      set((state) => ({
        user: state.user
          ? {
              ...state.user,
              display_name: profile?.display_name || "",
              avatar_url: profile?.avatar_url || "",
              premium_override: premiumOverrideActive,
              is_premium: syncedPremium,
              leaderboard_visible: profile?.leaderboard_visible ?? true,
            }
          : state.user,
      }));

      syncProfileCaches(user.id, {
        display_name: profile?.display_name || "",
        avatar_url: profile?.avatar_url || "",
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? "An unexpected error occurred" };
    }
  },

  uploadAvatar: async (uri: string, base64?: string) => {
    const { user } = get();
    if (!user) return { success: false, error: "No user logged in" };

    try {
      const ext = uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const filePath = `${user.id}/avatar.${ext}`;
      const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

      let uploadData: Blob | Uint8Array;
      if (base64) {
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        uploadData = bytes;
      } else {
        const response = await fetch(uri);
        uploadData = await response.blob();
      }

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, uploadData, { contentType, upsert: true });

      if (uploadError) return { success: false, error: uploadError.message };

      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      const result = await get().updateProfile({ avatar_url: publicUrl });
      if (!result.success) return result;

      return { success: true, url: publicUrl };
    } catch (error: any) {
      if (__DEV__) console.error("[uploadAvatar] exception:", error);
      return { success: false, error: error.message ?? "Upload failed" };
    }
  },

  removeAvatar: async () => {
    const { user } = get();
    if (!user) return { success: false, error: "No user logged in" };
    try {
      const avatarPaths = await resolveAvatarPaths(user.id, user.avatar_url);

      if (avatarPaths.length > 0) {
        const { error: removeError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .remove(avatarPaths);

        if (removeError) {
          return { success: false, error: removeError.message };
        }
      }

      const result = await get().updateProfile({ avatar_url: "" });
      if (!result.success) return result;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? "Remove failed" };
    }
  },

  updateEmail: async (newEmail: string) => {
    try {
      const { user } = get();
      if (!user) return { success: false, error: "No user logged in" };

      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) return { success: false, error: error.message };

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? "Update failed" };
    }
  },

  updatePassword: async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      set({ passwordRecoveryActive: false });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? "Update failed" };
    }
  },

  verifyAndUpdatePassword: async (currentPassword: string, newPassword: string) => {
    const { user } = get();
    if (!user) return { success: false, error: "No user logged in" };
    try {
      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) return { success: false, wrongPassword: true };

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? "Update failed" };
    }
  },

  activatePasswordRecovery: () => set({ passwordRecoveryActive: true }),

  clearPasswordRecovery: () => set({ passwordRecoveryActive: false }),

  consumePendingReturningWelcome: () => set({ pendingReturningWelcome: null }),

  initialize: async () => {
    try {
      // Clean up any previous listener before attaching a new one.
      if (authSubscription) {
        authSubscription.unsubscribe();
        authSubscription = null;
      }

      // Listen for auth changes.
      // IMPORTANT: callback must be synchronous — async callbacks inside
      // onAuthStateChange cause a Supabase internal queue deadlock where
      // setSession never resolves because the async callback holds the lock.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        console.log("AUTH STATE CHANGE EVENT:", event, !!session?.user);
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
          primeAuthenticatedSession(session);
          scheduleHydration(session, event);
        } else if ((event === "USER_UPDATED" || event === "TOKEN_REFRESHED") && session?.user) {
          set((state) => ({
            session,
            user: state.user
              ? {
                  ...state.user,
                  email: session.user.email ?? state.user.email,
                  created_at: session.user.created_at ?? state.user.created_at,
                }
              : state.user,
          }));

          if (!get().user || get().user?.id !== session.user.id) {
            primeAuthenticatedSession(session);
            scheduleHydration(session, event);
          }
        } else if (event === "SIGNED_OUT") {
          void (async () => {
            const explicitCleanupInFlight = pendingExplicitCleanupReason;
            const recentExplicitCleanup =
              (lastCleanupReason === "manual_signout" || lastCleanupReason === "delete_account") &&
              Date.now() - lastCleanupAt < EXPLICIT_CLEANUP_GUARD_MS;

            if (explicitCleanupInFlight || recentExplicitCleanup) {
              console.log(
                `[auth] cleanup_skipped_explicit reason=${explicitCleanupInFlight ?? lastCleanupReason}`
              );
              pendingExplicitCleanupReason = null;
              return;
            }

            try {
              const {
                data: { session: currentSession },
              } = await supabase.auth.getSession();

              if (currentSession?.user) {
                console.log("[auth] cleanup_skipped_recoverable");
                primeAuthenticatedSession(currentSession);
                await hydrateAuthenticatedSession(currentSession);
                return;
              }
            } catch (error) {
              console.error("[auth] post-SIGNED_OUT verification failed:", error);
            }

            console.log("[auth] cleanup_confirmed_signed_out");
            await clearAuthenticatedState("signed_out");
          })();
        }
      });
      authSubscription = subscription;

      const {
        data: { session: currentSession },
        error: currentSessionError,
      } = await supabase.auth.getSession();

      if (currentSessionError) {
        console.error("[auth] getSession during initialize failed:", currentSessionError);
      }

      if (currentSession?.user) {
        console.log("[auth] initialize restored session source=supabase_persisted");
        primeAuthenticatedSession(currentSession);
        // Pre-populate stores from cache so screens have data on first render.
        await hydrateStoresFromCache(currentSession.user.id).catch((e) => {
          console.error("[auth] hydrateStoresFromCache failed:", e);
        });
        set({ initialized: true, startupAuthSource: "restored", profileHydrated: false });
        scheduleHydration(currentSession, "initialize");
        return;
      }

      // Legacy fallback: previous builds stored a manual copy in AsyncStorage.
      // This is migration-only: once the session is restored into Supabase,
      // remove the legacy key immediately so it cannot act as a second source.
      const storedSession = await AsyncStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
      if (storedSession) {
        console.log("[auth] legacy_read");
        try {
          const parsedSession = JSON.parse(storedSession);
          const sessionTokens = extractSessionTokens(parsedSession);

          if (!sessionTokens) {
            console.log("[auth] legacy_removed reason=malformed");
            await AsyncStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
          } else {
            const {
              data: restoredData,
              error: sessionError,
            } = await supabase.auth.setSession(sessionTokens);

            if (sessionError || !restoredData.session?.user) {
              console.log("[auth] legacy_removed reason=stale");
              await AsyncStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
            } else {
              console.log("[auth] legacy_removed reason=migrated");
              await AsyncStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
              console.log("[auth] initialize restored session source=legacy_fallback");
              primeAuthenticatedSession(restoredData.session);
              await hydrateStoresFromCache(restoredData.session.user.id).catch((e) => {
                console.error("[auth] hydrateStoresFromCache (legacy) failed:", e);
              });
              set({ initialized: true, startupAuthSource: "restored", profileHydrated: false });
              scheduleHydration(restoredData.session, "legacy_restore");
              return;
            }
          }
        } catch (error) {
          console.error("[auth] failed to parse legacy session copy:", error);
          console.log("[auth] legacy_removed reason=parse_error");
          await AsyncStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
        }
      }

      set({ initialized: true, startupAuthSource: "none", profileHydrated: true });
    } catch (error) {
      if (__DEV__) console.error("Auth initialization error:", error);
      set({ initialized: true, startupAuthSource: "none", profileHydrated: true });
    }
  },

  clear: () => {
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }
    if (rcListenerRemover) { rcListenerRemover(); rcListenerRemover = null; }
    authStateVersion += 1;
    pendingExplicitCleanupReason = null;
    lastCleanupReason = "store_clear";
    lastCleanupAt = Date.now();
    set({
      user: null,
      session: null,
      loading: false,
      initialized: false,
      startupAuthSource: "none",
      profileHydrated: false,
      isPremiumVerified: false,
      passwordRecoveryActive: false,
      pendingReturningWelcome: null,
    });
  },
  };
});
