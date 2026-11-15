CREATE TABLE evaluation_references (
    id uuid PRIMARY KEY,
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluation_datasets (
    id uuid PRIMARY KEY,
    series_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    replaces_id uuid UNIQUE REFERENCES evaluation_datasets(id),
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (series_id, version)
);
CREATE TABLE evaluation_candidates (
    id uuid PRIMARY KEY,
    dataset_id uuid NOT NULL REFERENCES evaluation_datasets(id),
    case_id text NOT NULL,
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluation_comparisons (
    id uuid PRIMARY KEY,
    dataset_id uuid NOT NULL REFERENCES evaluation_datasets(id),
    case_id text NOT NULL,
    left_id uuid NOT NULL REFERENCES evaluation_candidates(id),
    right_id uuid NOT NULL REFERENCES evaluation_candidates(id),
    pair_key text NOT NULL UNIQUE,
    document jsonb NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (left_id != right_id)
);
CREATE TABLE evaluation_feedback (
    id uuid PRIMARY KEY,
    comparison_id uuid NOT NULL UNIQUE REFERENCES evaluation_comparisons(id),
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluation_judges (
    id uuid PRIMARY KEY,
    comparison_id uuid NOT NULL REFERENCES evaluation_comparisons(id),
    judge_key text NOT NULL,
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (comparison_id, judge_key)
);
CREATE TABLE evaluation_archives (
    id uuid PRIMARY KEY,
    content_hash text NOT NULL UNIQUE,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_datasets_created ON evaluation_datasets(created_at DESC, id DESC);
CREATE INDEX evaluation_candidates_case ON evaluation_candidates(dataset_id, case_id, created_at);
CREATE INDEX evaluation_comparisons_created ON evaluation_comparisons(created_at DESC, id DESC);
CREATE INDEX evaluation_judges_comparison ON evaluation_judges(comparison_id);
CREATE TRIGGER evaluation_reference_immutable BEFORE UPDATE OR DELETE ON evaluation_references
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_dataset_immutable BEFORE UPDATE OR DELETE ON evaluation_datasets
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_candidate_immutable BEFORE UPDATE OR DELETE ON evaluation_candidates
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_comparison_immutable BEFORE UPDATE OR DELETE ON evaluation_comparisons
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_feedback_immutable BEFORE UPDATE OR DELETE ON evaluation_feedback
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_judge_immutable BEFORE UPDATE OR DELETE ON evaluation_judges
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evaluation_archive_immutable BEFORE UPDATE OR DELETE ON evaluation_archives
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
