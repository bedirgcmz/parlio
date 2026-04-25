import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

const MODELS = {
  lite: "gemini-2.5-flash-lite:generateContent",
  flash: "gemini-2.5-flash:generateContent",
};

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/";

const LANGUAGE_NAMES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  sv: "Swedish",
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_INSTRUCTION = `You are a translation assistant for language learners.

Rules:
1. Translate naturally using simple, everyday spoken language. Never translate word-for-word.
2. Use common daily expressions (A2-B1 level). Avoid advanced, literary, or rare phrases.
3. Keep grammar simple and vocabulary familiar to learners.
4. If the source sentence contains text wrapped in double asterisks (**word**), you MUST wrap only the equivalent translated expression in ** markers too.
5. Preserve the exact same number of marked segments. Do not remove, merge, split, or add ** markers.
6. Keep each marked segment as short and precise as possible. Mark only the keyword or phrase itself, not the whole sentence, unless the whole sentence is marked in the source.
7. Do not expand a marked segment just because surrounding words are nearby. Keep articles, pronouns, objects, punctuation, and helper words outside the marker unless they are necessary parts of the equivalent expression.
8. Build the most natural full sentence in the target language first. Then place the ** markers around the equivalent expression inside that natural target-language sentence.
9. The marked expression does NOT need to stay in the same position as the source. Natural target-language word order is more important than source order.
10. If a short marked phrase in the source can be translated as a short phrase in the target, the target marker must also stay short.
11. Prefer the phrasing a native speaker would actually say in the target language, even if the sentence order changes.
12. Examples:
   - Swedish: **Jag väntar** på dig. -> Turkish: Seni **bekliyorum**.
   - English: I am **looking for** my keys. -> Turkish: Anahtarlarımı **arıyorum**.
   - English: We will meet **right away**. -> Turkish: **Hemen** buluşacağız.
   - English: I **miss** you. -> Turkish: Seni **özledim**.
13. Always close every ** marker you open. Never leave an unclosed **.
14. Return ONLY the translated sentence. No explanations, no alternatives, no extra text.`;

const TRIAL_DURATION_DAYS = 3;
const DAILY_LIMIT = 15;

function countMarkers(text: string): number {
  return (text.match(/\*\*[^*]+\*\*/g) ?? []).length;
}

function stripMarkers(text: string): string {
  return text.replace(/\*\*/g, "");
}

function extractMarkedSegments(text: string): string[] {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g), (match) => match[1]);
}

function normalizedLength(text: string): number {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").length;
}

function hasOverwideMarkerSpan(sourceText: string, translatedText: string): boolean {
  const sourceSegments = extractMarkedSegments(sourceText);
  const targetSegments = extractMarkedSegments(translatedText);
  if (sourceSegments.length === 0 || sourceSegments.length !== targetSegments.length) return false;

  const sourceTotal = normalizedLength(stripMarkers(sourceText));
  const targetTotal = normalizedLength(stripMarkers(translatedText));
  if (!sourceTotal || !targetTotal) return false;

  return sourceSegments.some((segment, index) => {
    const sourceShare = normalizedLength(segment) / sourceTotal;
    const targetShare = normalizedLength(targetSegments[index]) / targetTotal;

    return sourceShare <= 0.72 && targetShare >= 0.9;
  });
}

function buildPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  sourceText: string,
  expectedMarkers: number,
  strictMarkers = false,
): string {
  if (!strictMarkers) {
    return `Translate from ${sourceLanguage} to ${targetLanguage}:\n${sourceText}`;
  }

  return `Translate from ${sourceLanguage} to ${targetLanguage}.

Important marker reminder:
- The source contains ${expectedMarkers} marked segment(s).
- Keep exactly ${expectedMarkers} marked segment(s) in the translation.
- Each marked segment must be the smallest equivalent phrase.
- First form the most natural target-language sentence.
- Then place the marked phrase inside that natural sentence.
- Do NOT wrap the whole translated sentence in **...** unless the whole source sentence is marked.
- Natural target-language word order matters more than copying source order.

Text:
${sourceText}`;
}

