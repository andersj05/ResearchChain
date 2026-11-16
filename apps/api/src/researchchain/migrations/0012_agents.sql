CREATE TABLE agents (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    version integer NOT NULL CHECK (version >= 1),
    revision_id uuid NOT NULL REFERENCES workflow_revisions(id),
    creation_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_revisions (
    agent_id uuid NOT NULL REFERENCES agents(id),
    version integer NOT NULL CHECK (version >= 1),
    revision_id uuid NOT NULL REFERENCES workflow_revisions(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, version)
);
CREATE INDEX agent_revisions_revision ON agent_revisions(revision_id, agent_id);
CREATE TRIGGER agent_revision_immutable BEFORE UPDATE OR DELETE ON agent_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE agent_runs (
    run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES agents(id),
    agent_name text NOT NULL
);
CREATE INDEX agent_runs_agent ON agent_runs(agent_id, run_id);
CREATE TRIGGER run_agent_immutable BEFORE UPDATE ON agent_runs
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
