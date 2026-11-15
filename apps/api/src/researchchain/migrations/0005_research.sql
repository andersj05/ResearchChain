ALTER TABLE run_controls DROP CONSTRAINT run_controls_terminal_status_check;
ALTER TABLE run_controls ADD CONSTRAINT run_controls_terminal_status_check
  CHECK (terminal_status IN ('completed', 'rejected', 'cancelled', 'limited', 'failed'));
ALTER TABLE run_commands ADD COLUMN feedback text NOT NULL DEFAULT '';

CREATE TABLE run_research_manifests (
    run_id uuid PRIMARY KEY REFERENCES runs(id),
    manifest jsonb NOT NULL
);
CREATE TRIGGER research_manifest_immutable BEFORE UPDATE OR DELETE ON run_research_manifests
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE research_attempts (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    path text NOT NULL,
    stage text NOT NULL CHECK (stage IN ('hypothesize', 'challenge', 'revise')),
    model text NOT NULL,
    returned_model text,
    status text NOT NULL CHECK (status IN
      ('preparing', 'requesting', 'completed', 'failed', 'unknown', 'cancelled', 'limited')),
    input_artifact_id text REFERENCES artifact_blobs(id),
    response_artifact_id text REFERENCES artifact_blobs(id),
    input_bytes integer NOT NULL DEFAULT 0 CHECK (input_bytes >= 0),
    output_characters integer NOT NULL DEFAULT 0 CHECK (output_characters >= 0),
    input_tokens bigint CHECK (input_tokens >= 0),
    output_tokens bigint CHECK (output_tokens >= 0),
    response_id text,
    reason text,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    UNIQUE (run_id, path),
    CHECK (status != 'completed' OR (result IS NOT NULL AND response_artifact_id IS NOT NULL
      AND input_artifact_id IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX research_attempts_run_created ON research_attempts(run_id, created_at, id);
