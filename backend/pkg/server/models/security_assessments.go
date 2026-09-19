package models

import "time"

type SecurityAssessmentRun struct {
	ID           uint64    `json:"id" gorm:"type:BIGINT;NOT NULL;PRIMARY_KEY;AUTO_INCREMENT"`
	UserID       uint64    `json:"user_id" gorm:"type:BIGINT;NOT NULL"`
	FlowID       uint64    `json:"flow_id" gorm:"type:BIGINT;NOT NULL"`
	Mode         string    `json:"mode" gorm:"type:TEXT;NOT NULL"`
	ScanType     string    `json:"scan_type" gorm:"type:TEXT;NOT NULL"`
	Target       string    `json:"target" gorm:"type:TEXT;NOT NULL"`
	Profile      string    `json:"profile" gorm:"type:TEXT;NOT NULL"`
	Focus        string    `json:"focus" gorm:"type:TEXT;NOT NULL"`
	Instructions string    `json:"instructions" gorm:"type:TEXT;NOT NULL"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (SecurityAssessmentRun) TableName() string { return "security_assessment_runs" }

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

type SecurityAssessmentStage struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type SecurityAssessmentRunView struct {
	SecurityAssessmentRun
	Status       FlowStatus                `json:"status"`
	Title        string                    `json:"title"`
	CurrentStage string                    `json:"current_stage"`
	Stages       []SecurityAssessmentStage `json:"stages"`
}
