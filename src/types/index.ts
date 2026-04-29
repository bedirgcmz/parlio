// Language types
export type SupportedLanguage = "tr" | "en" | "sv" | "de" | "es" | "fr" | "pt";

// Sentence types
export type SentenceStatus = "new" | "learning" | "learned";

export type SentenceCategory =
  | "daily_conversation"
  | "business_english"
  | "phrasal_verbs"
  | "travel"
  | "academic"
  | "idioms"
  | "grammar_patterns"
  | "technology"
  | "health"
  | "social_modern";

export type SentenceDifficulty = "beginner" | "intermediate" | "advanced";

export interface Sentence {
  id: string;
  user_id?: string;
  source_text: string;
  target_text: string;
  keywords: string[];
  category_id?: number;
  category_name?: string;
  status: SentenceStatus;
  is_preset: boolean;
  difficulty?: SentenceDifficulty;
  is_favorite?: boolean;
  is_ai_generated?: boolean;
  source_lang?: SupportedLanguage;
  target_lang?: SupportedLanguage;
  visual_image_url?: string;
  created_at?: string;
  updated_at?: string;
}

// Progress types
export interface UserProgress {
  id: string;
  user_id: string;
  sentence_id: string;
  state: "learning" | "learned";
  learned_at?: string | null;
  created_at: string;
}

export interface StudySession {
  id: string;
  user_id: string;
  sentence_id: string;
  duration_minutes: number;
  completed: boolean;
  created_at: string;
}

export interface QuizResult {
  id: string;
  user_id: string;
  sentence_id: string | null;
  user_sentence_id?: string | null;
  is_correct: boolean;
  quiz_type: "multiple_choice" | "fill_blank" | "build_sentence";
  answered_at: string;
}

// Quiz types
export interface QuizQuestion {
  id: string;
  sentence: Sentence;
  type: "multiple_choice" | "fill_blank";
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string;
  explanation?: string;
}

// Settings types
export interface UserSettings {
  uiLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  theme: "light" | "dark";
  dailyGoal: number;
  notifications: boolean;
  reminderTime: string;
  autoModeSpeed: number;
  showTranslations: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
}

// Navigation types
export type RootStackParamList = {
  Welcome: undefined;
  AuthFlow: undefined;
  Main: undefined;
};

export type PaywallSource =
  | "sentences"
  | "ai"
  | "reading"
  | "quiz"
  | "dialog"
  | "games";

export type HomeStackParamList = {
  HomeMain: undefined;
  Learn: { initialTab?: "study" | "listening" } | undefined;
  Quiz: { initialMode?: "fill_blank" } | undefined;
  Reading: undefined;
  BuildSentence: undefined;
  GameHub: undefined;
  SpeedRound: { filter: import("./game").GameFilter; forceTutorial?: boolean };
  WordRain: { filter: import("./game").GameFilter; forceTutorial?: boolean };
  MemoryMatch: {
    filter: import("./game").GameFilter;
    difficultyFilter?: import("./game").GameDifficultyFilter;
    forceTutorial?: boolean;
  };
  DialogSetup: undefined;
  DialogPlay: undefined;
  DialogComplete: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  AddSentence: undefined;
  EditSentence: { sentenceId: string; isPreset: boolean };
  Settings: undefined;
  Paywall: { source?: PaywallSource } | undefined;
  CategoryBrowser: undefined;
  AutoMode: undefined;
  ChangeEmail: undefined;
  ChangePassword: undefined;
  LearnedSentences: undefined;
  LearningList: undefined;
  FavoriteSentences: undefined;
  Achievements: undefined;
  AITranslator: undefined;
  LearnedDialogs: undefined;
};

export type AuthStackParamList = {
  Auth: undefined;
  ResetPassword: undefined;
  LanguageSelection: undefined;
};

export type TabParamList = {
  Home: undefined;
  Sentences: undefined;
  Me: undefined;
  More: undefined;
};

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Form types
export interface SignInForm {
  email: string;
  password: string;
}

