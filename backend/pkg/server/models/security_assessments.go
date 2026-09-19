package models

import "time"

// Assessment stage keys. The orchestrator walks them in order; the order is
// fixed here so both the scheduler and the API agree on progress.
const (
	AssessmentStageDiscovery = "discovery"
	AssessmentStageScan      = "scan"
	AssessmentStageChain     = "chain"
	AssessmentStagePentest   = "pentest"
)

// Assessment run statuses. A run is terminal once it reaches finished, failed or
// stopped; the background scheduler skips terminal runs.
const (
	AssessmentStatusPending  = "pending"
	AssessmentStatusRunning  = "running"
	AssessmentStatusWaiting  = "waiting"
	AssessmentStatusFinished = "finished"
	AssessmentStatusFailed   = "failed"
	AssessmentStatusStopped  = "stopped"
)

// Stage statuses. A stage is terminal once it reaches finished, failed, skipped
// or stopped.
const (
	AssessmentStageStatusPending  = "pending"
	AssessmentStageStatusRunning  = "running"
	AssessmentStageStatusWaiting  = "waiting"
	AssessmentStageStatusFinished = "finished"
	AssessmentStageStatusFailed   = "failed"
	AssessmentStageStatusSkipped  = "skipped"
	AssessmentStageStatusStopped  = "stopped"
)

type SecurityAssessmentRun struct {
	ID            uint64    `json:"id"`
	UserID        uint64    `json:"user_id"`
	FlowID        *uint64   `json:"flow_id"`
	Mode          string    `json:"mode"`
	ScanType      string    `json:"scan_type"`
	Target        string    `json:"target"`
	Profile       string    `json:"profile"`
	Focus         string    `json:"focus"`
	Instructions  string    `json:"instructions"`
	ModelProvider string    `json:"model_provider"`
	Status        string    `json:"status"`
	CurrentStage  string    `json:"current_stage"`
	Error         string    `json:"error"`
	// ResourcesJSON keeps the passive-discovery traffic file selection so a
	// retried discovery stage can reuse it.
	ResourcesJSON string    `json:"-" gorm:"column:resource_ids"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (SecurityAssessmentRun) TableName() string { return "security_assessment_runs" }

type SecurityAssessmentStage struct {
	ID              uint64     `json:"id"`
	AssessmentRunID uint64     `json:"assessment_run_id"`
	UserID          uint64     `json:"-"`
	Key             string     `json:"key" gorm:"column:stage_key"`
	Title           string     `json:"title" gorm:"-"`
	Order           int        `json:"order" gorm:"column:stage_order"`
	Status          string     `json:"status"`
	RunID           uint64     `json:"run_id"`
	FlowID          uint64     `json:"flow_id"`
	Error           string     `json:"error"`
	StartedAt       *time.Time `json:"started_at"`
	FinishedAt      *time.Time `json:"finished_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (SecurityAssessmentStage) TableName() string { return "security_assessment_stages" }

type CreateSecurityAssessmentRequest struct {
	Mode          string   `json:"mode"`
	ScanType      string   `json:"scan_type"`
	Target        string   `json:"target"`
	Profile       string   `json:"profile"`
	ModelProvider string   `json:"model_provider"`
	ResourceIDs   []uint64 `json:"resource_ids"`
	Focus         string   `json:"focus"`
	Instructions  string   `json:"instructions"`
}

type SecurityAssessmentRunView struct {
	SecurityAssessmentRun
	Stages []SecurityAssessmentStage `json:"stages"`
}
