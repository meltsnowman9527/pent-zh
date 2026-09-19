-- +goose Up
-- +goose StatementBegin

INSERT INTO privileges (role_id, name) VALUES
  (1, 'intelligence.view'),
  (1, 'intelligence.manage'),
  (1, 'intelligence.sync'),
  (2, 'intelligence.view'),
  (2, 'intelligence.manage'),
  (2, 'intelligence.sync')
ON CONFLICT DO NOTHING;

ALTER TABLE intelligence_sources
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS builtin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE intelligence_sources DROP CONSTRAINT IF EXISTS intelligence_sources_format_check;
ALTER TABLE intelligence_sources
  ADD CONSTRAINT intelligence_sources_format_check
  CHECK (format IN ('auto', 'json', 'rss', 'stix', 'cwe'));

ALTER TABLE intelligence_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'vulnerability',
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS intelligence_items_type_idx
  ON intelligence_items(user_id, item_type);
CREATE INDEX IF NOT EXISTS intelligence_items_external_idx
  ON intelligence_items(user_id, external_id);

CREATE TABLE intelligence_relations (
  id                 BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id          BIGINT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
  source_external_id TEXT NOT NULL,
  target_external_id TEXT NOT NULL,
  relation_type      TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intelligence_relations_unique
    UNIQUE (source_id, source_external_id, target_external_id, relation_type)
);

CREATE INDEX intelligence_relations_user_source_idx
  ON intelligence_relations(user_id, source_external_id);
CREATE INDEX intelligence_relations_user_target_idx
  ON intelligence_relations(user_id, target_external_id);

CREATE OR REPLACE TRIGGER update_intelligence_relations_modified
  BEFORE UPDATE ON intelligence_relations
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

CREATE TABLE intelligence_snapshots (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id      BIGINT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
  checksum       TEXT NOT NULL,
  content_type   TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL,
  byte_size      BIGINT NOT NULL,
  item_count     BIGINT NOT NULL DEFAULT 0,
  payload        BYTEA NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intelligence_snapshots_source_checksum_unique UNIQUE (source_id, checksum)
);

CREATE INDEX intelligence_snapshots_source_fetched_idx
  ON intelligence_snapshots(source_id, fetched_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS intelligence_snapshots;
DROP TABLE IF EXISTS intelligence_relations;
DELETE FROM privileges WHERE name IN ('intelligence.view', 'intelligence.manage', 'intelligence.sync');
DROP INDEX IF EXISTS intelligence_items_external_idx;
DROP INDEX IF EXISTS intelligence_items_type_idx;
ALTER TABLE intelligence_items
  DROP COLUMN IF EXISTS last_seen_at,
  DROP COLUMN IF EXISTS modified_at,
  DROP COLUMN IF EXISTS data,
  DROP COLUMN IF EXISTS item_type;
ALTER TABLE intelligence_sources DROP CONSTRAINT IF EXISTS intelligence_sources_format_check;
UPDATE intelligence_sources SET format = 'json' WHERE format IN ('stix', 'cwe');
ALTER TABLE intelligence_sources
  ADD CONSTRAINT intelligence_sources_format_check CHECK (format IN ('auto', 'json', 'rss'));
ALTER TABLE intelligence_sources
  DROP COLUMN IF EXISTS builtin,
  DROP COLUMN IF EXISTS description;

-- +goose StatementEnd
