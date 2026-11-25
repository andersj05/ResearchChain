ALTER TABLE run_commands
    ADD COLUMN recovery_of uuid UNIQUE REFERENCES run_commands(id),
    DROP CONSTRAINT run_commands_kind_check,
    DROP CONSTRAINT run_commands_check;

ALTER TABLE run_commands
    ADD CONSTRAINT run_commands_kind_check CHECK (kind IN ('start', 'resume', 'recover')),
    ADD CONSTRAINT run_commands_shape_check CHECK (
        ((kind = 'recover') = (recovery_of IS NOT NULL))
        AND (
            (kind IN ('start', 'recover') AND checkpoint_id IS NULL
                AND interrupt_id IS NULL AND decision IS NULL)
            OR (kind IN ('resume', 'recover') AND checkpoint_id IS NOT NULL
                AND interrupt_id IS NOT NULL AND decision IS NOT NULL)
        )
    );

-- A retried path gets a fresh receipt and allowance charge. Preserve the prior
-- attempt, its originals and its provider diagnostics in the run history.
ALTER TABLE research_attempts
    ADD COLUMN provider_failure jsonb CHECK (jsonb_typeof(provider_failure) = 'object'),
    ADD COLUMN superseded_at timestamptz CHECK (superseded_at IS NULL OR status = 'failed'),
    DROP CONSTRAINT research_attempts_run_id_path_key;

CREATE UNIQUE INDEX research_attempts_current_path
    ON research_attempts(run_id, path) WHERE superseded_at IS NULL;
