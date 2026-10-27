-- Public demo acceptance needs a synthetic guest, but the runtime must not gain
-- general guest INSERT/UPDATE privileges or accept personal information.
CREATE FUNCTION create_public_synthetic_guest(p_id uuid, p_locale text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_id IS NULL OR p_locale IS NULL OR p_locale NOT IN ('lt','en','de') THEN
    RAISE EXCEPTION 'invalid synthetic guest' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.guests(id,email_ciphertext,preferred_locale,retention_state)
    VALUES(p_id,convert_to('synthetic-portfolio-only','UTF8'),p_locale,'SYNTHETIC')
    ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.guests WHERE id=p_id AND retention_state='SYNTHETIC'
    AND email_ciphertext=convert_to('synthetic-portfolio-only','UTF8') AND preferred_locale=p_locale) THEN
    RAISE EXCEPTION 'synthetic guest conflict' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION create_public_synthetic_guest(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION create_public_synthetic_guest(uuid,text) TO zemaitija_app;
