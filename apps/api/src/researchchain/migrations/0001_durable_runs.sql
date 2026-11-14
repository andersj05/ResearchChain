CREATE TABLE workflow_revisions (
    id uuid PRIMARY KEY,
    number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
    content_hash text UNIQUE NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    workflow jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
    id uuid PRIMARY KEY,
    revision_id uuid NOT NULL REFERENCES workflow_revisions(id),
    compiler_version text NOT NULL,
    brief text NOT NULL,
    artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_created_at_idx ON runs(created_at DESC, id DESC);

CREATE TABLE run_commands (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    kind text NOT NULL CHECK (kind IN ('start', 'resume')),
    checkpoint_id text,
    interrupt_id text,
    decision text CHECK (decision IN ('approve', 'reject')),
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (kind = 'start' AND checkpoint_id IS NULL AND interrupt_id IS NULL AND decision IS NULL)
        OR (kind = 'resume' AND checkpoint_id IS NOT NULL AND interrupt_id IS NOT NULL
            AND decision IS NOT NULL)
    )
);
CREATE UNIQUE INDEX run_start_unique ON run_commands(run_id) WHERE kind = 'start';
CREATE UNIQUE INDEX run_interrupt_unique ON run_commands(run_id, interrupt_id)
    WHERE kind = 'resume';
CREATE UNIQUE INDEX run_unfinished_unique ON run_commands(run_id) WHERE response IS NULL;

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER workflow_revision_immutable BEFORE UPDATE OR DELETE ON workflow_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER run_manifest_immutable BEFORE UPDATE OR DELETE ON runs
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
