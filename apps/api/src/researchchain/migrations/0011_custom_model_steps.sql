ALTER TABLE research_attempts DROP CONSTRAINT research_attempts_stage_check;
ALTER TABLE research_attempts ADD CONSTRAINT research_attempts_stage_check
  CHECK (stage IN ('hypothesize', 'challenge', 'revise', 'custom'));
