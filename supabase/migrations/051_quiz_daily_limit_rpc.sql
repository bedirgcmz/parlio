-- ============================================================
-- Migration 051: Server-authoritative quiz/build daily limits
--
-- Goal:
--   Free quiz and build-sentence limits must be decided by the server, not by
--   stale client counts. The client may still use a local snapshot while
--   offline, but every online insert and offline replay goes through the RPC.
-- ============================================================

ALTER TABLE public.quiz_results
  ADD COLUMN IF NOT EXISTS client_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_results_client_event_id
  ON public.quiz_results(user_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_results_daily_limit
  ON public.quiz_results(user_id, quiz_type, answered_at);

DROP FUNCTION IF EXISTS public.get_quiz_daily_limit_status(text);
DROP FUNCTION IF EXISTS public.record_quiz_result_with_limit(integer, integer, boolean, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.record_quiz_result_with_limit(integer, integer, boolean, text, timestamptz, text, timestamptz, timestamptz, date);
DROP FUNCTION IF EXISTS public.record_quiz_result_with_limit(integer, uuid, boolean, text, timestamptz, text, timestamptz, timestamptz, date);

CREATE OR REPLACE FUNCTION public.quiz_limit_daily_limit_for_type(
  p_quiz_type text,
  p_is_premium boolean
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_is_premium THEN 999999
    WHEN p_quiz_type = 'build_sentence' THEN 5
    ELSE 5
  END;
$$;

CREATE OR REPLACE FUNCTION public.quiz_limit_group_match(
  p_row_type text,
  p_requested_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_requested_type = 'build_sentence' THEN p_row_type = 'build_sentence'
    ELSE p_row_type IN ('multiple_choice', 'fill_blank')
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_daily_limit_status(
  p_quiz_type text,
  p_day_start timestamptz DEFAULT NULL,
  p_day_end timestamptz DEFAULT NULL,
  p_limit_date date DEFAULT NULL
)
RETURNS TABLE (
  quiz_type text,
  used_count integer,
  daily_limit integer,
  remaining_count integer,
  limit_reached boolean,
  is_premium boolean,
  server_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_premium boolean;
  v_daily_limit integer;
  v_used_count integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'get_quiz_daily_limit_status requires an authenticated user';
  END IF;

  IF p_quiz_type NOT IN ('multiple_choice', 'fill_blank', 'build_sentence') THEN
    RAISE EXCEPTION 'invalid quiz_type: %', p_quiz_type;
  END IF;

  v_day_start := COALESCE(p_day_start, date_trunc('day', now()));
  v_day_end := COALESCE(p_day_end, v_day_start + interval '1 day');
  SELECT COALESCE(public.is_premium_user(), false) INTO v_is_premium;
  v_daily_limit := public.quiz_limit_daily_limit_for_type(p_quiz_type, v_is_premium);

  SELECT COUNT(*)::integer
  INTO v_used_count
  FROM public.quiz_results AS qr
  WHERE qr.user_id = v_user_id
    AND public.quiz_limit_group_match(qr.quiz_type, p_quiz_type)
    AND qr.answered_at >= v_day_start
    AND qr.answered_at < v_day_end;

  quiz_type := p_quiz_type;
  used_count := v_used_count;
  daily_limit := v_daily_limit;
  remaining_count := GREATEST(v_daily_limit - v_used_count, 0);
  limit_reached := NOT v_is_premium AND v_used_count >= v_daily_limit;
  is_premium := v_is_premium;
  server_date := COALESCE(p_limit_date, v_day_start::date);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_quiz_result_with_limit(
  p_sentence_id integer DEFAULT NULL,
  p_user_sentence_id uuid DEFAULT NULL,
  p_is_correct boolean DEFAULT false,
  p_quiz_type text DEFAULT 'multiple_choice',
  p_answered_at timestamptz DEFAULT now(),
  p_client_event_id text DEFAULT NULL,
  p_day_start timestamptz DEFAULT NULL,
  p_day_end timestamptz DEFAULT NULL,
  p_limit_date date DEFAULT NULL
)
RETURNS TABLE (
  inserted boolean,
  duplicate boolean,
  used_count integer,
  daily_limit integer,
  remaining_count integer,
  limit_reached boolean,
  is_premium boolean,
  server_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_premium boolean;
  v_daily_limit integer;
  v_used_count integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_existing_id integer;
  v_answered_at timestamptz := COALESCE(p_answered_at, now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'record_quiz_result_with_limit requires an authenticated user';
  END IF;

  IF p_quiz_type NOT IN ('multiple_choice', 'fill_blank', 'build_sentence') THEN
    RAISE EXCEPTION 'invalid quiz_type: %', p_quiz_type;
  END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT qr.id
    INTO v_existing_id
    FROM public.quiz_results AS qr
    WHERE qr.user_id = v_user_id
      AND qr.client_event_id = p_client_event_id
    LIMIT 1;

    IF FOUND THEN
      v_day_start := COALESCE(p_day_start, date_trunc('day', v_answered_at));
      v_day_end := COALESCE(p_day_end, v_day_start + interval '1 day');
      SELECT COALESCE(public.is_premium_user(), false) INTO v_is_premium;
      v_daily_limit := public.quiz_limit_daily_limit_for_type(p_quiz_type, v_is_premium);

      SELECT COUNT(*)::integer
      INTO v_used_count
      FROM public.quiz_results AS qr
      WHERE qr.user_id = v_user_id
        AND public.quiz_limit_group_match(qr.quiz_type, p_quiz_type)
        AND qr.answered_at >= v_day_start
        AND qr.answered_at < v_day_end;

      inserted := false;
      duplicate := true;
      used_count := v_used_count;
      daily_limit := v_daily_limit;
      remaining_count := GREATEST(v_daily_limit - v_used_count, 0);
      limit_reached := NOT v_is_premium AND v_used_count >= v_daily_limit;
      is_premium := v_is_premium;
      server_date := COALESCE(p_limit_date, v_day_start::date);
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  v_day_start := COALESCE(p_day_start, date_trunc('day', v_answered_at));
  v_day_end := COALESCE(p_day_end, v_day_start + interval '1 day');
  SELECT COALESCE(public.is_premium_user(), false) INTO v_is_premium;
  v_daily_limit := public.quiz_limit_daily_limit_for_type(p_quiz_type, v_is_premium);

  PERFORM pg_advisory_xact_lock(
    hashtext(
      v_user_id::text || ':' ||
      CASE WHEN p_quiz_type = 'build_sentence' THEN 'build_sentence' ELSE 'quiz' END || ':' ||
      v_day_start::date::text
    ),
    51051
  );

  SELECT COUNT(*)::integer
  INTO v_used_count
  FROM public.quiz_results AS qr
  WHERE qr.user_id = v_user_id
    AND public.quiz_limit_group_match(qr.quiz_type, p_quiz_type)
    AND qr.answered_at >= v_day_start
    AND qr.answered_at < v_day_end;

  IF NOT v_is_premium AND v_used_count >= v_daily_limit THEN
    inserted := false;
    duplicate := false;
    used_count := v_used_count;
    daily_limit := v_daily_limit;
    remaining_count := 0;
    limit_reached := true;
    is_premium := false;
    server_date := COALESCE(p_limit_date, v_day_start::date);
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.quiz_results (
    user_id,
    sentence_id,
    user_sentence_id,
    quiz_type,
    is_correct,
    answered_at,
    client_event_id
  )
  VALUES (
    v_user_id,
    p_sentence_id,
    p_user_sentence_id,
    p_quiz_type,
    p_is_correct,
    v_answered_at,
    p_client_event_id
  );

  v_used_count := v_used_count + 1;

  inserted := true;
  duplicate := false;
  used_count := v_used_count;
  daily_limit := v_daily_limit;
  remaining_count := GREATEST(v_daily_limit - v_used_count, 0);
  limit_reached := NOT v_is_premium AND v_used_count >= v_daily_limit;
  is_premium := v_is_premium;
  server_date := COALESCE(p_limit_date, v_day_start::date);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_direct_quiz_result_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_premium boolean;
  v_daily_limit integer;
  v_used_count integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  -- SECURITY DEFINER RPC writes as the function owner and is already guarded.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'quiz_results insert user_id must match authenticated user';
  END IF;

  IF NEW.quiz_type NOT IN ('multiple_choice', 'fill_blank', 'build_sentence') THEN
    RAISE EXCEPTION 'invalid quiz_type: %', NEW.quiz_type;
  END IF;

  SELECT COALESCE(public.is_premium_user(), false) INTO v_is_premium;
  IF v_is_premium THEN
    RETURN NEW;
  END IF;

  v_day_start := date_trunc('day', COALESCE(NEW.answered_at, now()));
  v_day_end := v_day_start + interval '1 day';
  v_daily_limit := public.quiz_limit_daily_limit_for_type(NEW.quiz_type, false);

  PERFORM pg_advisory_xact_lock(
    hashtext(
      NEW.user_id::text || ':' ||
      CASE WHEN NEW.quiz_type = 'build_sentence' THEN 'build_sentence' ELSE 'quiz' END || ':' ||
      v_day_start::date::text
    ),
    51051
  );

  SELECT COUNT(*)::integer
  INTO v_used_count
  FROM public.quiz_results AS qr
  WHERE qr.user_id = NEW.user_id
    AND public.quiz_limit_group_match(qr.quiz_type, NEW.quiz_type)
    AND qr.answered_at >= v_day_start
    AND qr.answered_at < v_day_end;

  IF v_used_count >= v_daily_limit THEN
    RAISE EXCEPTION 'daily_limit_reached'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_direct_quiz_result_daily_limit ON public.quiz_results;
CREATE TRIGGER trg_guard_direct_quiz_result_daily_limit
  BEFORE INSERT ON public.quiz_results
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_direct_quiz_result_daily_limit();

REVOKE ALL ON FUNCTION public.get_quiz_daily_limit_status(text, timestamptz, timestamptz, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_quiz_daily_limit_status(text, timestamptz, timestamptz, date) FROM anon;
REVOKE ALL ON FUNCTION public.record_quiz_result_with_limit(integer, uuid, boolean, text, timestamptz, text, timestamptz, timestamptz, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_quiz_result_with_limit(integer, uuid, boolean, text, timestamptz, text, timestamptz, timestamptz, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_daily_limit_status(text, timestamptz, timestamptz, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_quiz_result_with_limit(integer, uuid, boolean, text, timestamptz, text, timestamptz, timestamptz, date) TO authenticated;
