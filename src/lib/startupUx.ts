import AsyncStorage from "@react-native-async-storage/async-storage";

export const WELCOME_BACK_TOAST_SESSION_KEY = "welcome_back_toast_session_key";
export const REMEMBERED_SHELL_SESSION_KEY = "remembered_shell_session_key";

export async function clearRememberedStartupUxState(): Promise<void> {
  await AsyncStorage.multiRemove([
    WELCOME_BACK_TOAST_SESSION_KEY,
    REMEMBERED_SHELL_SESSION_KEY,
  ]).catch(() => {});
}
