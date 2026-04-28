import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENTITLEMENT_PREMIUM = "premium";

// RevenueCat event types that grant premium access
const ACTIVATE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "REFUND_REVERSED",
]);

// RevenueCat event types that revoke premium access
const DEACTIVATE_EVENTS = new Set([
  "EXPIRATION",
]);

// All other event types (CANCELLATION, BILLING_ISSUE, etc.) are ignored —
// CANCELLATION can mean "won't renew" or "refunded"; without a live RevenueCat
// subscriber lookup, EXPIRATION is the authoritative revoke event.

type RevenueCatWebhookPayload = {
  event?: {
    type?: string;
    app_user_id?: string;
    entitlement_id?: string | null;
    entitlement_ids?: string[] | null;
    transferred_from?: string[] | null;
    transferred_to?: string[] | null;
  };
};

type RevenueCatSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null } | undefined>;
  };
};

type LivePremiumStatusResult =
  | { status: "unconfigured" }
  | { status: "ok"; isPremium: boolean }
  | { status: "error"; message: string };

function isAuthorized(authHeader: string | null, webhookSecret: string): boolean {
  const value = authHeader?.trim();
  return value === webhookSecret || value === `Bearer ${webhookSecret}`;
}

function hasPremiumEntitlement(event: NonNullable<RevenueCatWebhookPayload["event"]>): boolean {
  return (
    event.entitlement_id === ENTITLEMENT_PREMIUM ||
    event.entitlement_ids?.includes(ENTITLEMENT_PREMIUM) === true
  );
}

function isLiveEntitlementActive(entitlement?: { expires_date?: string | null }): boolean {
  if (!entitlement) return false;
  if (!entitlement.expires_date) return true;

  const expiresAt = Date.parse(entitlement.expires_date);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function fetchLivePremiumStatus(appUserId: string): Promise<LivePremiumStatusResult> {
  const apiKey = Deno.env.get("REVENUECAT_REST_API_KEY")?.trim();
  if (!apiKey) return { status: "unconfigured" };

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      status: "error",
      message: `RevenueCat subscriber lookup failed: ${response.status} ${body}`.trim(),
    };
  }

  const payload = (await response.json()) as RevenueCatSubscriberResponse;
  const entitlement = payload.subscriber?.entitlements?.[ENTITLEMENT_PREMIUM];
  return { status: "ok", isPremium: isLiveEntitlementActive(entitlement) };
}

serve(async (req) => {
  // RevenueCat calls this endpoint directly (server-to-server).
  // No CORS headers needed — this is not called from a browser.

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── 1. Verify webhook secret ────────────────────────────────────────────
  const webhookSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[rc-webhook] REVENUECAT_WEBHOOK_SECRET is not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!isAuthorized(authHeader, webhookSecret)) {
    console.warn("[rc-webhook] Unauthorized request — bad or missing secret");
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────
  let payload: RevenueCatWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = payload.event;
  const eventType = event?.type;
  const appUserId = event?.app_user_id;

  console.log(`[rc-webhook] event=${eventType} user=${appUserId}`);

  if (!event || !eventType) {
    return new Response("Missing event.type", { status: 400 });
  }

  if (eventType === "TEST") {
    return new Response("OK", { status: 200 });
  }

  if (eventType === "TRANSFER") {
    console.log(
      `[rc-webhook] ignoring transfer event from=${event.transferred_from?.join(",") ?? ""} to=${event.transferred_to?.join(",") ?? ""}`
    );
    return new Response("OK", { status: 200 });
  }

  if (!appUserId) {
    return new Response("Missing event.app_user_id", { status: 400 });
  }

  if (!hasPremiumEntitlement(event)) {
    console.log(`[rc-webhook] ignoring non-premium entitlement event: ${eventType}`);
    return new Response("OK", { status: 200 });
  }

  // ── 3. Determine action ──────────────────────────────────────────────────
  let newIsPremium: boolean | null = null;
  const livePremiumStatus = await fetchLivePremiumStatus(appUserId);

  if (livePremiumStatus.status === "ok") {
    newIsPremium = livePremiumStatus.isPremium;
  } else if (livePremiumStatus.status === "error") {
    console.error(`[rc-webhook] ${livePremiumStatus.message}`);
    return new Response("RevenueCat lookup error", { status: 500 });
  } else if (ACTIVATE_EVENTS.has(eventType)) {
    newIsPremium = true;
  } else if (DEACTIVATE_EVENTS.has(eventType)) {
    newIsPremium = false;
  } else {
    // Unknown or intentionally ignored event — acknowledge without DB write
    console.log(`[rc-webhook] ignoring event type: ${eventType}`);
    return new Response("OK", { status: 200 });
  }

  // ── 4. Update database (service_role bypasses RLS and the guard trigger) ─
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: updatedProfile, error } = await adminClient
    .from("profiles")
    .update({ is_premium: newIsPremium })
    .eq("id", appUserId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[rc-webhook] DB update failed for user ${appUserId}:`, error.message);
    // Return 500 so RevenueCat retries the webhook
    return new Response("Database error", { status: 500 });
  }

  if (!updatedProfile) {
    console.error(`[rc-webhook] profile not found for RevenueCat app_user_id=${appUserId}`);
    return new Response("Profile not found", { status: 404 });
  }

  console.log(`[rc-webhook] set is_premium=${newIsPremium} for user ${appUserId}`);
  return new Response("OK", { status: 200 });
});
