-- Stage 2B-2 source only; execution requires separate Stage 2B-3 approval.
ALTER TABLE public.payment_attempts
  ADD COLUMN recovery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN recovery_next_attempt_at timestamptz,
  ADD COLUMN recovery_lease_owner text,
  ADD COLUMN recovery_lease_until timestamptz,
  ADD COLUMN recovery_lease_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN recovery_failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.payment_attempts ADD CONSTRAINT payment_recovery_metadata_valid CHECK (
  recovery_lease_generation >= 0 AND recovery_failure_count >= 0
  AND (recovery_lease_owner IS NULL) = (recovery_lease_until IS NULL)
  AND (recovery_lease_owner IS NULL OR (
    recovery_lease_owner ~ '^[A-Za-z0-9:_-]{8,100}$'
    AND recovery_lease_generation > 0
    AND recovery_next_attempt_at IS NOT NULL
    AND isfinite(recovery_lease_until)
  ))
  AND (recovery_next_attempt_at IS NULL OR isfinite(recovery_next_attempt_at))
  AND (recovery_enabled OR (
    recovery_next_attempt_at IS NULL AND recovery_lease_owner IS NULL
    AND recovery_lease_until IS NULL AND recovery_lease_generation = 0
    AND recovery_failure_count = 0
  ))
  AND (NOT recovery_enabled OR recovery_next_attempt_at IS NOT NULL OR state = 'SUCCEEDED')
);
--> statement-breakpoint
CREATE INDEX payment_attempts_recovery_due ON public.payment_attempts
  (recovery_next_attempt_at, id)
  WHERE recovery_enabled AND recovery_next_attempt_at IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.guard_payment_recovery_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.recovery_lease_owner IS NOT NULL OR NEW.recovery_lease_until IS NOT NULL
      OR NEW.recovery_lease_generation <> 0 OR NEW.recovery_failure_count <> 0
      OR (NEW.recovery_enabled AND NEW.state <> 'CREATING') THEN
      RAISE EXCEPTION 'new recovery metadata must be pristine' USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Enrollment is creation-only. Ordinary lifecycle updates cannot enroll history.
    IF NEW.recovery_enabled IS DISTINCT FROM OLD.recovery_enabled
      OR NEW.recovery_lease_generation < OLD.recovery_lease_generation THEN
      RAISE EXCEPTION 'recovery enrollment or generation cannot regress or be replaced'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_payment_recovery_metadata() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER payment_recovery_metadata_guard BEFORE INSERT OR UPDATE
  ON public.payment_attempts FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_recovery_metadata();
--> statement-breakpoint
CREATE FUNCTION public.check_new_payment_recovery_enrollment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE eligible boolean;
BEGIN
  -- Deferred: the entire new-booking transaction is visible, including its snapshot.
  -- This trigger is INSERT-only, so migration/ordinary updates never enroll old rows.
  SELECT EXISTS (
    SELECT 1 FROM public.price_snapshots s
      JOIN public.payment_obligations o ON o.booking_id = s.booking_id
    WHERE s.booking_id = NEW.booking_id AND o.id = NEW.obligation_id
      AND o.kind IN ('INITIAL', 'BALANCE')
  ) INTO eligible;
  IF NEW.recovery_enabled IS DISTINCT FROM eligible THEN
    RAISE EXCEPTION 'new accepted payment attempt requires atomic recovery enrollment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_new_payment_recovery_enrollment() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER new_payment_recovery_enrollment AFTER INSERT
  ON public.payment_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.check_new_payment_recovery_enrollment();
