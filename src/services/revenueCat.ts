import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
  LOG_LEVEL,
} from "react-native-purchases";
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Expo Go'da RevenueCat native store yoktur
const isExpoGo = Constants.executionEnvironment === "storeClient";

const API_KEYS = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "",
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "",
};

// RevenueCat'te tanımladığın entitlement adı
export const ENTITLEMENT_PREMIUM = "premium";
const PREMIUM_GRACE_MS = 72 * 60 * 60 * 1000;
const PREMIUM_GRACE_KEY_PREFIX = "@parlio/premium_grace_v1";

// Offering içindeki package identifier'lar (RevenueCat dashboard'da tanımlanır)
export const PACKAGE_IDS = {
  monthly: "$rc_monthly",
  annual: "$rc_annual",
} as const;

export type PackageType = keyof typeof PACKAGE_IDS;
export type OfferingsLoadResult = {
  current: PurchasesOffering | null;
  reason: "ok" | "expo_go" | "not_configured" | "no_current_offering" | "error";
  error?: string;
};

type PremiumGraceRecord = {
  active: boolean;
  verifiedAt: number;
};

function premiumGraceKey(userId: string) {
  return `${PREMIUM_GRACE_KEY_PREFIX}:${userId}`;
}

export async function cachePremiumVerification(
  userId: string,
  active: boolean
): Promise<void> {
  try {
    if (!active) {
      await AsyncStorage.removeItem(premiumGraceKey(userId));
      return;
    }

    const record: PremiumGraceRecord = {
      active: true,
      verifiedAt: Date.now(),
    };
    await AsyncStorage.setItem(premiumGraceKey(userId), JSON.stringify(record));
  } catch {
    // Non-fatal: premium access will still be resolved from live RC/profile data.
  }
}

export async function getCachedPremiumGrace(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(premiumGraceKey(userId));
    if (!raw) return false;

    const record = JSON.parse(raw) as Partial<PremiumGraceRecord>;
    if (!record.active || typeof record.verifiedAt !== "number") {
      await AsyncStorage.removeItem(premiumGraceKey(userId)).catch(() => {});
      return false;
    }

    const isFresh = Date.now() - record.verifiedAt <= PREMIUM_GRACE_MS;
    if (!isFresh) {
      await AsyncStorage.removeItem(premiumGraceKey(userId)).catch(() => {});
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function clearCachedPremiumGrace(userId: string): Promise<void> {
  await AsyncStorage.removeItem(premiumGraceKey(userId)).catch(() => {});
}

export async function initRevenueCat(userId?: string): Promise<void> {
  if (isExpoGo) return;
  if (await Purchases.isConfigured()) return;

  const apiKey = Platform.OS === "ios" ? API_KEYS.ios : API_KEYS.android;

  if (__DEV__) {
    await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  await Purchases.configure({ apiKey });

  if (userId) {
    await Purchases.logIn(userId);
  }
}

/**
 * Ensures RevenueCat is configured with the given userId, then logs in.
 * Returns the premium status from the CustomerInfo returned by logIn() directly
 * — avoids a second getCustomerInfo() call that could return stale cache.
 *
 * Identity lifecycle:
 *   - If RC not yet configured: configure with userId immediately (no anonymous phase).
 *   - If RC already configured (e.g. after logOut which reverts to anonymous):
 *     logIn() transfers the anonymous context to the identified user.
 *   - App.tsx no longer calls initRevenueCat() — RC is first configured here,
 *     only once a real userId is known, eliminating anonymous customer creation.
 */
export async function logInUser(userId: string): Promise<PremiumCheckResult> {
  if (isExpoGo) return { active: false, verified: false };

  if (!(await Purchases.isConfigured())) {
    const apiKey = Platform.OS === "ios" ? API_KEYS.ios : API_KEYS.android;
    if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: userId });
  }

  const { customerInfo } = await Purchases.logIn(userId);
  const active = customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
  await cachePremiumVerification(userId, active);
  return { active, verified: true };
}

export async function logOutUser(): Promise<void> {
  if (isExpoGo) return;
  if (!(await Purchases.isConfigured())) return;

  try {
    await Purchases.logOut();
  } catch (error) {
    const err = asRCError(error);
    const message = err.message?.toLowerCase() ?? "";
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    const isOffline =
      code === "35" ||
      message.includes("offline") ||
      message.includes("internet connection") ||
      message.includes("network");

    if (__DEV__ && !isOffline) {
      console.warn("[revenueCat] logout sync failed:", error);
    }
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (isExpoGo) return null;
  if (!(await Purchases.isConfigured())) return null;
  return Purchases.getCustomerInfo();
}

export type PremiumCheckResult = { active: boolean; verified: boolean };

/**
 * Returns { active, verified }.
 * verified=false means RC was unavailable (Expo Go, not configured, or threw) —
 * callers should fall back to the Supabase value in that case.
 * verified=true means RC answered authoritatively (active may be true or false).
 */
export async function isPremiumActive(): Promise<PremiumCheckResult> {
  if (isExpoGo) return { active: false, verified: false };
  const info = await getCustomerInfo();
  if (!info) return { active: false, verified: false };
  const active = info.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
  return { active, verified: true };
}

/**
 * Subscribes to real-time CustomerInfo updates from RevenueCat.
 * Returns a cleanup function — call it on sign-out or store teardown.
 */
export function setupCustomerInfoListener(
  cb: (active: boolean) => void
): () => void {
  if (isExpoGo) return () => {};
  const listener = (info: CustomerInfo) => {
    const active = info.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
    cb(active);
  };
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export async function getOfferings(): Promise<OfferingsLoadResult> {
  if (isExpoGo) return { current: null, reason: "expo_go" };
  if (!(await Purchases.isConfigured())) {
    return { current: null, reason: "not_configured" };
  }

  try {
    const offerings = await Purchases.getOfferings();
    if (!offerings.current) {
      return { current: null, reason: "no_current_offering" };
    }

    return { current: offerings.current, reason: "ok" };
  } catch (e: unknown) {
    const err = asRCError(e);
    return {
      current: null,
      reason: "error",
      error: err.message ?? "Offerings load failed",
    };
  }
}

// RevenueCat errors are plain objects with optional typed fields.
function asRCError(e: unknown): { userCancelled?: boolean; message?: string } {
  if (typeof e === "object" && e !== null)
    return e as { userCancelled?: boolean; message?: string };
  return {};
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
  userCancelled?: boolean;
}> {
  if (isExpoGo) return { success: false, error: "Not available in Expo Go" };
  if (!(await Purchases.isConfigured()))
    return { success: false, error: "RevenueCat not configured" };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const premium = customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
    return { success: premium, customerInfo };
  } catch (e: unknown) {
    const err = asRCError(e);
    if (err.userCancelled) {
      return { success: false, userCancelled: true };
    }
    return { success: false, error: err.message ?? "Purchase failed" };
  }
}

export async function restorePurchases(): Promise<{
  success: boolean;
  isPremium: boolean;
  error?: string;
}> {
  if (isExpoGo) return { success: false, isPremium: false, error: "Not available in Expo Go" };
  if (!(await Purchases.isConfigured()))
    return { success: false, isPremium: false, error: "RevenueCat not configured" };
  try {
    const customerInfo = await Purchases.restorePurchases();
    const isPremium = customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
    return { success: true, isPremium };
  } catch (e: unknown) {
    const err = asRCError(e);
    return { success: false, isPremium: false, error: err.message ?? "Restore failed" };
  }
}
