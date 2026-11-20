ALTER TABLE run_controls ADD COLUMN owner_directions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(owner_directions) = 'array' AND jsonb_array_length(owner_directions) <= 24);

ALTER TABLE research_attempts ADD COLUMN owner_direction_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
    CHECK (cardinality(owner_direction_ids) <= 24);
