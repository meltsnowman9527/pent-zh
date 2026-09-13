-- +goose Up
-- +goose StatementBegin

-- One row per lifecycle operation on a flow (kind: create | stop | finish).
-- The row is written *before* the expensive work starts, so the caller can
-- return a queued state immediately, a failure keeps enough information to be
-- retried, and a run interrupted by a restart stays visible instead of
-- vanishing. `segments` carries the per-step durations used to tell model,
-- database, docker and subscription latency apart.
CREATE TABLE IF NOT EXISTS flow_jobs (
  id             BIGINT       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  flow_id        BIGINT       NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id        BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'queued',
  step           TEXT         NOT NULL DEFAULT 'queued',
  attempts       SMALLINT     NOT NULL DEFAULT 0,
  max_attempts   SMALLINT     NOT NULL DEFAULT 3,
  error          TEXT,
  correlation_id TEXT         NOT NULL,
  payload        JSONB        NOT NULL DEFAULT '{}',
  segments       JSONB        NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Every flow fetch reads its newest job; the list view reads one row per flow.
CREATE INDEX IF NOT EXISTS flow_jobs_flow_idx ON flow_jobs (flow_id, id DESC);

-- At most one queued/running job per flow and kind. A double submit cannot
-- start a second initialization or a second cleanup of the same flow: the
-- duplicate insert fails instead of doing the work twice.
CREATE UNIQUE INDEX IF NOT EXISTS flow_jobs_active_uniq
  ON flow_jobs (flow_id, kind)
  WHERE status IN ('queued', 'running');

-- The runner drains this index at startup (recovery) and while it runs.
CREATE INDEX IF NOT EXISTS flow_jobs_pending_idx
  ON flow_jobs (status, id)
  WHERE status IN ('queued', 'running');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS flow_jobs;

-- Job history is operational telemetry, not user data: nothing to restore.

-- +goose StatementEnd
