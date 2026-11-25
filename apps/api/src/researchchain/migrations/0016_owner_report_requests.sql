ALTER TABLE run_controls ADD COLUMN owner_report_request jsonb
    CHECK (owner_report_request IS NULL OR jsonb_typeof(owner_report_request) = 'object');
