-- +goose Up
-- +goose StatementBegin
CREATE TABLE intelligence_sources (
  id           BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  format       TEXT NOT NULL DEFAULT 'auto',
  schedule     TEXT NOT NULL DEFAULT 'daily',
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  status       TEXT NOT NULL DEFAULT 'pending',
  item_count   BIGINT NOT NULL DEFAULT 0,
  last_error   TEXT NOT NULL DEFAULT '',
  last_sync_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intelligence_sources_user_url_unique UNIQUE (user_id, url),
  CONSTRAINT intelligence_sources_schedule_check CHECK (schedule IN ('manual', 'hourly', 'daily', 'weekly')),
  CONSTRAINT intelligence_sources_format_check CHECK (format IN ('auto', 'json', 'rss'))
);

CREATE TABLE intelligence_items (
  id           BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id    BIGINT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  cve_id       TEXT NOT NULL DEFAULT '',
  severity     TEXT NOT NULL DEFAULT 'unknown',
  vendor       TEXT NOT NULL DEFAULT '',
  product      TEXT NOT NULL DEFAULT '',
  weakness     TEXT NOT NULL DEFAULT '',
  source_url   TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intelligence_items_source_external_unique UNIQUE (source_id, external_id)
);

CREATE INDEX intelligence_sources_user_id_idx ON intelligence_sources(user_id);
CREATE INDEX intelligence_sources_due_idx ON intelligence_sources(next_sync_at) WHERE enabled = TRUE;
CREATE INDEX intelligence_items_user_id_idx ON intelligence_items(user_id);
CREATE INDEX intelligence_items_updated_idx ON intelligence_items(updated_at DESC);
CREATE INDEX intelligence_items_cve_idx ON intelligence_items(cve_id) WHERE cve_id != '';

CREATE OR REPLACE TRIGGER update_intelligence_sources_modified
  BEFORE UPDATE ON intelligence_sources
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE OR REPLACE TRIGGER update_intelligence_items_modified
  BEFORE UPDATE ON intelligence_items
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS intelligence_items;
DROP TABLE IF EXISTS intelligence_sources;
-- +goose StatementEnd
