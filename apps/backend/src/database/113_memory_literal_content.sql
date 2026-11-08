-- GET-451 exact bounded Memory literals. No legacy text/original/evidence is
-- rewritten or certified retroactively. Existing source/retention/Lab guards,
-- ownership/FKs, Run budgets and the public contract version are unchanged.
-- These integrity checks are not source admission or reference authorization.

DO $migration$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'MEMORY_LITERAL_UTF8_REQUIRED';
  END IF;
END;
$migration$;

CREATE FUNCTION memory_literal_keys_113(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE actual_count bigint; all_allowed boolean;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
    OR cardinality(p_keys) NOT BETWEEN 1 AND 16
    OR octet_length(p_value::text) > 8192 THEN RETURN false; END IF;
  SELECT count(*), bool_and(key = ANY(p_keys))
    INTO actual_count, all_allowed FROM jsonb_object_keys(p_value) AS keys(key);
  RETURN COALESCE(actual_count = cardinality(p_keys) AND all_allowed, false);
END;
$function$;

CREATE FUNCTION memory_literal_hash_113(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE value text;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  value := p_value #>> '{}';
  RETURN COALESCE(octet_length(value) = 64
    AND value COLLATE "C" ~ '^[a-f0-9]{64}$', false);
END;
$function$;

-- PostgreSQL UTF8 char_length counts scalars. Each valid four-byte UTF8
-- leading byte adds one more UTF16 code unit, without a fictitious UTF16
-- server encoding. At most 65536 bytes are inspected, never a transcript.
CREATE FUNCTION memory_literal_descriptor_113(p_text text, p_max_bytes integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE bytes bytea; size integer; scalar_count integer; utf16_count integer; i integer;
BEGIN
  IF p_max_bytes NOT IN (32768, 65536) OR octet_length(p_text) > p_max_bytes THEN RETURN NULL; END IF;
  IF btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = ''
    THEN RETURN NULL; END IF;
  bytes := convert_to(p_text, 'UTF8');
  size := octet_length(bytes);
  IF size < 1 OR size > p_max_bytes THEN RETURN NULL; END IF;
  scalar_count := char_length(p_text);
  utf16_count := scalar_count;
  FOR i IN 0..size - 1 LOOP
    IF get_byte(bytes, i) BETWEEN 240 AND 244 THEN utf16_count := utf16_count + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('sha256', encode(sha256(bytes), 'hex'),
    'utf8_bytes', size, 'utf16_code_units', utf16_count, 'unicode_scalar_count', scalar_count);
END;
$function$;

-- Called with recomputed descriptors, not jsonb::text as tuple serialization.
CREATE FUNCTION memory_literal_descriptor_tuple_113(p_stats jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE key text;
BEGIN
  IF memory_literal_keys_113(p_stats, ARRAY['sha256','utf8_bytes','utf16_code_units','unicode_scalar_count']) IS NOT TRUE
    OR memory_literal_hash_113(p_stats->'sha256') IS NOT TRUE THEN RETURN NULL; END IF;
  FOREACH key IN ARRAY ARRAY['utf8_bytes','utf16_code_units','unicode_scalar_count'] LOOP
    IF jsonb_typeof(p_stats->key) IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
    IF p_stats->key < '1'::jsonb OR p_stats->key > '65536'::jsonb
      OR (p_stats->>key) COLLATE "C" !~ '^[1-9][0-9]{0,4}$' THEN RETURN NULL; END IF;
  END LOOP;
  RETURN '["' || (p_stats->>'sha256') || '",' || (p_stats->>'utf8_bytes') || ','
    || (p_stats->>'utf16_code_units') || ',' || (p_stats->>'unicode_scalar_count') || ']';
END;
$function$;

CREATE FUNCTION memory_literal_range_tuple_113(p_range jsonb, p_revision text, p_excerpt_stats jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE first_unit numeric; last_unit numeric; session_token text; message text;
BEGIN
  IF p_range = 'null'::jsonb THEN RETURN 'null'; END IF;
  IF memory_literal_keys_113(p_range, ARRAY['kind','session_id','message_id','range_version','representation',
    'offset_unit','character_start','character_end','source_revision_hash','source_text_sha256','excerpt_sha256']) IS NOT TRUE
    THEN RETURN NULL; END IF;
  IF p_range->'kind' IS DISTINCT FROM '"message"'::jsonb
    OR p_range->'range_version' IS DISTINCT FROM '1'::jsonb
    OR p_range->'representation' IS DISTINCT FROM '"authored_message_text.v1"'::jsonb
    OR p_range->'offset_unit' IS DISTINCT FROM '"utf16_code_unit"'::jsonb
    OR memory_literal_hash_113(p_range->'source_revision_hash') IS NOT TRUE
    OR memory_literal_hash_113(p_range->'source_text_sha256') IS NOT TRUE
    OR memory_literal_hash_113(p_range->'excerpt_sha256') IS NOT TRUE
    OR p_range->'source_revision_hash' IS DISTINCT FROM to_jsonb(p_revision)
    OR p_range->'excerpt_sha256' IS DISTINCT FROM p_excerpt_stats->'sha256' THEN RETURN NULL; END IF;
  IF p_range->'session_id' = 'null'::jsonb THEN session_token := 'null';
  ELSIF jsonb_typeof(p_range->'session_id') = 'string'
    AND (p_range->>'session_id') COLLATE "C" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    THEN session_token := '"' || (p_range->>'session_id') || '"';
  ELSE RETURN NULL; END IF;
  IF jsonb_typeof(p_range->'message_id') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  message := p_range->>'message_id';
  IF message COLLATE "C" !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN NULL; END IF;
  -- Type branches precede every cast. JSONB numbers are PostgreSQL numeric;
  -- range/integrality checks precede the later bounded bigint conversion.
  IF jsonb_typeof(p_range->'character_start') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_range->'character_end') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  first_unit := (p_range->>'character_start')::numeric;
  last_unit := (p_range->>'character_end')::numeric;
  IF first_unit < 0 OR last_unit <= first_unit OR last_unit > 9007199254740991
    OR trunc(first_unit) <> first_unit OR trunc(last_unit) <> last_unit
    OR to_jsonb(last_unit - first_unit) IS DISTINCT FROM p_excerpt_stats->'utf16_code_units' THEN RETURN NULL; END IF;
  RETURN '["message",' || session_token || ',"' || message || '",1,"authored_message_text.v1","utf16_code_unit",'
    || first_unit::bigint::text || ',' || last_unit::bigint::text || ',"' || p_revision || '","'
    || (p_range->>'source_text_sha256') || '","' || (p_range->>'excerpt_sha256') || '"]';
END;
$function$;

-- This checks internal/row binding only. It cannot prove a current source
-- substring or a locator hash from JSONB's reformatted text; the host source
-- owner still verifies those against the real admitted original.
CREATE FUNCTION memory_literal_bound_range_113(p_manifest jsonb, p_excerpt_stats jsonb, p_locator jsonb,
  p_session uuid, p_message uuid)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE range_token text; kind text;
BEGIN
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object'
    OR octet_length(p_manifest::text) > 8192
    OR memory_literal_hash_113(p_manifest->'source_revision_hash') IS NOT TRUE
    OR memory_literal_hash_113(p_manifest->'source_locator_sha256') IS NOT TRUE
    OR jsonb_typeof(p_locator) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_locator->'kind') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  range_token := memory_literal_range_tuple_113(p_manifest->'message_range',
    p_manifest->>'source_revision_hash', p_excerpt_stats);
  IF range_token IS NULL THEN RETURN NULL; END IF;
  kind := p_locator->>'kind';
  IF kind = 'message' THEN
    IF p_message IS NULL OR range_token = 'null'
      OR p_manifest->'message_range'->'message_id' IS DISTINCT FROM to_jsonb(p_message::text)
      OR p_manifest->'message_range'->'session_id' IS DISTINCT FROM COALESCE(to_jsonb(p_session::text),'null'::jsonb)
      THEN RETURN NULL; END IF;
  ELSIF kind IN ('image_region','document') THEN
    IF range_token <> 'null' THEN RETURN NULL; END IF;
  ELSE RETURN NULL; END IF;
  RETURN range_token;
END;
$function$;

CREATE FUNCTION memory_literal_proposal_113(p_manifest jsonb, p_digest text, p_display text, p_original text,
  p_excerpt text, p_revision text, p_excerpt_hash text, p_locator jsonb, p_session uuid, p_message uuid)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE display_stats jsonb; original_stats jsonb; excerpt_stats jsonb; original_protocol text; range_token text; tuple text;
BEGIN
  IF memory_literal_keys_113(p_manifest, ARRAY['version','original_content_protocol','display_text','original_display_text',
    'source_excerpt','source_revision_hash','source_locator_sha256','message_range']) IS NOT TRUE
    OR p_manifest->'version' IS DISTINCT FROM '"literal-v2"'::jsonb
    OR jsonb_typeof(p_manifest->'original_content_protocol') IS DISTINCT FROM 'string'
    OR p_digest IS NULL OR p_digest COLLATE "C" !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  original_protocol := p_manifest->>'original_content_protocol';
  IF original_protocol NOT IN ('legacy-v1','literal-v2') OR p_original IS NULL THEN RETURN false; END IF;
  display_stats := memory_literal_descriptor_113(p_display,32768);
  original_stats := memory_literal_descriptor_113(p_original,32768);
  excerpt_stats := memory_literal_descriptor_113(p_excerpt,65536);
  IF display_stats IS NULL OR original_stats IS NULL OR excerpt_stats IS NULL
    OR p_manifest->'display_text' IS DISTINCT FROM display_stats
    OR p_manifest->'original_display_text' IS DISTINCT FROM original_stats
    OR p_manifest->'source_excerpt' IS DISTINCT FROM excerpt_stats
    OR p_manifest->'source_revision_hash' IS DISTINCT FROM to_jsonb(p_revision)
    OR p_excerpt_hash IS DISTINCT FROM excerpt_stats->>'sha256' THEN RETURN false; END IF;
  range_token := memory_literal_bound_range_113(p_manifest,excerpt_stats,p_locator,p_session,p_message);
  IF range_token IS NULL THEN RETURN false; END IF;
  tuple := '["literal-v2","' || original_protocol || '",' || memory_literal_descriptor_tuple_113(display_stats)
    || ',' || memory_literal_descriptor_tuple_113(original_stats) || ',' || memory_literal_descriptor_tuple_113(excerpt_stats)
    || ',"' || (p_manifest->>'source_revision_hash') || '","' || (p_manifest->>'source_locator_sha256') || '",' || range_token || ']';
  RETURN COALESCE(p_digest = encode(sha256(convert_to(tuple,'UTF8')),'hex'),false);
END;
$function$;

CREATE FUNCTION memory_literal_evidence_113(p_manifest jsonb, p_digest text, p_excerpt text, p_content_hash text,
  p_locator jsonb, p_session uuid, p_message uuid)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE stats jsonb; range_token text; tuple text;
BEGIN
  IF memory_literal_keys_113(p_manifest, ARRAY['version','excerpt','source_revision_hash','source_locator_sha256','message_range']) IS NOT TRUE
    OR p_manifest->'version' IS DISTINCT FROM '"literal-v2"'::jsonb
    OR p_digest IS NULL OR p_digest COLLATE "C" !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  stats := memory_literal_descriptor_113(p_excerpt,65536);
  IF stats IS NULL OR p_manifest->'excerpt' IS DISTINCT FROM stats
    OR p_content_hash IS DISTINCT FROM stats->>'sha256' THEN RETURN false; END IF;
  range_token := memory_literal_bound_range_113(p_manifest,stats,p_locator,p_session,p_message);
  IF range_token IS NULL THEN RETURN false; END IF;
  tuple := '["memory-evidence-literal-v2",' || memory_literal_descriptor_tuple_113(stats)
    || ',"' || (p_manifest->>'source_revision_hash') || '","' || (p_manifest->>'source_locator_sha256') || '",' || range_token || ']';
  RETURN COALESCE(p_digest = encode(sha256(convert_to(tuple,'UTF8')),'hex'),false);
END;
$function$;

CREATE FUNCTION memory_literal_accepted_113(p_manifest jsonb, p_digest text, p_display text, p_original text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE display_stats jsonb; original_stats jsonb; original_protocol text; original_token text;
  refs jsonb; ref jsonb; evidence_id text; previous_id text; evidence_protocol text; digest_token text;
  ref_tokens text[] := ARRAY[]::text[]; tuple text;
BEGIN
  IF memory_literal_keys_113(p_manifest, ARRAY['version','original_content_protocol','display_text','original_display_text','reviewed_evidence']) IS NOT TRUE
    OR p_manifest->'version' IS DISTINCT FROM '"accepted-memory-literal.v1"'::jsonb
    OR jsonb_typeof(p_manifest->'original_content_protocol') IS DISTINCT FROM 'string'
    OR p_digest IS NULL OR p_digest COLLATE "C" !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  original_protocol := p_manifest->>'original_content_protocol';
  IF original_protocol NOT IN ('legacy-v1','literal-v2') THEN RETURN false; END IF;
  display_stats := memory_literal_descriptor_113(p_display,32768);
  IF display_stats IS NULL OR p_manifest->'display_text' IS DISTINCT FROM display_stats THEN RETURN false; END IF;
  IF p_original IS NULL THEN
    IF original_protocol <> 'legacy-v1' OR p_manifest->'original_display_text' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    original_token := 'null';
  ELSE
    original_stats := memory_literal_descriptor_113(p_original,32768);
    IF original_stats IS NULL OR p_manifest->'original_display_text' IS DISTINCT FROM original_stats THEN RETURN false; END IF;
    original_token := memory_literal_descriptor_tuple_113(original_stats);
  END IF;
  refs := p_manifest->'reviewed_evidence';
  IF jsonb_typeof(refs) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(refs) NOT BETWEEN 1 AND 10 THEN RETURN false; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(refs) AS items(value) LOOP
    IF memory_literal_keys_113(ref,ARRAY['evidence_id','content_protocol','content_version','content_manifest_digest']) IS NOT TRUE
      OR jsonb_typeof(ref->'evidence_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(ref->'content_protocol') IS DISTINCT FROM 'string'
      OR ref->'content_version' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
    evidence_id := ref->>'evidence_id';
    IF evidence_id COLLATE "C" !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR (previous_id IS NOT NULL AND previous_id COLLATE "C" >= evidence_id COLLATE "C") THEN RETURN false; END IF;
    previous_id := evidence_id;
    evidence_protocol := ref->>'content_protocol';
    IF evidence_protocol = 'legacy-v1' THEN
      IF ref->'content_manifest_digest' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
      digest_token := 'null';
    ELSIF evidence_protocol = 'literal-v2' THEN
      IF memory_literal_hash_113(ref->'content_manifest_digest') IS NOT TRUE THEN RETURN false; END IF;
      digest_token := '"' || (ref->>'content_manifest_digest') || '"';
    ELSE RETURN false; END IF;
    ref_tokens := array_append(ref_tokens,'["' || evidence_id || '","' || evidence_protocol || '",1,' || digest_token || ']');
  END LOOP;
  tuple := '["memory-accepted-literal.v1","' || original_protocol || '",' || memory_literal_descriptor_tuple_113(display_stats)
    || ',' || original_token || ',[' || array_to_string(ref_tokens,',') || ']]';
  RETURN COALESCE(p_digest = encode(sha256(convert_to(tuple,'UTF8')),'hex'),false);
END;
$function$;

-- State may accumulate valid edits across requests. Do not turn the host's
-- 256KiB request budget into a smaller durable-row cap or discard other scopes.
-- The finite 200-entry envelope and 32KiB/value are newly enforced for v2;
-- legacy draft object shape/bytes are not tightened or rewritten.
CREATE FUNCTION memory_literal_draft_113(p_edited jsonb, p_decisions jsonb, p_selected uuid[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $function$
DECLARE entry record; entries integer := 0;
BEGIN
  IF jsonb_typeof(p_edited) IS DISTINCT FROM 'object' OR jsonb_typeof(p_decisions) IS DISTINCT FROM 'object'
    OR p_selected IS NULL OR cardinality(p_selected) > 200 THEN RETURN false; END IF;
  IF COALESCE(array_ndims(p_selected),1) <> 1 THEN RETURN false; END IF;
  IF array_position(p_selected,NULL) IS NOT NULL THEN RETURN false; END IF;
  FOR entry IN SELECT key,value FROM jsonb_each(p_edited) LOOP
    entries := entries + 1;
    IF entries > 200 OR entry.key COLLATE "C" !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR jsonb_typeof(entry.value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Empty text is a valid unfinished draft, not an accepted statement.
    IF octet_length(convert_to(entry.value #>> '{}','UTF8')) > 32768 THEN RETURN false; END IF;
  END LOOP;
  entries := 0;
  FOR entry IN SELECT key,value FROM jsonb_each(p_decisions) LOOP
    entries := entries + 1;
    IF entries > 200 OR entry.key COLLATE "C" !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR jsonb_typeof(entry.value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF (entry.value #>> '{}') NOT IN ('accept','keep_old','accept_new','retain_conflict','skip') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$function$;

ALTER TABLE memory_proposal_items
  ADD COLUMN content_protocol text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN content_manifest jsonb,
  ADD COLUMN content_manifest_digest text,
  ADD CONSTRAINT memory_proposal_items_content_protocol_113 CHECK (content_protocol IN ('legacy-v1','literal-v2')),
  ADD CONSTRAINT memory_proposal_items_literal_content_113 CHECK (COALESCE(CASE content_protocol
    WHEN 'legacy-v1' THEN content_manifest IS NULL AND content_manifest_digest IS NULL
    WHEN 'literal-v2' THEN
      (previous_text IS NULL OR octet_length(convert_to(previous_text,'UTF8')) <= 32768)
      AND memory_literal_proposal_113(content_manifest,content_manifest_digest,display_text,original_display_text,
        source_excerpt,source_revision_hash,source_excerpt_hash,locator,source_session_id,source_message_id)
    ELSE false END,false));

ALTER TABLE memory_items
  ADD COLUMN content_protocol text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN content_manifest jsonb,
  ADD COLUMN content_manifest_digest text,
  ADD CONSTRAINT memory_items_content_protocol_113 CHECK (content_protocol IN ('legacy-v1','literal-v2')),
  ADD CONSTRAINT memory_items_literal_content_113 CHECK (COALESCE(CASE content_protocol
    WHEN 'legacy-v1' THEN content_manifest IS NULL AND content_manifest_digest IS NULL
    WHEN 'literal-v2' THEN memory_literal_accepted_113(content_manifest,content_manifest_digest,display_text,original_display_text)
    ELSE false END,false));

ALTER TABLE memory_item_evidence
  ADD COLUMN content_protocol text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN content_manifest jsonb,
  ADD COLUMN content_manifest_digest text,
  ADD CONSTRAINT memory_item_evidence_content_protocol_113 CHECK (content_protocol IN ('legacy-v1','literal-v2')),
  ADD CONSTRAINT memory_item_evidence_content_version_113 CHECK (content_version = 1),
  ADD CONSTRAINT memory_item_evidence_literal_content_113 CHECK (COALESCE(CASE content_protocol
    WHEN 'legacy-v1' THEN content_manifest IS NULL AND content_manifest_digest IS NULL
    WHEN 'literal-v2' THEN memory_literal_evidence_113(content_manifest,content_manifest_digest,excerpt,content_hash,
      locator,source_session_id,source_message_id)
    ELSE false END,false));

ALTER TABLE memory_review_drafts
  ADD COLUMN content_protocol text NOT NULL DEFAULT 'legacy-v1',
  ADD CONSTRAINT memory_review_drafts_content_protocol_113 CHECK (content_protocol IN ('legacy-v1','literal-v2')),
  ADD CONSTRAINT memory_review_drafts_literal_content_113 CHECK (COALESCE(CASE content_protocol
    WHEN 'legacy-v1' THEN true
    WHEN 'literal-v2' THEN memory_literal_draft_113(edited_text,item_decisions,selected_item_ids)
    ELSE false END,false));
