CREATE TABLE run_controls (
    run_id uuid PRIMARY KEY REFERENCES runs(id),
    terminal_status text CHECK (terminal_status IN ('completed', 'rejected', 'cancelled', 'limited')),
    reason text,
    active_seconds double precision NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
    active_started_at timestamptz
);
INSERT INTO run_controls (run_id, terminal_status)
SELECT r.id, (
    SELECT CASE WHEN c.response->>'status' IN ('completed', 'rejected')
        THEN c.response->>'status' ELSE NULL END
    FROM run_commands c WHERE c.run_id = r.id ORDER BY c.created_at DESC LIMIT 1
) FROM runs r;

CREATE TABLE run_node_executions (
    run_id uuid NOT NULL REFERENCES runs(id),
    path text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (run_id, path)
);
