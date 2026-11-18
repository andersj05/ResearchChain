-- Retention can remove the baseline independently of this immutable manifest.
ALTER TABLE runs ADD COLUMN baseline_run_id uuid
    CHECK (baseline_run_id <> id);
