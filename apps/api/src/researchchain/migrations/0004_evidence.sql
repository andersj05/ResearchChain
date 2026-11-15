CREATE TABLE artifact_blobs (
    id text PRIMARY KEY CHECK (id ~ '^sha256:[a-f0-9]{64}$'),
    name text NOT NULL,
    media_type text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
    content bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(content) = byte_size)
);
CREATE TRIGGER artifact_blob_immutable BEFORE UPDATE OR DELETE ON artifact_blobs
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE evidence_records (
    id uuid PRIMARY KEY,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    document jsonb NOT NULL,
    artifact_id text REFERENCES artifact_blobs(id),
    parent_id uuid REFERENCES evidence_records(id),
    replaces_id uuid REFERENCES evidence_records(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_created_idx ON evidence_records(created_at DESC, id DESC);
CREATE INDEX evidence_artifact_idx ON evidence_records(artifact_id);
CREATE TRIGGER evidence_record_immutable BEFORE UPDATE OR DELETE ON evidence_records
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE claims (
    id uuid PRIMARY KEY,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    document jsonb NOT NULL,
    replaces_id uuid REFERENCES claims(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_created_idx ON claims(created_at DESC, id DESC);
CREATE TRIGGER claim_immutable BEFORE UPDATE OR DELETE ON claims
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE claim_evidence (
    claim_id uuid NOT NULL REFERENCES claims(id),
    evidence_id uuid NOT NULL REFERENCES evidence_records(id),
    relation text NOT NULL CHECK (relation IN ('supports', 'contradicts', 'context')),
    PRIMARY KEY (claim_id, evidence_id, relation)
);
CREATE TRIGGER claim_evidence_immutable BEFORE UPDATE OR DELETE ON claim_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE run_evidence (
    run_id uuid NOT NULL REFERENCES runs(id),
    evidence_id uuid NOT NULL REFERENCES evidence_records(id),
    ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 100),
    PRIMARY KEY (run_id, evidence_id),
    UNIQUE (run_id, ordinal)
);
CREATE TRIGGER run_evidence_immutable BEFORE UPDATE OR DELETE ON run_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
