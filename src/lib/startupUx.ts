import AsyncStorage from "@react-native-async-storage/async-storage";

const RETURNING_WELCOME_SHOWN_COUNT_KEY_PREFIX = "returning_welcome_shown_count";

function getReturningWelcomeShownCountKey(userId: string) {
  return `${RETURNING_WELCOME_SHOWN_COUNT_KEY_PREFIX}:${userId}`;
}

export async function getReturningWelcomeShownCount(userId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(getReturningWelcomeShownCountKey(userId));
    if (!raw) return null;

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setReturningWelcomeShownCount(
  userId: string,
  signInCount: number
): Promise<void> {
  await AsyncStorage.setItem(
    getReturningWelcomeShownCountKey(userId),
    String(signInCount)
  ).catch(() => {});
}
