-- +goose Up
-- +goose StatementBegin
CREATE TABLE asset_discovery_runs (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id         BIGINT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  discovery_type  TEXT NOT NULL,
  target          TEXT NOT NULL,
  profile         TEXT NOT NULL DEFAULT 'standard',
  imported_at     TIMESTAMPTZ,
  import_error    TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT asset_discovery_runs_flow_unique UNIQUE (flow_id),
  CONSTRAINT asset_discovery_runs_type_check CHECK (discovery_type IN ('passive', 'traditional')),
  CONSTRAINT asset_discovery_runs_profile_check CHECK (profile IN ('quick', 'standard', 'deep'))
);

CREATE INDEX asset_discovery_runs_user_created_idx
  ON asset_discovery_runs(user_id, created_at DESC);

CREATE TABLE discovered_assets (
  id                 BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discovery_run_id   BIGINT REFERENCES asset_discovery_runs(id) ON DELETE SET NULL,
  asset_key          TEXT NOT NULL,
  asset_type         TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  address            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'unknown',
  exposure           TEXT NOT NULL DEFAULT 'unknown',
  discovery_method   TEXT NOT NULL,
  confidence         TEXT NOT NULL DEFAULT 'inferred',
  operating_system   TEXT NOT NULL DEFAULT '',
  evidence           TEXT NOT NULL DEFAULT '',
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_scan_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discovered_assets_user_key_unique UNIQUE (user_id, asset_key),
  CONSTRAINT discovered_assets_status_check CHECK (status IN ('active', 'inactive', 'unknown')),
  CONSTRAINT discovered_assets_exposure_check CHECK (exposure IN ('external', 'internal', 'unknown')),
  CONSTRAINT discovered_assets_confidence_check CHECK (confidence IN ('confirmed', 'probable', 'inferred'))
);

CREATE INDEX discovered_assets_user_last_seen_idx
  ON discovered_assets(user_id, last_seen_at DESC);
CREATE INDEX discovered_assets_user_address_idx
  ON discovered_assets(user_id, address);

CREATE TABLE discovered_asset_services (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  asset_id       BIGINT NOT NULL REFERENCES discovered_assets(id) ON DELETE CASCADE,
  port           INTEGER NOT NULL,
  transport      TEXT NOT NULL DEFAULT 'tcp',
  service        TEXT NOT NULL DEFAULT '',
  product        TEXT NOT NULL DEFAULT '',
  version        TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT 'open',
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discovered_asset_services_unique UNIQUE (asset_id, port, transport),
  CONSTRAINT discovered_asset_services_port_check CHECK (port BETWEEN 1 AND 65535)
);

CREATE TABLE vulnerability_scan_assets (
  scan_run_id BIGINT NOT NULL REFERENCES vulnerability_scan_runs(id) ON DELETE CASCADE,
  asset_id    BIGINT NOT NULL REFERENCES discovered_assets(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scan_run_id, asset_id)
);

CREATE OR REPLACE TRIGGER update_asset_discovery_runs_modified
  BEFORE UPDATE ON asset_discovery_runs
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE OR REPLACE TRIGGER update_discovered_assets_modified
  BEFORE UPDATE ON discovered_assets
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE OR REPLACE TRIGGER update_discovered_asset_services_modified
  BEFORE UPDATE ON discovered_asset_services
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS vulnerability_scan_assets;
DROP TABLE IF EXISTS discovered_asset_services;
DROP TABLE IF EXISTS discovered_assets;
DROP TABLE IF EXISTS asset_discovery_runs;
-- +goose StatementEnd
