-- No existing research is modified. Upstream checkpoint tables must exist first.
CREATE TABLE retention_previews (
    id uuid PRIMARY KEY,
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE retention_receipts (
    preview_id uuid PRIMARY KEY REFERENCES retention_previews(id),
    document jsonb NOT NULL,
    applied_at timestamptz NOT NULL
);
CREATE TABLE retention_run_tombstones (
    run_id uuid PRIMARY KEY,
    preview_id uuid NOT NULL REFERENCES retention_previews(id),
    deleted_at timestamptz NOT NULL
);
CREATE TABLE retention_artifact_tombstones (
    artifact_id text PRIMARY KEY,
    preview_id uuid NOT NULL REFERENCES retention_previews(id),
    deleted_at timestamptz NOT NULL
);
CREATE TRIGGER retention_preview_immutable BEFORE UPDATE OR DELETE ON retention_previews
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER retention_receipt_immutable BEFORE UPDATE OR DELETE ON retention_receipts
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER retention_run_tombstone_immutable BEFORE UPDATE OR DELETE ON retention_run_tombstones
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Walk typed keys through objects and arrays; never interpret arbitrary UUID prose.
CREATE FUNCTION retention_run_refs(document jsonb) RETURNS SETOF uuid
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    WITH RECURSIVE walk(key, value) AS (
        SELECT ''::text, document
        UNION ALL
        SELECT child.key, child.value FROM walk
        CROSS JOIN LATERAL (
            SELECT * FROM jsonb_each(
                CASE WHEN jsonb_typeof(walk.value) = 'object' THEN walk.value ELSE '{}'::jsonb END)
            UNION ALL
            SELECT '', element FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(walk.value) = 'array' THEN walk.value ELSE '[]'::jsonb END
            ) AS element
        ) AS child
    )
    SELECT DISTINCT (value #>> '{}')::uuid FROM walk
    WHERE key IN ('run_id', 'thread_id') AND jsonb_typeof(value) = 'string'
      AND value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
CREATE FUNCTION retention_artifact_refs(document text) RETURNS SETOF text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT DISTINCT match[1] FROM regexp_matches(document, 'sha256:[a-f0-9]{64}', 'g') AS match;
$$;

CREATE FUNCTION retention_writer_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- A transaction snapshot from before cleanup cannot see its new tombstones.
    -- Ordinary application writes are READ COMMITTED; backup snapshots are read-only.
    IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
        RAISE EXCEPTION 'Research writes require READ COMMITTED for retention checks.'
            USING ERRCODE = '25001';
    END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('retention:' || TG_TABLE_SCHEMA, 0));
    RETURN NULL;
END;
$$;

CREATE FUNCTION retention_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    document jsonb := to_jsonb(NEW);
    content_text text := '';
    blocked boolean;
    own_artifact text := '';
BEGIN
    IF TG_TABLE_NAME = 'runs' THEN
        document := document || jsonb_build_object('run_id', NEW.id);
    ELSIF TG_TABLE_NAME = 'artifact_blobs' THEN
        own_artifact := NEW.id;
        document := document - 'id' - 'content';
        content_text := encode(NEW.content, 'escape');
    ELSIF TG_TABLE_NAME IN ('checkpoint_blobs', 'checkpoint_writes') THEN
        document := document - 'blob';
        content_text := encode(NEW.blob, 'escape');
    END IF;
    EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I.retention_run_tombstones t
         JOIN %I.retention_run_refs($1) r ON t.run_id = r)', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
        INTO blocked USING document;
    IF blocked THEN
        RAISE EXCEPTION 'Referenced run was deleted. Refresh before continuing.'
            USING ERRCODE = 'RC001';
    END IF;
    EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I.retention_artifact_tombstones t
         JOIN %I.retention_artifact_refs($1) r ON t.artifact_id = r
         WHERE t.artifact_id <> $2)', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
        INTO blocked USING document::text || coalesce(content_text, ''), own_artifact;
    IF blocked THEN
        RAISE EXCEPTION 'Referenced original was deleted. Capture it again before continuing.'
            USING ERRCODE = 'RC002';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION retention_original_recreated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('DELETE FROM %I.retention_artifact_tombstones WHERE artifact_id = $1',
                   TG_TABLE_SCHEMA) USING NEW.id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER retention_original_recreated AFTER INSERT ON artifact_blobs
    FOR EACH ROW EXECUTE FUNCTION retention_original_recreated();

-- Keep updates forbidden; deletion needs an exact, transaction-local schema/ID list.
CREATE OR REPLACE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    permission jsonb := nullif(current_setting('researchchain.retention_deletions', true), '')::jsonb;
    old_row jsonb := to_jsonb(OLD);
BEGIN
    IF TG_OP = 'DELETE' AND permission->>'schema' = TG_TABLE_SCHEMA THEN
        IF (TG_TABLE_NAME = 'runs' AND permission->'run_ids' ? (old_row->>'id'))
           OR (TG_TABLE_NAME IN ('run_evidence', 'run_research_manifests')
               AND permission->'run_ids' ? (old_row->>'run_id'))
           OR (TG_TABLE_NAME = 'artifact_blobs'
               AND permission->'artifact_ids' ? (old_row->>'id')) THEN
            RETURN OLD;
        END IF;
    END IF;
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON workflow_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON workflow_revisions
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON runs
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON runs
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_commands
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_commands
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_controls
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_controls
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_node_executions
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_node_executions
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON artifact_blobs
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON artifact_blobs
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evidence_records
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evidence_records
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON claims
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON claims
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON claim_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON claim_evidence
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_evidence
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_research_manifests
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_research_manifests
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON research_attempts
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON research_attempts
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_references
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_references
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_datasets
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_datasets
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_candidates
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_candidates
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_comparisons
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_comparisons
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_feedback
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_feedback
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_judges
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_judges
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON evaluation_archives
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON evaluation_archives
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON style_guides
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON style_guides
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON report_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON report_revisions
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON report_feedback
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON report_feedback
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON run_jobs
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON run_jobs
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON checkpoints
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON checkpoints
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON checkpoint_blobs
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON checkpoint_blobs
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
CREATE TRIGGER retention_writer BEFORE INSERT OR UPDATE OR DELETE ON checkpoint_writes
    FOR EACH STATEMENT EXECUTE FUNCTION retention_writer_lock();
CREATE TRIGGER retention_references BEFORE INSERT OR UPDATE ON checkpoint_writes
    FOR EACH ROW EXECUTE FUNCTION retention_reference_guard();
