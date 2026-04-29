import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Supabase configuration
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[Supabase] CRITICAL: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. " +
      "Auth and data features will not work. Check your EAS secrets or .env file.",
  );
}

function getSupabaseAuthStorageKey(url: string): string | null {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function clearStoredSupabaseSession(): Promise<void> {
  const authStorageKey = getSupabaseAuthStorageKey(supabaseUrl);
  if (!authStorageKey) return;
  await AsyncStorage.removeItem(authStorageKey).catch(() => {});
}

// Database types (you can generate these from your Supabase schema)
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          is_premium: boolean;
          interactive_sign_in_count: number;
          last_interactive_sign_in_at: string | null;
          last_interactive_sign_in_install_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_premium?: boolean;
          interactive_sign_in_count?: number;
          last_interactive_sign_in_at?: string | null;
          last_interactive_sign_in_install_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_premium?: boolean;
          interactive_sign_in_count?: number;
          last_interactive_sign_in_at?: string | null;
          last_interactive_sign_in_install_id?: string | null;
        };
      };
      sentences: {
        Row: {
          id: string;
          user_id: string | null;
          source_text: string;
          target_text: string;
          keywords: string[];
          category: string;
          status: "new" | "learning" | "learned";
          is_preset: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          source_text: string;
          target_text: string;
          keywords?: string[];
          category?: string;
          status?: "new" | "learning" | "learned";
          is_preset?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          source_text?: string;
          target_text?: string;
          keywords?: string[];
          category?: string;
          status?: "new" | "learning" | "learned";
          is_preset?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_progress: {
        Row: {
          id: number;
          user_id: string;
          sentence_id: number;
          state: "learning" | "learned";
          learned_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          sentence_id: number;
          state?: "learning" | "learned";
          learned_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          sentence_id?: number;
          state?: "learning" | "learned";
          learned_at?: string | null;
          created_at?: string;
        };
      };
      study_sessions: {
        Row: {
          id: string;
          user_id: string;
          sentence_id: string;
          duration_minutes: number;
          completed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          sentence_id: string;
          duration_minutes?: number;
          completed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          sentence_id?: string;
          duration_minutes?: number;
          completed?: boolean;
          created_at?: string;
        };
      };
      quiz_results: {
        Row: {
          id: number;
          user_id: string;
          sentence_id: string | null;
          user_sentence_id: string | null;
          is_correct: boolean;
          quiz_type: "multiple_choice" | "fill_blank" | "build_sentence";
          answered_at: string;
          client_event_id: string | null;
        };
        Insert: {
          id?: number;
          user_id: string;
          sentence_id?: string | null;
          user_sentence_id?: string | null;
          is_correct: boolean;
          quiz_type: "multiple_choice" | "fill_blank" | "build_sentence";
          answered_at?: string;
          client_event_id?: string | null;
        };
        Update: {
          id?: number;
          user_id?: string;
          sentence_id?: string | null;
          user_sentence_id?: string | null;
          is_correct?: boolean;
          quiz_type?: "multiple_choice" | "fill_blank" | "build_sentence";
          answered_at?: string;
          client_event_id?: string | null;
        };
      };
      dialog_categories: {
        Row: {
          id: string;
          slug: string;
          title_tr: string;
          title_en: string;
          title_sv: string;
          title_de: string;
          title_es: string;
          title_fr: string;
          title_pt: string;
          description_tr: string | null;
          description_en: string | null;
          description_sv: string | null;
          description_de: string | null;
          description_es: string | null;
          description_fr: string | null;
          description_pt: string | null;
          icon: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title_tr: string;
          title_en: string;
          title_sv: string;
          title_de: string;
          title_es: string;
          title_fr: string;
          title_pt: string;
          description_tr?: string | null;
          description_en?: string | null;
          description_sv?: string | null;
          description_de?: string | null;
          description_es?: string | null;
          description_fr?: string | null;
          description_pt?: string | null;
          icon?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          title_tr?: string;
          title_en?: string;
          title_sv?: string;
          title_de?: string;
          title_es?: string;
          title_fr?: string;
          title_pt?: string;
          description_tr?: string | null;
          description_en?: string | null;
          description_sv?: string | null;
          description_de?: string | null;
          description_es?: string | null;
          description_fr?: string | null;
          description_pt?: string | null;
          icon?: string | null;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      dialog_scenarios: {
        Row: {
          id: string;
          category_id: string;
          slug: string;
          difficulty: 1 | 2 | 3;
          is_premium: boolean;
          is_active: boolean;
          order_index: number;
          estimated_seconds: number | null;
          turn_count: number;
          character_name: string;
          character_role: string;
          qa_status: "draft" | "review_pending" | "approved" | "rejected" | "needs_revision";
          content_version: number;
          title_tr: string;
          title_en: string;
          title_sv: string;
          title_de: string;
          title_es: string;
          title_fr: string;
          title_pt: string;
          summary_tr: string | null;
          summary_en: string | null;
          summary_sv: string | null;
          summary_de: string | null;
          summary_es: string | null;
          summary_fr: string | null;
          summary_pt: string | null;
          user_goal_tr: string | null;
          user_goal_en: string | null;
          user_goal_sv: string | null;
          user_goal_de: string | null;
          user_goal_es: string | null;
          user_goal_fr: string | null;
          user_goal_pt: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          slug: string;
          difficulty: 1 | 2 | 3;
          is_premium?: boolean;
          is_active?: boolean;
          order_index?: number;
          estimated_seconds?: number | null;
          turn_count: number;
          character_name: string;
          character_role: string;
          qa_status?: "draft" | "review_pending" | "approved" | "rejected" | "needs_revision";
          content_version?: number;
          title_tr: string;
          title_en: string;
          title_sv: string;
          title_de: string;
          title_es: string;
          title_fr: string;
          title_pt: string;
          summary_tr?: string | null;
          summary_en?: string | null;
          summary_sv?: string | null;
          summary_de?: string | null;
          summary_es?: string | null;
          summary_fr?: string | null;
          summary_pt?: string | null;
          user_goal_tr?: string | null;
          user_goal_en?: string | null;
          user_goal_sv?: string | null;
          user_goal_de?: string | null;
          user_goal_es?: string | null;
          user_goal_fr?: string | null;
          user_goal_pt?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          slug?: string;
          difficulty?: 1 | 2 | 3;
          is_premium?: boolean;
          is_active?: boolean;
          order_index?: number;
          estimated_seconds?: number | null;
          turn_count?: number;
          character_name?: string;
          character_role?: string;
          qa_status?: "draft" | "review_pending" | "approved" | "rejected" | "needs_revision";
          content_version?: number;
          title_tr?: string;
          title_en?: string;
          title_sv?: string;
          title_de?: string;
          title_es?: string;
          title_fr?: string;
          title_pt?: string;
          summary_tr?: string | null;
          summary_en?: string | null;
          summary_sv?: string | null;
          summary_de?: string | null;
          summary_es?: string | null;
          summary_fr?: string | null;
          summary_pt?: string | null;
          user_goal_tr?: string | null;
          user_goal_en?: string | null;
          user_goal_sv?: string | null;
          user_goal_de?: string | null;
          user_goal_es?: string | null;
          user_goal_fr?: string | null;
          user_goal_pt?: string | null;
          updated_at?: string;
        };
      };
      dialog_turns: {
        Row: {
          id: string;
          scenario_id: string;
          turn_index: number;
          speaker_type: "character" | "system";
          prompt_type: string | null;
          grammar_focus: string | null;
          vocabulary_focus: string | null;
          message_tr: string;
          message_en: string;
          message_sv: string;
          message_de: string;
          message_es: string;
          message_fr: string;
          message_pt: string;
          hint_tr: string | null;
          hint_en: string | null;
          hint_sv: string | null;
          hint_de: string | null;
          hint_es: string | null;
          hint_fr: string | null;
          hint_pt: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          scenario_id: string;
          turn_index: number;
          speaker_type?: "character" | "system";
          prompt_type?: string | null;
          grammar_focus?: string | null;
          vocabulary_focus?: string | null;
          message_tr: string;
          message_en: string;
          message_sv: string;
          message_de: string;
          message_es: string;
          message_fr: string;
          message_pt: string;
          hint_tr?: string | null;
          hint_en?: string | null;
          hint_sv?: string | null;
          hint_de?: string | null;
          hint_es?: string | null;
          hint_fr?: string | null;
          hint_pt?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          scenario_id?: string;
          turn_index?: number;
          speaker_type?: "character" | "system";
          prompt_type?: string | null;
          grammar_focus?: string | null;
          vocabulary_focus?: string | null;
          message_tr?: string;
          message_en?: string;
          message_sv?: string;
          message_de?: string;
          message_es?: string;
          message_fr?: string;
          message_pt?: string;
          hint_tr?: string | null;
          hint_en?: string | null;
          hint_sv?: string | null;
          hint_de?: string | null;
          hint_es?: string | null;
          hint_fr?: string | null;
          hint_pt?: string | null;
          updated_at?: string;
        };
      };
      dialog_turn_options: {
        Row: {
          id: string;
          turn_id: string;
          option_index: number;
          is_correct: boolean;
          distractor_type: string | null;
          rationale_tr: string | null;
          rationale_en: string | null;
          rationale_sv: string | null;
          rationale_de: string | null;
          rationale_es: string | null;
          rationale_fr: string | null;
          rationale_pt: string | null;
          text_tr: string;
          text_en: string;
          text_sv: string;
          text_de: string;
          text_es: string;
          text_fr: string;
          text_pt: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          turn_id: string;
          option_index: number;
          is_correct?: boolean;
          distractor_type?: string | null;
          rationale_tr?: string | null;
          rationale_en?: string | null;
          rationale_sv?: string | null;
          rationale_de?: string | null;
          rationale_es?: string | null;
          rationale_fr?: string | null;
          rationale_pt?: string | null;
          text_tr: string;
          text_en: string;
          text_sv: string;
          text_de: string;
          text_es: string;
          text_fr: string;
          text_pt: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          turn_id?: string;
          option_index?: number;
          is_correct?: boolean;
          distractor_type?: string | null;
          rationale_tr?: string | null;
          rationale_en?: string | null;
          rationale_sv?: string | null;
          rationale_de?: string | null;
          rationale_es?: string | null;
          rationale_fr?: string | null;
          rationale_pt?: string | null;
          text_tr?: string;
          text_en?: string;
          text_sv?: string;
          text_de?: string;
          text_es?: string;
          text_fr?: string;
          text_pt?: string;
          updated_at?: string;
        };
      };
      user_dialog_progress: {
        Row: {
          id: string;
          user_id: string;
          scenario_id: string;
          status: "not_started" | "in_progress" | "completed" | "assigned";
          shown_at: string | null;
          completed_at: string | null;
          total_sessions: number;
          total_completed_sessions: number;
          best_score: number | null;
          last_score: number | null;
          total_correct_answers: number;
          total_wrong_answers: number;
          best_first_try_accuracy: number | null;
          last_played_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario_id: string;
          status?: "not_started" | "in_progress" | "completed" | "assigned";
          shown_at?: string | null;
          completed_at?: string | null;
          total_sessions?: number;
          total_completed_sessions?: number;
          best_score?: number | null;
          last_score?: number | null;
          total_correct_answers?: number;
          total_wrong_answers?: number;
          best_first_try_accuracy?: number | null;
          last_played_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scenario_id?: string;
          status?: "not_started" | "in_progress" | "completed" | "assigned";
          shown_at?: string | null;
          completed_at?: string | null;
          total_sessions?: number;
          total_completed_sessions?: number;
          best_score?: number | null;
          last_score?: number | null;
          total_correct_answers?: number;
          total_wrong_answers?: number;
          best_first_try_accuracy?: number | null;
          last_played_at?: string | null;
        };
      };
      user_dialog_sessions: {
        Row: {
          id: string;
          user_id: string;
          scenario_id: string;
          status: "in_progress" | "completed" | "abandoned";
          started_at: string;
          completed_at: string | null;
          total_turns: number;
          answered_turns: number;
          correct_on_first_try_count: number;
          wrong_attempt_count: number;
          final_score: number | null;
          duration_seconds: number | null;
          content_version: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario_id: string;
          status?: "in_progress" | "completed" | "abandoned";
          started_at?: string;
          completed_at?: string | null;
          total_turns: number;
          answered_turns?: number;
          correct_on_first_try_count?: number;
          wrong_attempt_count?: number;
          final_score?: number | null;
          duration_seconds?: number | null;
          content_version?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scenario_id?: string;
          status?: "in_progress" | "completed" | "abandoned";
          started_at?: string;
          completed_at?: string | null;
          total_turns?: number;
          answered_turns?: number;
          correct_on_first_try_count?: number;
          wrong_attempt_count?: number;
          final_score?: number | null;
          duration_seconds?: number | null;
          content_version?: number | null;
        };
      };
      user_dialog_turn_attempts: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          scenario_id: string;
          turn_id: string;
          selected_option_id: string;
          is_correct: boolean;
          attempt_order: number;
          answered_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          scenario_id: string;
          turn_id: string;
          selected_option_id: string;
          is_correct: boolean;
          attempt_order: number;
          answered_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string;
          scenario_id?: string;
          turn_id?: string;
          selected_option_id?: string;
          is_correct?: boolean;
          attempt_order?: number;
          answered_at?: string;
        };
      };
      user_settings: {
        Row: {
          id: string;
          user_id: string;
          ui_language: string;
          target_language: string;
          theme: "light" | "dark";
          daily_goal: number;
          notifications: boolean;
          reminder_time: string;
          auto_mode_speed: number;
          show_translations: boolean;
          tts_enabled: boolean;
          tts_voice: string;
          achievement_unlocked_ids: string[];
          achievement_unlocked_dates: Record<string, string>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          ui_language?: string;
          target_language?: string;
          theme?: "light" | "dark";
          daily_goal?: number;
          notifications?: boolean;
          reminder_time?: string;
          auto_mode_speed?: number;
          show_translations?: boolean;
          tts_enabled?: boolean;
          tts_voice?: string;
          achievement_unlocked_ids?: string[];
          achievement_unlocked_dates?: Record<string, string>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          ui_language?: string;
          target_language?: string;
          theme?: "light" | "dark";
          daily_goal?: number;
          notifications?: boolean;
          reminder_time?: string;
          auto_mode_speed?: number;
          show_translations?: boolean;
          tts_enabled?: boolean;
          tts_voice?: string;
          achievement_unlocked_ids?: string[];
          achievement_unlocked_dates?: Record<string, string>;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};
