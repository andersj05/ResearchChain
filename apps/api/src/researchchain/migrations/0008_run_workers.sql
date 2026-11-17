-- Only newly admitted commands are dispatched automatically. Existing journals
-- retain their paused/interrupted state until the owner explicitly recovers.
CREATE TABLE run_queue_limits (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    max_parallel integer NOT NULL CHECK (max_parallel BETWEEN 1 AND 8),
    max_pending integer NOT NULL CHECK (max_pending BETWEEN 1 AND 1000)
);
INSERT INTO run_queue_limits (max_parallel, max_pending) VALUES (2, 100);

CREATE TABLE run_jobs (
    command_id uuid PRIMARY KEY REFERENCES run_commands(id),
    state text NOT NULL CHECK (state IN ('queued', 'running', 'interrupted', 'finished')),
    owner_id uuid,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    generation_attempts integer NOT NULL DEFAULT 0 CHECK (generation_attempts >= 0),
    queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    claimed_at timestamptz,
    finished_at timestamptz,
    last_error text CHECK (length(last_error) <= 500),
    CHECK ((state = 'running') = (owner_id IS NOT NULL))
);
CREATE INDEX run_jobs_dispatch_idx ON run_jobs(queued_at, command_id)
    WHERE state IN ('queued', 'running');
