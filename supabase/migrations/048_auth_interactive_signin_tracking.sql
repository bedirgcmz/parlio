-- ============================================================
-- Migration 048: Track interactive sign-in history for welcome UX
--
-- Goal:
--   Distinguish passive startup session restore from a real interactive
--   sign-in moment so the app can show "welcome back" only after an actual
--   auth boundary.
--
-- Rules:
--   - First-ever interactive sign-in should NOT show the returning welcome.
--   - Normal app reopen / persisted session restore should NOT increment.
--   - Manual logout -> sign in again SHOULD increment and return show=true.
--   - Real session loss -> sign in again SHOULD increment and return show=true.
--   - New device sign-in SHOULD increment and return show=true.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interactive_sign_in_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interactive_sign_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_interactive_sign_in_install_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_interactive_sign_in_count_nonnegative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_interactive_sign_in_count_nonnegative
      CHECK (interactive_sign_in_count >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_interactive_sign_in(p_install_id text DEFAULT NULL)
RETURNS TABLE (
  interactive_sign_in_count integer,
  show_returning_welcome boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_count integer;
  v_new_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_interactive_sign_in requires an authenticated user';
  END IF;

  UPDATE public.profiles
  SET interactive_sign_in_count = COALESCE(interactive_sign_in_count, 0) + 1,
      last_interactive_sign_in_at = now(),
      last_interactive_sign_in_install_id = p_install_id
  WHERE id = auth.uid()
  RETURNING interactive_sign_in_count - 1, interactive_sign_in_count
  INTO v_previous_count, v_new_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for authenticated user %', auth.uid();
  END IF;

  interactive_sign_in_count := v_new_count;
  show_returning_welcome := v_previous_count >= 1;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_interactive_sign_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_interactive_sign_in(text) TO authenticated;
