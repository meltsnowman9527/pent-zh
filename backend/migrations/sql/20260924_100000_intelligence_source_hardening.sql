-- +goose Up
-- +goose StatementBegin
-- Source health: a failing feed must be visible and must back off instead of
-- silently staying "ready" with stale data.
ALTER TABLE intelligence_sources
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_duration_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_byte_size BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checksum TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cursor TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS shard_key TEXT NOT NULL DEFAULT '';

ALTER TABLE intelligence_sources DROP CONSTRAINT IF EXISTS intelligence_sources_format_check;
ALTER TABLE intelligence_sources
  ADD CONSTRAINT intelligence_sources_format_check
  CHECK (format IN ('auto', 'json', 'rss', 'stix', 'cwe', 'csv'));

-- Item-level enrichment used to rank candidates without re-reading payloads.
ALTER TABLE intelligence_items
  ADD COLUMN IF NOT EXISTS cvss_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS epss_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS epss_percentile DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS exploited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cpe_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS intelligence_items_exploited_idx
  ON intelligence_items (user_id, exploited)
  WHERE exploited = TRUE;
CREATE INDEX IF NOT EXISTS intelligence_items_epss_idx
  ON intelligence_items (user_id, epss_score DESC NULLS LAST);

-- NVD configurations were thrown away before. Asset/vulnerability matching needs
-- every CPE criteria plus its version range, so it gets its own table.
CREATE TABLE intelligence_cpe_matches (
  id                      BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id               BIGINT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
  cve_id                  TEXT NOT NULL,
  criteria                TEXT NOT NULL,
  part                    TEXT NOT NULL DEFAULT '',
  vendor                  TEXT NOT NULL DEFAULT '',
  product                 TEXT NOT NULL DEFAULT '',
  version                 TEXT NOT NULL DEFAULT '',
  update_version          TEXT NOT NULL DEFAULT '',
  version_start_including TEXT NOT NULL DEFAULT '',
  version_start_excluding TEXT NOT NULL DEFAULT '',
  version_end_including   TEXT NOT NULL DEFAULT '',
  version_end_excluding   TEXT NOT NULL DEFAULT '',
  vulnerable              BOOLEAN NOT NULL DEFAULT TRUE,
  node_operator           TEXT NOT NULL DEFAULT 'OR',
  negate                  BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intelligence_cpe_matches_unique
    UNIQUE (source_id, cve_id, criteria, version_start_including, version_end_excluding)
);

CREATE INDEX intelligence_cpe_matches_product_idx
  ON intelligence_cpe_matches (user_id, vendor, product);
CREATE INDEX intelligence_cpe_matches_cve_idx
  ON intelligence_cpe_matches (user_id, cve_id);
CREATE INDEX intelligence_cpe_matches_source_seen_idx
  ON intelligence_cpe_matches (source_id, last_seen_at);

-- Per-attempt sync history: latency, size, checksum and error per run.
CREATE TABLE intelligence_sync_runs (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id      BIGINT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  item_count     BIGINT NOT NULL DEFAULT 0,
  relation_count BIGINT NOT NULL DEFAULT 0,
  cpe_count      BIGINT NOT NULL DEFAULT 0,
  byte_size      BIGINT NOT NULL DEFAULT 0,
  duration_ms    BIGINT NOT NULL DEFAULT 0,
  checksum       TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL DEFAULT '',
  error          TEXT NOT NULL DEFAULT '',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at    TIMESTAMPTZ,
  CONSTRAINT intelligence_sync_runs_status_check
    CHECK (status IN ('running', 'success', 'failed'))
);

CREATE INDEX intelligence_sync_runs_source_idx
  ON intelligence_sync_runs (source_id, started_at DESC);

CREATE OR REPLACE TRIGGER update_intelligence_cpe_matches_modified
  BEFORE UPDATE ON intelligence_cpe_matches
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS intelligence_sync_runs;
DROP TABLE IF EXISTS intelligence_cpe_matches;

DROP INDEX IF EXISTS intelligence_items_epss_idx;
DROP INDEX IF EXISTS intelligence_items_exploited_idx;
ALTER TABLE intelligence_items
  DROP COLUMN IF EXISTS cvss_score,
  DROP COLUMN IF EXISTS epss_score,
  DROP COLUMN IF EXISTS epss_percentile,
  DROP COLUMN IF EXISTS exploited,
  DROP COLUMN IF EXISTS cpe_count;

ALTER TABLE intelligence_sources DROP CONSTRAINT IF EXISTS intelligence_sources_format_check;
ALTER TABLE intelligence_sources
  ADD CONSTRAINT intelligence_sources_format_check
  CHECK (format IN ('auto', 'json', 'rss', 'stix', 'cwe'));

ALTER TABLE intelligence_sources
  DROP COLUMN IF EXISTS consecutive_failures,
  DROP COLUMN IF EXISTS last_success_at,
  DROP COLUMN IF EXISTS last_duration_ms,
  DROP COLUMN IF EXISTS last_byte_size,
  DROP COLUMN IF EXISTS last_checksum,
  DROP COLUMN IF EXISTS cursor,
  DROP COLUMN IF EXISTS shard_key;
-- +goose StatementEnd
