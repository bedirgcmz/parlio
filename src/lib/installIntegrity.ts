import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { clearStoredSupabaseSession, supabase } from "@/lib/supabase";

const INSTALL_ID_ASYNC_KEY = "@parlio/install_id_v1";
const INSTALL_ID_SECURE_KEY = "parlio.install_id_v1";

const APP_KEY_PREFIXES = [
  "sb-",
  "user_settings:",
  "offline_cache:",
  "offline_queue:",
  "returning_welcome_shown_count:",
  "@parlio/",
  "@ai_trial_",
];

const APP_KEY_EXACT = new Set([
  INSTALL_ID_ASYNC_KEY,
  "supabase_session",
  "user_settings",
  "user_settings:guest",
  "@language",
  "@audio_settings_v1",
]);

type InstallIdReadResult = {
  value: string | null;
  status: "value" | "missing" | "error";
};

function generateInstallId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function writeInstallId(installId: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(INSTALL_ID_ASYNC_KEY, installId),
    SecureStore.setItemAsync(INSTALL_ID_SECURE_KEY, installId),
  ]);
}

async function clearAppStorage(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const appKeys = allKeys.filter(
      (key) =>
        APP_KEY_EXACT.has(key) ||
        APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );

    if (appKeys.length > 0) {
      await AsyncStorage.multiRemove(appKeys);
    }
  } catch {
    // Non-fatal: integrity recovery should still continue
  }
}

async function resetUntrustedInstallationState(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  await clearStoredSupabaseSession();
  await clearAppStorage();
  await SecureStore.deleteItemAsync(INSTALL_ID_SECURE_KEY).catch(() => {});
}

async function readAsyncInstallId(): Promise<InstallIdReadResult> {
  try {
    const value = await AsyncStorage.getItem(INSTALL_ID_ASYNC_KEY);
    return {
      value,
      status: value ? "value" : "missing",
    };
  } catch {
    return {
      value: null,
      status: "error",
    };
  }
}

async function readSecureInstallId(): Promise<InstallIdReadResult> {
  try {
    const value = await SecureStore.getItemAsync(INSTALL_ID_SECURE_KEY);
    return {
      value,
      status: value ? "value" : "missing",
    };
  } catch {
    return {
      value: null,
      status: "error",
    };
  }
}

export async function getInstallId(): Promise<string> {
  const asyncInstallId = await readAsyncInstallId();
  if (asyncInstallId.value) return asyncInstallId.value;

  const secureInstallId = await readSecureInstallId();
  if (secureInstallId.value) {
    await AsyncStorage.setItem(INSTALL_ID_ASYNC_KEY, secureInstallId.value).catch(() => {});
    return secureInstallId.value;
  }

  const installId = generateInstallId();
  await writeInstallId(installId);
  return installId;
}

export async function ensureInstallIntegrity(): Promise<{
  installId: string;
  resetPerformed: boolean;
}> {
  const [asyncInstallId, secureInstallId] = await Promise.all([
    readAsyncInstallId(),
    readSecureInstallId(),
  ]);

  if (asyncInstallId.value && secureInstallId.value && asyncInstallId.value === secureInstallId.value) {
    return { installId: asyncInstallId.value, resetPerformed: false };
  }

  const readErrored =
    asyncInstallId.status === "error" || secureInstallId.status === "error";

  if (readErrored) {
    const existingInstallId = asyncInstallId.value ?? secureInstallId.value;
    if (existingInstallId) {
      await writeInstallId(existingInstallId).catch(() => {});
      return { installId: existingInstallId, resetPerformed: false };
    }

    const installId = generateInstallId();
    await writeInstallId(installId).catch(() => {});
    return { installId, resetPerformed: false };
  }

  if (asyncInstallId.status === "missing" && secureInstallId.status === "missing") {
    const installId = generateInstallId();
    await writeInstallId(installId);
    return { installId, resetPerformed: false };
  }

  await resetUntrustedInstallationState();

  const installId = generateInstallId();
  await writeInstallId(installId);
  return { installId, resetPerformed: true };
}