async function callGemini(
  model: "lite" | "flash",
  userPrompt: string
): Promise<string | null> {
  const url = `${GEMINI_BASE}${MODELS[model]}?key=${GEMINI_API_KEY}`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 256,
      topP: 0.9,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Gemini ${model} error:`, err);
    return null;
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
  // ── 1. Identify user from JWT ────────────────────────────────────────────────
  // Gateway verifies the JWT (verify_jwt = true in config).
  // We still need the token to identify the user and query their profile.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── 2. Check premium / trial access ─────────────────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile } = await adminClient
    .from("profiles")
    .select(
      "is_premium, premium_override, premium_override_expires_at, ai_trial_started_at, ai_daily_count, ai_daily_date"
    )
    .eq("id", user.id)
    .single();

  const premiumOverrideActive =
    !!profile?.premium_override &&
    (!profile?.premium_override_expires_at ||
      new Date(profile.premium_override_expires_at).getTime() > Date.now());
  const isPremium = (profile?.is_premium ?? false) || premiumOverrideActive;

  if (!isPremium) {
    const now = new Date();
    let trialStartedAt: Date;

    if (!profile?.ai_trial_started_at) {
      // First use — start the trial server-side
      await adminClient
        .from("profiles")
        .update({ ai_trial_started_at: now.toISOString() })
        .eq("id", user.id);
      trialStartedAt = now;
    } else {
      trialStartedAt = new Date(profile.ai_trial_started_at);
    }

    const diffDays =
      (now.getTime() - trialStartedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays >= TRIAL_DURATION_DAYS) {
      return new Response(
        JSON.stringify({ error: "trial_expired" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Daily limit check ────────────────────────────────────────────────────
    const todayDate = now.toISOString().split("T")[0]; // YYYY-MM-DD (UTC)
    const aiDailyDate = profile?.ai_daily_date as string | null;
    const aiDailyCount = (profile?.ai_daily_count as number) ?? 0;

    let newDailyCount: number;
    if (aiDailyDate !== todayDate) {
      // New day — reset to 1 (this request counts as the first use)
      newDailyCount = 1;
    } else if (aiDailyCount >= DAILY_LIMIT) {
      return new Response(
        JSON.stringify({ error: "daily_limit_reached" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      newDailyCount = aiDailyCount + 1;
    }

    await adminClient
      .from("profiles")
      .update({ ai_daily_count: newDailyCount, ai_daily_date: todayDate })
      .eq("id", user.id);
  }

  // ── 3. Translate ─────────────────────────────────────────────────────────────
  try {
    const { sourceText, sourceLang, targetLang } = await req.json();

    if (!sourceText || !sourceLang || !targetLang) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof sourceText !== "string" || sourceText.length > 500) {
      return new Response(
        JSON.stringify({ error: "sourceText must be 500 characters or fewer" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sourceLanguage = LANGUAGE_NAMES[sourceLang] ?? sourceLang;
    const targetLanguage = LANGUAGE_NAMES[targetLang] ?? targetLang;
    const expectedMarkers = countMarkers(sourceText);

    const userPrompt = buildPrompt(
      sourceLanguage,
      targetLanguage,
      sourceText,
      expectedMarkers,
    );

    let translatedText = await callGemini("lite", userPrompt);
    let usedModel = "lite";

    const liteMarkerCount = translatedText ? countMarkers(translatedText) : -1;
    const markerMismatch = expectedMarkers > 0 && liteMarkerCount !== expectedMarkers;
    const overwideMarkerSpan =
      expectedMarkers > 0 && translatedText
        ? hasOverwideMarkerSpan(sourceText, translatedText)
        : false;

    if (!translatedText || markerMismatch || overwideMarkerSpan) {
      console.warn(
        `Lite fallback triggered. Expected markers: ${expectedMarkers}, got: ${liteMarkerCount}, overwide: ${overwideMarkerSpan}`
      );
      translatedText = await callGemini(
        "flash",
        buildPrompt(sourceLanguage, targetLanguage, sourceText, expectedMarkers, true),
      );
      usedModel = "flash";
    }

    if (!translatedText) {
      return new Response(
        JSON.stringify({ error: "Translation service error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ translatedText, model: usedModel }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[smooth-handler] translate error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  } catch (err) {
    console.error("[smooth-handler] unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
