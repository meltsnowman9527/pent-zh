package services

import (
	"encoding/json"
	"time"

	"pentagi/pkg/server/models"

	"github.com/jinzhu/gorm"
)

const intelligenceWriteBatchSize = 500

func upsertIntelligenceItems(
	tx *gorm.DB,
	uid, sourceID uint64,
	items []models.IntelligenceItem,
	seenAt time.Time,
) error {
	query := `INSERT INTO intelligence_items
        (user_id, source_id, external_id, item_type, title, summary, cve_id, severity,
         vendor, product, weakness, source_url, published_at, modified_at, data, last_seen_at)
        SELECT ?, ?, x.external_id, x.item_type, x.title, x.summary, x.cve_id, x.severity,
               x.vendor, x.product, x.weakness, x.source_url, x.published_at, x.modified_at,
               COALESCE(x.data, '{}'::jsonb), ?
          FROM jsonb_to_recordset(?::jsonb) AS x(
               external_id text, item_type text, title text, summary text, cve_id text,
               severity text, vendor text, product text, weakness text, source_url text,
               published_at timestamptz, modified_at timestamptz, data jsonb)
        ON CONFLICT (source_id, external_id) DO UPDATE SET
          item_type=EXCLUDED.item_type, title=EXCLUDED.title, summary=EXCLUDED.summary,
          cve_id=EXCLUDED.cve_id, severity=EXCLUDED.severity, vendor=EXCLUDED.vendor,
          product=EXCLUDED.product, weakness=EXCLUDED.weakness, source_url=EXCLUDED.source_url,
          published_at=EXCLUDED.published_at, modified_at=EXCLUDED.modified_at,
          data=EXCLUDED.data, last_seen_at=EXCLUDED.last_seen_at, updated_at=CURRENT_TIMESTAMP`
	for start := 0; start < len(items); start += intelligenceWriteBatchSize {
		end := start + intelligenceWriteBatchSize
		if end > len(items) {
			end = len(items)
		}
		payload, err := json.Marshal(items[start:end])
		if err != nil {
			return err
		}
		if err := tx.Exec(query, uid, sourceID, seenAt, string(payload)).Error; err != nil {
			return err
		}
	}
	return nil
}

func insertIntelligenceRelations(
	tx *gorm.DB,
	uid, sourceID uint64,
	relations []models.IntelligenceRelation,
) error {
	query := `INSERT INTO intelligence_relations
        (user_id, source_id, source_external_id, target_external_id, relation_type, description)
        SELECT ?, ?, x.source, x.target, x.type, COALESCE(x.description, '')
          FROM jsonb_to_recordset(?::jsonb) AS x(
               source text, target text, type text, description text)
        ON CONFLICT (source_id, source_external_id, target_external_id, relation_type)
        DO UPDATE SET description=EXCLUDED.description, updated_at=CURRENT_TIMESTAMP`
	for start := 0; start < len(relations); start += intelligenceWriteBatchSize {
		end := start + intelligenceWriteBatchSize
		if end > len(relations) {
			end = len(relations)
		}
		payload, err := json.Marshal(relations[start:end])
		if err != nil {
			return err
		}
		if err := tx.Exec(query, uid, sourceID, string(payload)).Error; err != nil {
			return err
		}
	}
	return nil
}
