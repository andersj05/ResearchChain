ALTER TABLE research_attempts ADD COLUMN web_actions_completed integer
    CHECK (web_actions_completed >= 0);
