package models

import (
	"encoding/json"
	"time"
)

type IntelligenceSource struct {
	ID                  uint64     `json:"id"`
	UserID              uint64     `json:"-"`
	Name                string     `json:"name"`
	Description         string     `json:"description"`
	URL                 string     `json:"url"`
	Format              string     `json:"format"`
	Builtin             bool       `json:"builtin"`
	Schedule            string     `json:"schedule"`
	Enabled             bool       `json:"enabled"`
	Status              string     `json:"status"`
	ItemCount           uint64     `json:"item_count"`
	LastError           string     `json:"last_error"`
	ConsecutiveFailures int        `json:"consecutive_failures"`
	LastSuccessAt       *time.Time `json:"last_success_at"`
	LastDurationMS      int64      `json:"last_duration_ms"`
	LastByteSize        int64      `json:"last_byte_size"`
	LastChecksum        string     `json:"last_checksum"`
	// Cursor and ShardKey let a large feed (for example one NVD year) resume
	// instead of restarting from the first record.
	Cursor     string     `json:"cursor"`
	ShardKey   string     `json:"shard_key"`
	LastSyncAt *time.Time `json:"last_sync_at"`
	NextSyncAt *time.Time `json:"next_sync_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (IntelligenceSource) TableName() string { return "intelligence_sources" }

type IntelligenceItem struct {
	ID             uint64          `json:"id"`
	UserID         uint64          `json:"-"`
	SourceID       uint64          `json:"source_id"`
	ExternalID     string          `json:"external_id"`
	ItemType       string          `json:"item_type"`
	Title          string          `json:"title"`
	Summary        string          `json:"summary"`
	CVEID          string          `json:"cve_id"`
	Severity       string          `json:"severity"`
	Vendor         string          `json:"vendor"`
	Product        string          `json:"product"`
	Weakness       string          `json:"weakness"`
	SourceURL      string          `json:"source_url"`
	PublishedAt    *time.Time      `json:"published_at"`
	ModifiedAt     *time.Time      `json:"modified_at"`
	CVSSScore      *float64        `json:"cvss_score"`
	EPSSScore      *float64        `json:"epss_score"`
	EPSSPercentile *float64        `json:"epss_percentile"`
	Exploited      bool            `json:"exploited"`
	CPECount       int             `json:"cpe_count"`
	Data           json.RawMessage `json:"data" gorm:"type:jsonb"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

func (IntelligenceItem) TableName() string { return "intelligence_items" }

// IntelligenceCPEMatch is one NVD cpeMatch entry: the CPE criteria plus the
// version window that decides whether a discovered service is affected.
type IntelligenceCPEMatch struct {
	ID                    uint64    `json:"id"`
	UserID                uint64    `json:"-"`
	SourceID              uint64    `json:"source_id"`
	CVEID                 string    `json:"cve_id"`
	Criteria              string    `json:"criteria"`
	Part                  string    `json:"part"`
	Vendor                string    `json:"vendor"`
	Product               string    `json:"product"`
	Version               string    `json:"version"`
	UpdateVersion         string    `json:"update_version"`
	VersionStartIncluding string    `json:"version_start_including"`
	VersionStartExcluding string    `json:"version_start_excluding"`
	VersionEndIncluding   string    `json:"version_end_including"`
	VersionEndExcluding   string    `json:"version_end_excluding"`
	Vulnerable            bool      `json:"vulnerable"`
	NodeOperator          string    `json:"node_operator"`
	Negate                bool      `json:"negate"`
	LastSeenAt            time.Time `json:"last_seen_at"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

func (IntelligenceCPEMatch) TableName() string { return "intelligence_cpe_matches" }

// IntelligenceSyncRun records one sync attempt so feed reliability is auditable.
type IntelligenceSyncRun struct {
	ID            uint64     `json:"id"`
	UserID        uint64     `json:"-"`
	SourceID      uint64     `json:"source_id"`
	Status        string     `json:"status"`
	ItemCount     int64      `json:"item_count"`
	RelationCount int64      `json:"relation_count"`
	CPECount      int64      `json:"cpe_count"`
	ByteSize      int64      `json:"byte_size"`
	DurationMS    int64      `json:"duration_ms"`
	Checksum      string     `json:"checksum"`
	ParserVersion string     `json:"parser_version"`
	Error         string     `json:"error"`
	StartedAt     time.Time  `json:"started_at"`
	FinishedAt    *time.Time `json:"finished_at"`
}

func (IntelligenceSyncRun) TableName() string { return "intelligence_sync_runs" }

type IntelligenceOverview struct {
	Sources []IntelligenceSource `json:"sources"`
	Items   []IntelligenceItem   `json:"items"`
	Stats   IntelligenceStats    `json:"stats"`
}

type IntelligenceRelation struct {
	ID               uint64    `json:"id"`
	UserID           uint64    `json:"-"`
	SourceID         uint64    `json:"source_id"`
	SourceExternalID string    `json:"source"`
	TargetExternalID string    `json:"target"`
	RelationType     string    `json:"type"`
	Description      string    `json:"description"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (IntelligenceRelation) TableName() string { return "intelligence_relations" }

type IntelligenceGraphNode struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	SourceID    uint64 `json:"source_id"`
	SourceName  string `json:"source_name"`
}

type IntelligenceGraphEdge struct {
	Source      string `json:"source"`
	Target      string `json:"target"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type IntelligenceGraph struct {
	Nodes []IntelligenceGraphNode `json:"nodes"`
	Edges []IntelligenceGraphEdge `json:"edges"`
}

type IntelligenceStats struct {
	Sources       uint64 `json:"sources"`
	Enabled       uint64 `json:"enabled"`
	Items         uint64 `json:"items"`
	Critical      uint64 `json:"critical"`
	FailedSources uint64 `json:"failed_sources"`
	Relations     uint64 `json:"relations"`
}

type CreateIntelligenceSourceRequest struct {
	Name     string `json:"name" binding:"required"`
	URL      string `json:"url" binding:"required"`
	Format   string `json:"format"`
	Schedule string `json:"schedule"`
}

type UpdateIntelligenceSourceRequest struct {
	Enabled  *bool  `json:"enabled"`
	Name     string `json:"name"`
	Schedule string `json:"schedule"`
}
