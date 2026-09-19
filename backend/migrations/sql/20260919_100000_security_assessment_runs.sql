-- +goose Up
-- +goose StatementBegin
CREATE TABLE security_assessment_runs (
  id                 BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id            BIGINT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  mode               TEXT NOT NULL,
  scan_type          TEXT NOT NULL,
  target             TEXT NOT NULL,
  profile            TEXT NOT NULL DEFAULT 'standard',
  focus              TEXT NOT NULL DEFAULT '',
  instructions       TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT security_assessment_runs_flow_unique UNIQUE (flow_id),
  CONSTRAINT security_assessment_runs_mode_check CHECK (mode IN ('automation', 'assistant')),
  CONSTRAINT security_assessment_runs_scan_type_check CHECK (scan_type IN ('passive', 'traditional')),
  CONSTRAINT security_assessment_runs_profile_check CHECK (profile IN ('quick', 'standard', 'deep'))
);

CREATE INDEX security_assessment_runs_user_created_idx
  ON security_assessment_runs(user_id, created_at DESC);

CREATE OR REPLACE TRIGGER update_security_assessment_runs_modified
  BEFORE UPDATE ON security_assessment_runs
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS security_assessment_runs;
-- +goose StatementEnd
