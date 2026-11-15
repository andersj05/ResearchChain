CREATE TABLE request_allowance_policies (
    revision bigint PRIMARY KEY CHECK (revision > 0),
    max_requests_24h integer NOT NULL CHECK (max_requests_24h BETWEEN 1 AND 10000),
    paused boolean NOT NULL,
    changed_by text NOT NULL CHECK (changed_by IN ('initial', 'owner', 'operator')),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO request_allowance_policies (revision, max_requests_24h, paused, changed_by)
VALUES (1, 100, false, 'initial');

CREATE TABLE model_request_admissions (
    id uuid PRIMARY KEY,
    admitted_at timestamptz NOT NULL,
    source text NOT NULL CHECK (source IN ('research', 'connection_test', 'imported_research')),
    policy_revision bigint REFERENCES request_allowance_policies(revision),
    CHECK ((source = 'imported_research') = (policy_revision IS NULL))
);
CREATE INDEX model_request_admissions_time ON model_request_admissions(admitted_at, id);

-- Preserve known historical attempts conservatively. No provider request is made.
INSERT INTO model_request_admissions (id, admitted_at, source, policy_revision)
SELECT id, created_at, 'imported_research', NULL FROM research_attempts;

CREATE FUNCTION reject_request_allowance_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Request allowance records are append-only.' USING ERRCODE = '23514';
END
$$;
CREATE TRIGGER request_allowance_policy_immutable
    BEFORE UPDATE OR DELETE ON request_allowance_policies
    FOR EACH ROW EXECUTE FUNCTION reject_request_allowance_change();
CREATE TRIGGER model_request_admission_immutable
    BEFORE UPDATE OR DELETE ON model_request_admissions
    FOR EACH ROW EXECUTE FUNCTION reject_request_allowance_change();
