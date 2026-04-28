import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager,
  useWindowDimensions,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PRIVACY_POLICY_URL = "https://parlio-privacy-terms-page.vercel.app/privacy";
const TERMS_URL = "https://parlio-privacy-terms-page.vercel.app/terms";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import type { PurchasesPackage } from "react-native-purchases";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/store/useAuthStore";
import type { MainStackParamList, PaywallSource } from "@/types";
import {
  getOfferings,
  logInUser,
  purchasePackage,
  restorePurchases,
} from "@/services/revenueCat";
import { useNetworkStore } from "@/store/useNetworkStore";

interface PackageOption {
  pkg: PurchasesPackage;
  label: string;
  badge?: string;
}

const ALL_FEATURES = [
  "feature_ai",
  "feature_dialog",
  "feature_games",
  "feature_unlimited_add",
  "feature_sentences",
  "feature_reading",
  "feature_tts",
  "feature_pdf",
  "feature_quiz",
  "feature_build",
  "feature_categories",
  "feature_auto",
] as const;

type FeatureKey = (typeof ALL_FEATURES)[number];

const PAYWALL_VARIANTS: Record<
  PaywallSource | "generic",
  {
    titleKey: string;
    subtitleKey: string;
    featureKeys: readonly FeatureKey[];
  }
> = {
  generic: {
    titleKey: "premium.paywall_title",
    subtitleKey: "premium.paywall_subtitle",
    featureKeys: ALL_FEATURES,
  },
  sentences: {
    titleKey: "premium.paywall_context_sentences_title",
    subtitleKey: "premium.paywall_context_sentences_subtitle",
    featureKeys: ["feature_unlimited_add", "feature_sentences", "feature_categories", "feature_ai"],
  },
  ai: {
    titleKey: "premium.paywall_context_ai_title",
    subtitleKey: "premium.paywall_context_ai_subtitle",
    featureKeys: ["feature_ai", "feature_sentences", "feature_categories", "feature_dialog"],
  },
  reading: {
    titleKey: "premium.paywall_context_reading_title",
    subtitleKey: "premium.paywall_context_reading_subtitle",
    featureKeys: ["feature_reading", "feature_tts", "feature_pdf", "feature_quiz"],
  },
  quiz: {
    titleKey: "premium.paywall_context_quiz_title",
    subtitleKey: "premium.paywall_context_quiz_subtitle",
    featureKeys: ["feature_quiz", "feature_build", "feature_auto", "feature_sentences"],
  },
  dialog: {
    titleKey: "premium.paywall_context_dialog_title",
    subtitleKey: "premium.paywall_context_dialog_subtitle",
    featureKeys: ["feature_dialog", "feature_ai", "feature_sentences", "feature_quiz"],
  },
  games: {
    titleKey: "premium.paywall_context_games_title",
    subtitleKey: "premium.paywall_context_games_subtitle",
    featureKeys: ["feature_games", "feature_categories", "feature_sentences", "feature_quiz"],
  },
};

const COLLAPSED_COUNT = 4;