--> statement-breakpoint
-- Table-wide UPDATE would automatically cover the new scheduling columns.
-- Preserve UPDATE on every pre-0035 column, including legacy identity columns;
-- existing identity/evidence/financial triggers continue to govern those writes.
REVOKE UPDATE ON public.payment_attempts FROM zemaitija_app;
--> statement-breakpoint
GRANT UPDATE (
  id, booking_id, obligation_id, hold_id, state, expected_cents, currency,
  stripe_session_id, stripe_payment_intent_id, checkout_url,
  session_created_at, session_expires_at, last_reconciliation_id, version, created_at
) ON public.payment_attempts TO zemaitija_app;
--> statement-breakpoint
CREATE FUNCTION public.claim_payment_recovery(
  p_lane text, p_worker text, p_limit integer
) RETURNS TABLE (
  attempt_id uuid, generation bigint, lease_until timestamptz, failure_count integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE instant timestamptz := clock_timestamp();
BEGIN
  IF p_lane IS NULL OR p_lane NOT IN ('INITIAL', 'BALANCE')
    OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'invalid recovery claim parameters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT a.id FROM public.payment_attempts a
      JOIN public.payment_obligations o
        ON o.id = a.obligation_id AND o.booking_id = a.booking_id AND o.kind = p_lane
      JOIN public.price_snapshots s ON s.booking_id = a.booking_id
      JOIN public.provider_commands pc
        ON pc.payment_attempt_id = a.id AND pc.kind = 'SESSION_CREATE'
    WHERE a.recovery_enabled AND a.recovery_next_attempt_at <= instant
      AND (a.recovery_lease_until IS NULL OR a.recovery_lease_until <= instant)
      AND ((p_lane = 'INITIAL' AND a.hold_id IS NOT NULL)
        OR (p_lane = 'BALANCE' AND a.hold_id IS NULL))
      AND a.state IN ('CREATING', 'OPEN', 'RECONCILING', 'EXPIRED', 'FAILED', 'SUCCEEDED')
      -- A completed attempt is eligible only for metadata cleanup after a crash or webhook.
      AND (a.state = 'SUCCEEDED' OR (
        pc.state IN ('PENDING', 'SUBMITTED', 'UNKNOWN', 'RESOLVED')
        AND (pc.lease_expires_at IS NULL OR pc.lease_expires_at <= instant)
      ))
    ORDER BY a.recovery_next_attempt_at, a.id
    LIMIT p_limit FOR UPDATE OF a SKIP LOCKED
  )
  UPDATE public.payment_attempts a SET
    recovery_lease_owner = p_worker,
    recovery_lease_until = instant + interval '2 minutes',
    recovery_lease_generation = a.recovery_lease_generation + 1
  FROM due WHERE a.id = due.id
  RETURNING a.id, a.recovery_lease_generation, a.recovery_lease_until, a.recovery_failure_count;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_payment_recovery(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_payment_recovery(text, text, integer) TO zemaitija_app;
--> statement-breakpoint
CREATE FUNCTION public.finish_payment_recovery(
  p_attempt uuid, p_worker text, p_generation bigint, p_outcome text, p_delay_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed integer;
BEGIN
  IF p_attempt IS NULL OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR p_generation IS NULL OR p_generation < 1
    OR p_outcome IS NULL OR p_outcome NOT IN ('RETRY', 'POLL', 'COMPLETE')
    OR (p_outcome = 'COMPLETE' AND p_delay_seconds IS NOT NULL)
    OR (p_outcome <> 'COMPLETE' AND (
      p_delay_seconds IS NULL OR p_delay_seconds < 30 OR p_delay_seconds > 86400
    )) THEN
    RAISE EXCEPTION 'invalid recovery completion parameters' USING ERRCODE = '22023';
  END IF;
  -- Lock first, then evaluate expiry, including time spent waiting for this lock.
  -- A WHERE timestamp evaluated before a lock wait alone is not a sufficient fence.
  PERFORM 1 FROM public.payment_attempts a WHERE a.id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Metadata-only UPDATE: never supplies or modifies financial/inventory evidence.
  UPDATE public.payment_attempts a SET
    recovery_next_attempt_at = CASE WHEN p_outcome = 'COMPLETE' THEN NULL
      ELSE clock_timestamp() + p_delay_seconds * interval '1 second' END,
    recovery_lease_owner = NULL,
    recovery_lease_until = NULL,
    recovery_failure_count = CASE WHEN p_outcome = 'RETRY' THEN
      LEAST(a.recovery_failure_count::bigint + 1, 2147483647)::integer ELSE 0 END
  WHERE a.id = p_attempt AND a.recovery_enabled
    AND a.recovery_lease_owner = p_worker AND a.recovery_lease_generation = p_generation
    AND a.recovery_lease_until > clock_timestamp()
    AND (p_outcome <> 'COMPLETE' OR a.state = 'SUCCEEDED');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_payment_recovery(uuid, text, bigint, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_payment_recovery(uuid, text, bigint, text, integer)
  TO zemaitija_app;
