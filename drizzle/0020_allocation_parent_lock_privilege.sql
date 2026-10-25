-- Allocation budget serialization must lock both parents until commit. The runtime
-- role can INSERT allocations but intentionally has no UPDATE privilege on either
-- financial parent, which SELECT FOR UPDATE requires. Keep the trigger and its
-- lock order; confine the elevated privilege to this existing trigger function.
CREATE OR REPLACE FUNCTION public.lock_allocation_parents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user NOT IN ('zemaitija_app','zemaitija_migrator') OR
     TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'payment_allocations' OR
     TG_OP NOT IN ('INSERT','UPDATE','DELETE') THEN
    RAISE EXCEPTION 'allocation parent lock is not authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.payment_obligations
    WHERE id IN (CASE WHEN TG_OP='INSERT' THEN NEW.obligation_id ELSE OLD.obligation_id END,
                 CASE WHEN TG_OP='DELETE' THEN OLD.obligation_id ELSE NEW.obligation_id END)
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payment_records
    WHERE id IN (CASE WHEN TG_OP='INSERT' THEN NEW.payment_record_id ELSE OLD.payment_record_id END,
                 CASE WHEN TG_OP='DELETE' THEN OLD.payment_record_id ELSE NEW.payment_record_id END)
    ORDER BY id FOR UPDATE;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_allocation_parents() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lock_allocation_parents() TO zemaitija_app;