export default function PaywallScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainStackParamList, "Paywall">>();
  const setPremiumStatus = useAuthStore((s) => s.setPremiumStatus);
  const { height: windowHeight } = useWindowDimensions();

  const isLargeScreen = windowHeight >= 700;
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [offeringsMessageKey, setOfferingsMessageKey] = useState<
    "premium.offline_note" | "premium.not_configured_note" | "premium.no_packages_note"
  >("premium.offline_note");
  const variant = PAYWALL_VARIANTS[route.params?.source ?? "generic"];
  const featureKeys = React.useMemo(
    () => Array.from(new Set([...variant.featureKeys, ...ALL_FEATURES])),
    [variant.featureKeys],
  );

  useEffect(() => {
    loadOfferings();
  }, []);

  async function ensureRevenueCatReady() {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;

    const result = await logInUser(userId).catch(() => null);
    if (result?.verified) {
      setPremiumStatus(result.active);
    }
  }

  async function loadOfferings() {
    setLoading(true);
    try {
      await ensureRevenueCatReady();
      const result = await getOfferings();
      if (!result.current) {
        setOfferingsMessageKey(
          result.reason === "not_configured" || result.reason === "expo_go"
            ? "premium.not_configured_note"
            : result.reason === "no_current_offering"
              ? "premium.no_packages_note"
              : "premium.offline_note"
        );
        setLoading(false);
        return;
      }
      const opts: PackageOption[] = [];

      // Paketleri belirli sırayla göster
      const monthly = result.current.monthly;
      const annual = result.current.annual;

      if (monthly) opts.push({ pkg: monthly, label: t("premium.pkg_monthly") });
      if (annual) opts.push({ pkg: annual, label: t("premium.pkg_annual"), badge: t("premium.badge_popular") });

      setPackages(opts);
      // Varsayılan seçim: yıllık
      const defaultPkg = annual ?? monthly;
      if (defaultPkg) setSelectedPkg(defaultPkg);
    } catch (e) {
      if (__DEV__) console.error("Offerings load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchase() {
    if (!selectedPkg) {
      // Packages failed to load (offline or misconfigured) — tell the user why
      Alert.alert(t("common.offline_title"), t(offeringsMessageKey));
      return;
    }
    setPurchasing(true);
    try {
      const result = await purchasePackage(selectedPkg);
      if (result.userCancelled) {
        // Kullanıcı vazgeçti, sessizce kapat
      } else if (result.success) {
        setPremiumStatus(true);
        Alert.alert(
          t("premium.success_title"),
          t("premium.success_body"),
          [{ text: t("premium.success_btn"), onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert(t("common.error"), result.error ?? t("premium.error_purchase"));
      }
    } finally {
      setPurchasing(false);
    }
  }

  async function handleRestore() {
    if (useNetworkStore.getState().isOnline === false) {
      Alert.alert(t("common.offline_title"), t("common.offline_body"));
      return;
    }
    setRestoring(true);
    try {
      await ensureRevenueCatReady();
      const result = await restorePurchases();
      if (result.isPremium) {
        setPremiumStatus(true);
        Alert.alert(
          t("premium.restored_title"),
          t("premium.restored_body"),
          [{ text: t("common.ok"), onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert(t("premium.not_found_title"), t("premium.not_found_body"));
      }
    } catch {
      Alert.alert(t("common.error"), t("premium.error_restore"));
    } finally {
      setRestoring(false);
    }
  }

  const s = styles(colors, isLargeScreen);

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.premiumAccent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Kapat butonu */}
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()}>
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>

        {/* Başlık */}
        <LinearGradient
          colors={["#8B5CF6", "#4DA3FF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.badge}
        >
          <Text style={s.badgeTxt}>PREMIUM</Text>
        </LinearGradient>

        <Text style={s.title}>{t(variant.titleKey)}</Text>
        <Text style={s.subtitle}>{t(variant.subtitleKey)}</Text>

        {/* Özellik listesi */}
        <View style={s.featureList}>
          {(showAllFeatures ? featureKeys : featureKeys.slice(0, COLLAPSED_COUNT)).map((key) => (
            <View key={key} style={s.featureRow}>
              <Text style={s.featureCheck}>✓</Text>
              <Text style={s.featureText}>{t(`premium.${key}`)}</Text>
            </View>
          ))}
          {!showAllFeatures && featureKeys.length > COLLAPSED_COUNT && (
            <TouchableOpacity
              style={s.showAllBtn}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowAllFeatures(true);
              }}
              activeOpacity={0.7}
            >
              <Text style={s.showAllTxt}>
                {t("premium.show_all_features", { count: featureKeys.length - COLLAPSED_COUNT })}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Paket seçimi */}
        {packages.length > 0 ? (
          <View style={s.packages}>
            {packages.map(({ pkg, label, badge }) => {
              const isSelected = selectedPkg?.identifier === pkg.identifier;
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[s.packageCard, isSelected && s.packageCardSelected]}
                  onPress={() => setSelectedPkg(pkg)}
                  activeOpacity={0.8}
                >
                  {badge && (
                    <View style={s.packageBadge}>
                      <Text style={s.packageBadgeTxt}>{badge}</Text>
                    </View>
                  )}
                  <Text style={[s.packageLabel, isSelected && s.packageLabelSelected]}>
                    {label}
                  </Text>
                  <Text style={[s.packagePrice, isSelected && s.packagePriceSelected]}>
                    {pkg.product.priceString}
                  </Text>
                  {pkg.product.subscriptionPeriod && (
                    <Text style={s.packagePeriod}>
                      {pkg.packageType === "ANNUAL" ? t("premium.period_annual") : pkg.packageType === "MONTHLY" ? t("premium.period_monthly") : t("premium.period_once")}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={s.offlineNote}>
            <Text style={s.offlineNoteTxt}>{t(offeringsMessageKey)}</Text>
          </View>
        )}

        {/* Satın al butonu */}
        <TouchableOpacity
          style={[s.purchaseBtn, (!selectedPkg || purchasing) && { opacity: 0.4 }]}
          onPress={handlePurchase}
          disabled={purchasing}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={["#8B5CF6", "#4DA3FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.purchaseBtnGradient}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.purchaseBtnTxt}>{t("premium.purchase_btn")}</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Geri yükle */}
        <TouchableOpacity style={s.restoreBtn} onPress={handleRestore} disabled={restoring}>
          {restoring ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={s.restoreTxt}>{t("premium.restore_btn")}</Text>
          )}
        </TouchableOpacity>

        {/* Yasal notlar */}
        <Text style={s.legalTxt}>{t("premium.legal")}</Text>
        <View style={s.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={s.legalLink}>{t("premium.privacy_policy")}</Text>
          </TouchableOpacity>
          <Text style={s.legalLinkDivider}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={s.legalLink}>{t("premium.terms_of_service")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function styles(colors: ReturnType<typeof import("@/providers/ThemeProvider").useTheme>["colors"], isLargeScreen: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      padding: isLargeScreen ? 24 : 16,
      paddingBottom: isLargeScreen ? 40 : 24,
      alignItems: "center",
    },
    closeBtn: {
      alignSelf: "flex-end",
      padding: 8,
    },
    closeTxt: {
      fontSize: 18,
      color: colors.textSecondary,
    },
    badge: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 4,
      marginTop: 2,
      marginBottom: isLargeScreen ? 10 : 6,
    },
    badgeTxt: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 12,
      letterSpacing: 1.5,
    },
    title: {
      fontSize: isLargeScreen ? 30 : 24,
      fontWeight: "800",
      color: colors.textPrimary,
      textAlign: "center",
      lineHeight: isLargeScreen ? 38 : 30,
    },
    subtitle: {
      fontSize: isLargeScreen ? 16 : 14,
      color: colors.textSecondary,
      marginTop: 4,
      marginBottom: isLargeScreen ? 16 : 10,
      textAlign: "center",
    },
    featureList: {
      width: "100%",
      marginBottom: isLargeScreen ? 28 : 14,
    },
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    featureCheck: {
      color: colors.premiumAccent,
      fontSize: 16,
      fontWeight: "700",
      marginRight: 12,
      width: 20,
      textAlign: "center",
    },
    featureText: {
      fontSize: 15,
      color: colors.textPrimary,
      flex: 1,
    },
    packages: {
      flexDirection: "row",
      gap: 10,
      width: "100%",
      marginBottom: isLargeScreen ? 24 : 14,
    },
    packageCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 14,
      alignItems: "center",
      borderWidth: 2,
      borderColor: colors.border,
      position: "relative",
    },
    packageCardSelected: {
      borderColor: colors.premiumAccent,
      backgroundColor: colors.surfaceSecondary,
    },
    packageBadge: {
      position: "absolute",
      top: -10,
      backgroundColor: colors.premiumAccent,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    packageBadgeTxt: {
      color: "#fff",
      fontSize: 9,
      fontWeight: "700",
    },
    packageLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
      marginTop: 8,
    },
    packageLabelSelected: {
      color: colors.premiumAccent,
    },
    packagePrice: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.textPrimary,
      marginTop: 4,
    },
    packagePriceSelected: {
      color: colors.premiumAccent,
    },
    packagePeriod: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 2,
    },
    showAllBtn: {
      marginTop: 4,
      paddingVertical: 4,
      alignSelf: "flex-start",
    },
    showAllTxt: {
      fontSize: 13,
      color: colors.premiumAccent,
      fontWeight: "600",
    },
    offlineNote: {
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 24,
      width: "100%",
    },
    offlineNoteTxt: {
      color: colors.textSecondary,
      textAlign: "center",
      fontSize: 14,
    },
    purchaseBtn: {
      width: "100%",
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: isLargeScreen ? 14 : 8,
    },
    purchaseBtnGradient: {
      paddingVertical: isLargeScreen ? 18 : 14,
      alignItems: "center",
    },
    purchaseBtnTxt: {
      color: "#fff",
      fontSize: 17,
      fontWeight: "700",
    },
    restoreBtn: {
      paddingVertical: isLargeScreen ? 10 : 6,
      marginBottom: isLargeScreen ? 16 : 10,
    },
    restoreTxt: {
      color: colors.textSecondary,
      fontSize: 14,
      textDecorationLine: "underline",
    },
    legalTxt: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 18,
    },
    legalLinks: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 8,
    },
    legalLink: {
      fontSize: 11,
      color: colors.textTertiary,
      textDecorationLine: "underline",
    },
    legalLinkDivider: {
      fontSize: 11,
      color: colors.textTertiary,
    },
  });
}
