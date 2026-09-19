-- +goose Up
-- +goose StatementBegin
-- The orchestration no longer drives a single prompt-shaped flow; each stage owns
-- its own flow, so the assessment row keeps only a pointer to the stage flow that
-- the workbench should open.
ALTER TABLE security_assessment_runs
  ALTER COLUMN flow_id DROP NOT NULL;

ALTER TABLE security_assessment_runs
  ADD COLUMN IF NOT EXISTS model_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resource_ids TEXT NOT NULL DEFAULT '[]';

ALTER TABLE security_assessment_runs
  DROP CONSTRAINT IF EXISTS security_assessment_runs_status_check;
ALTER TABLE security_assessment_runs
  ADD CONSTRAINT security_assessment_runs_status_check
  CHECK (status IN ('pending', 'running', 'waiting', 'finished', 'failed', 'stopped'));

CREATE TABLE security_assessment_stages (
  id                 BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  assessment_run_id  BIGINT NOT NULL REFERENCES security_assessment_runs(id) ON DELETE CASCADE,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_key          TEXT NOT NULL,
  stage_order        INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  run_id             BIGINT NOT NULL DEFAULT 0,
  flow_id            BIGINT NOT NULL DEFAULT 0,
  error              TEXT NOT NULL DEFAULT '',
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT security_assessment_stages_key_unique UNIQUE (assessment_run_id, stage_key),
  CONSTRAINT security_assessment_stages_status_check
    CHECK (status IN ('pending', 'running', 'waiting', 'finished', 'failed', 'skipped', 'stopped'))
);

CREATE INDEX security_assessment_stages_run_idx
  ON security_assessment_stages (assessment_run_id, stage_order);

CREATE OR REPLACE TRIGGER update_security_assessment_stages_modified
  BEFORE UPDATE ON security_assessment_stages
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS security_assessment_stages;

ALTER TABLE security_assessment_runs
  DROP CONSTRAINT IF EXISTS security_assessment_runs_status_check;

-- Rows created by the staged orchestrator have no single owning flow, so they
-- cannot satisfy the restored NOT NULL constraint.
DELETE FROM security_assessment_runs WHERE flow_id IS NULL;

ALTER TABLE security_assessment_runs
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS current_stage,
  DROP COLUMN IF EXISTS model_provider,
  DROP COLUMN IF EXISTS error,
  DROP COLUMN IF EXISTS resource_ids;

ALTER TABLE security_assessment_runs
  ALTER COLUMN flow_id SET NOT NULL;
-- +goose StatementEnd