export interface SignUpForm {
  email: string;
  password: string;
  confirmPassword: string;
  fullName?: string;
}

export interface AddSentenceForm {
  source_text: string;
  target_text: string;
  keywords: string[];
  category_id?: number;
}

// Theme types
export interface ThemeColors {
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  cardBackground: string;
  text: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  accent: string;
  statusLearning: string;
  statusNew: string;
  statusUnlearned: string;
  premiumAccent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  borderLight: string;
  divider: string;
  surface: string;
  surfaceSecondary: string;
  keyword: string;
  keywordBg: string;
}

// Reading Text types
export interface ReadingTextKeyword {
  id: string;
  reading_text_id: string;
  position_index: number;
  color_index: number;
  keyword_tr: string | null;
  keyword_en: string | null;
  keyword_sv: string | null;
  keyword_de: string | null;
  keyword_es: string | null;
  keyword_fr: string | null;
  keyword_pt: string | null;
}

export interface ReadingText {
  id: string;
  slug: string;
  category: string;
  difficulty: 1 | 2 | 3;
  is_premium: boolean;
  order_index: number;
  estimated_reading_seconds: number | null;
  title_tr: string | null;
  title_en: string | null;
  title_sv: string | null;
  title_de: string | null;
  title_es: string | null;
  title_fr: string | null;
  title_pt: string | null;
  body_tr: string | null;
  body_en: string | null;
  body_sv: string | null;
  body_de: string | null;
  body_es: string | null;
  body_fr: string | null;
  body_pt: string | null;
  keywords?: ReadingTextKeyword[];
  created_at: string;
}

export interface UserReadingProgress {
  id: string;
  user_id: string;
  reading_text_id: string;
  status: "read" | "learned" | "completed" | "assigned";
  completed_at: string | null;
  shown_at: string | null;
}

export interface CompletedReadingEntry {
  progress: UserReadingProgress;
  text: ReadingText;
}

// Dialog types
export type DialogDifficulty = 1 | 2 | 3; // 1=easy, 2=medium, 3=hard

export type DialogQaStatus =
  | "draft"
  | "review_pending"
  | "approved"
  | "rejected"
  | "needs_revision";

export type DialogSessionStatus = "in_progress" | "completed" | "abandoned";

export type DialogProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "assigned";

export interface DialogCategory {
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
}

export interface DialogScenario {
  id: string;
  category_id: string;
  slug: string;
  difficulty: DialogDifficulty;
  is_premium: boolean;
  is_active: boolean;
  order_index: number;
  estimated_seconds: number | null;
  turn_count: number;
  character_name: string;
  character_role: string;
  qa_status: DialogQaStatus;
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
}

export interface DialogTurn {
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
  options?: DialogTurnOption[];
}

export interface DialogTurnOption {
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
}

export interface UserDialogProgress {
  id: string;
  user_id: string;
  scenario_id: string;
  status: DialogProgressStatus;
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
  is_learned: boolean;
  learned_at: string | null;
  created_at: string;
}

export interface UserDialogSession {
  id: string;
  user_id: string;
  scenario_id: string;
  status: DialogSessionStatus;
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
}

export interface UserDialogTurnAttempt {
  id: string;
  session_id: string;
  user_id: string;
  scenario_id: string;
  turn_id: string;
  selected_option_id: string;
  is_correct: boolean;
  attempt_order: number;
  answered_at: string;
}

// Dialog limit constants
export const DIALOG_LIMIT_FREE_DAILY = 1;
export const DIALOG_LIMIT_FREE_TOTAL = 7;
export const DIALOG_LIMIT_PREMIUM_DAILY = 3;

// Legacy types (for backward compatibility)
export type SentenceState = SentenceStatus;

export interface PillSegment {
  text: string;
  isPill: boolean;
  pillIndex: number | null;
}

export interface Category {
  id: number;
  name_tr: string;
  name_en: string;
  name_sv: string;
  name_de: string;
  name_es: string;
  name_fr: string;
  name_pt: string;
  icon: string;
  sort_order: number;
  is_free: boolean;
}
