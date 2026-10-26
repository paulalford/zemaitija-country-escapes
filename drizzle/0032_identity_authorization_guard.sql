-- Hold the acting administrator identity lock until the sensitive identity command commits.
CREATE OR REPLACE FUNCTION manage_admin_identity(p_session_hash bytea,p_target uuid,p_subject text,p_role text,p_enabled boolean,p_units uuid[],p_operation text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; target uuid; old_row admin_users; prior management_commands; fp text;
BEGIN
  SELECT a.id INTO actor FROM access_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=p_session_hash
    AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-interval '30 minutes'
    AND s.authenticated_at>clock_timestamp()-interval '10 minutes' AND a.enabled AND a.disabled_at IS NULL
    AND a.auth_version=s.admin_version AND a.role='administrator' FOR SHARE OF a;
  IF actor IS NULL THEN RAISE EXCEPTION 'identity administration denied' USING ERRCODE='42501'; END IF;
  IF p_role NOT IN ('operations','finance','administrator') OR length(p_subject)<3 OR length(p_subject)>500
    OR p_operation !~ '^[a-zA-Z0-9:_-]{8,150}$' OR length(trim(p_reason))<3 OR length(p_reason)>500 THEN
    RAISE EXCEPTION 'invalid identity command' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('management:'||p_operation,0));
  fp:=md5(jsonb_build_array(p_target,p_subject,p_role,p_enabled,p_units,p_reason)::text);
  SELECT * INTO prior FROM management_commands WHERE operation_key=p_operation;
  IF FOUND THEN
    IF prior.admin_user_id<>actor OR prior.fingerprint<>fp THEN RAISE EXCEPTION 'identity command conflict' USING ERRCODE='22023'; END IF;
    RETURN (prior.result->>'adminId')::uuid;
  END IF;
  target:=COALESCE(p_target,gen_random_uuid());
  SELECT * INTO old_row FROM admin_users WHERE id=target FOR UPDATE;
  -- A separate administrator must review changes to the acting identity.
  IF target=actor THEN RAISE EXCEPTION 'self privilege changes forbidden' USING ERRCODE='42501'; END IF;
  IF p_target IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='22023'; END IF;
  INSERT INTO admin_users(id,external_subject,role,enabled,disabled_at) VALUES(target,p_subject,p_role,p_enabled,CASE WHEN p_enabled THEN NULL ELSE clock_timestamp() END)
    ON CONFLICT(id) DO UPDATE SET external_subject=EXCLUDED.external_subject,role=EXCLUDED.role,enabled=EXCLUDED.enabled,disabled_at=EXCLUDED.disabled_at;
  DELETE FROM admin_unit_access WHERE admin_user_id=target;
  INSERT INTO admin_unit_access(id,admin_user_id,unit_id) SELECT gen_random_uuid(),target,u FROM unnest(p_units) u;
  UPDATE access_sessions SET revoked_at=clock_timestamp() WHERE admin_user_id=target AND revoked_at IS NULL;
  INSERT INTO management_commands(operation_key,admin_user_id,fingerprint,result) VALUES(p_operation,actor,fp,jsonb_build_object('adminId',target));
  INSERT INTO audit_events(id,actor_kind,admin_user_id,service_name,action,entity_type,entity_id,operation_key,reason_code,occurred_at,details)
    VALUES(gen_random_uuid(),'ADMIN',actor,'identity-management','admin.identity_changed','admin_user',target,p_operation,'EXPLICIT_IDENTITY_REVIEW',clock_timestamp(),
      jsonb_build_object('authorizationRef',(SELECT id FROM access_sessions WHERE token_hash=p_session_hash),'priorRole',old_row.role,'newRole',p_role,'enabled',p_enabled,'reason',p_reason));
  RETURN target;
END $$;
