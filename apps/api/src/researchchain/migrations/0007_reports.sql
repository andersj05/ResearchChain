CREATE TABLE style_guides (
    id uuid PRIMARY KEY,
    series_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    replaces_id uuid UNIQUE REFERENCES style_guides(id),
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (series_id, version)
);
CREATE TABLE report_revisions (
    id uuid PRIMARY KEY,
    series_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    replaces_id uuid UNIQUE REFERENCES report_revisions(id),
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (series_id, version)
);
CREATE TABLE report_feedback (
    id uuid PRIMARY KEY,
    revision_id uuid NOT NULL REFERENCES report_revisions(id),
    sequence bigserial UNIQUE NOT NULL,
    request_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_feedback_revision ON report_feedback(revision_id,sequence);
CREATE INDEX report_revisions_recent ON report_revisions(created_at DESC,id DESC);
CREATE INDEX style_guides_recent ON style_guides(created_at DESC,id DESC);
CREATE TRIGGER style_guide_immutable BEFORE UPDATE OR DELETE ON style_guides
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER report_revision_immutable BEFORE UPDATE OR DELETE ON report_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER report_feedback_immutable BEFORE UPDATE OR DELETE ON report_feedback
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
