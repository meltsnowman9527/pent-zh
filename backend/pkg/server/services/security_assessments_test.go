package services

import (
	"testing"
	"time"

	"pentagi/pkg/server/models"

	"github.com/jinzhu/gorm"
	_ "github.com/jinzhu/gorm/dialects/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAssessmentTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open("sqlite3", ":memory:")
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.SecurityAssessmentRun{}, &models.SecurityAssessmentStage{}).Error)
	require.NoError(t, db.Exec(`CREATE TABLE flows (id INTEGER PRIMARY KEY, status TEXT, deleted_at TIMESTAMP)`).Error)
	t.Cleanup(func() { _ = db.Close() })

	return db
}

func seedAssessmentRun(t *testing.T, db *gorm.DB, uid uint64) models.SecurityAssessmentRun {
	t.Helper()

	run := models.SecurityAssessmentRun{
		UserID:        uid,
		Mode:          "automation",
		ScanType:      "traditional",
		Target:        "example.com",
		Profile:       "standard",
		ModelProvider: "deepseek",
		Status:        models.AssessmentStatusPending,
		ResourcesJSON: "[]",
	}
	require.NoError(t, db.Create(&run).Error)

	for _, definition := range assessmentStageDefinitions {
		stage := models.SecurityAssessmentStage{
			AssessmentRunID: run.ID,
			UserID:          uid,
			Key:             definition.Key,
			Order:           definition.Order,
			Status:          models.AssessmentStageStatusPending,
		}
		require.NoError(t, db.Create(&stage).Error)
	}

	return run
}

func TestAssessmentStageDefinitionsCoverThePipelineInOrder(t *testing.T) {
	keys := make([]string, 0, len(assessmentStageDefinitions))
	for idx, definition := range assessmentStageDefinitions {
		assert.Equal(t, idx+1, definition.Order, "stage order must follow the definition order")
		assert.NotEmpty(t, definition.Title)
		keys = append(keys, definition.Key)
	}
	assert.Equal(t, []string{"discovery", "scan", "chain", "pentest"}, keys)
	assert.Equal(t, "资产发现", assessmentStageTitle(models.AssessmentStageDiscovery))
	assert.Equal(t, "unknown", assessmentStageTitle("unknown"))
}

func TestTerminalAssessmentStatus(t *testing.T) {
	assert.True(t, terminalAssessmentStatus(models.AssessmentStatusFinished))
	assert.True(t, terminalAssessmentStatus(models.AssessmentStatusFailed))
	assert.True(t, terminalAssessmentStatus(models.AssessmentStatusStopped))
	assert.False(t, terminalAssessmentStatus(models.AssessmentStatusRunning))
	assert.False(t, terminalAssessmentStatus(models.AssessmentStatusWaiting))
	assert.False(t, terminalAssessmentStatus(models.AssessmentStatusPending))
}

func TestRunStatusForOutcome(t *testing.T) {
	assert.Equal(t, models.AssessmentStatusWaiting, runStatusForOutcome(stageOutcomeWaiting))
	assert.Equal(t, models.AssessmentStatusRunning, runStatusForOutcome(stageOutcomeRunning))
	assert.Equal(t, models.AssessmentStatusRunning, runStatusForOutcome(stageOutcomeFinished))
}

func TestActiveStageSkipsFinishedStages(t *testing.T) {
	stages := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, Order: 1, Status: models.AssessmentStageStatusFinished},
		{Key: models.AssessmentStageScan, Order: 2, Status: models.AssessmentStageStatusSkipped},
		{Key: models.AssessmentStageChain, Order: 3, Status: models.AssessmentStageStatusRunning},
		{Key: models.AssessmentStagePentest, Order: 4, Status: models.AssessmentStageStatusPending},
	}

	active := activeStage(stages)
	require.NotNil(t, active)
	assert.Equal(t, models.AssessmentStageChain, active.Key)

	allFinished := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, Order: 1, Status: models.AssessmentStageStatusFinished},
		{Key: models.AssessmentStageScan, Order: 2, Status: models.AssessmentStageStatusFinished},
	}
	assert.Nil(t, activeStage(allFinished))
}

func TestRetryTargetStagePrefersTheFailedStage(t *testing.T) {
	stages := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, Order: 1, Status: models.AssessmentStageStatusFinished},
		{Key: models.AssessmentStageScan, Order: 2, Status: models.AssessmentStageStatusFailed},
		{Key: models.AssessmentStageChain, Order: 3, Status: models.AssessmentStageStatusPending},
		{Key: models.AssessmentStagePentest, Order: 4, Status: models.AssessmentStageStatusPending},
	}

	target := retryTargetStage(stages)
	require.NotNil(t, target)
	assert.Equal(t, models.AssessmentStageScan, target.Key)

	stopped := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, Order: 1, Status: models.AssessmentStageStatusFinished},
		{Key: models.AssessmentStageScan, Order: 2, Status: models.AssessmentStageStatusStopped},
		{Key: models.AssessmentStageChain, Order: 3, Status: models.AssessmentStageStatusPending},
	}
	target = retryTargetStage(stopped)
	require.NotNil(t, target)
	assert.Equal(t, models.AssessmentStageScan, target.Key)

	// Without a failed or stopped stage the first unfinished one is retried.
	running := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, Order: 1, Status: models.AssessmentStageStatusFinished},
		{Key: models.AssessmentStageScan, Order: 2, Status: models.AssessmentStageStatusRunning},
	}
	target = retryTargetStage(running)
	require.NotNil(t, target)
	assert.Equal(t, models.AssessmentStageScan, target.Key)
	assert.Nil(t, retryTargetStage(nil))
}

func TestStageByKey(t *testing.T) {
	stages := []models.SecurityAssessmentStage{
		{Key: models.AssessmentStageDiscovery, RunID: 11},
		{Key: models.AssessmentStageScan, RunID: 22},
	}

	stage, ok := stageByKey(stages, models.AssessmentStageScan)
	require.True(t, ok)
	assert.Equal(t, uint64(22), stage.RunID)

	_, ok = stageByKey(stages, models.AssessmentStageChain)
	assert.False(t, ok)
}

func TestEncodeDecodeResourceIDs(t *testing.T) {
	assert.Equal(t, "[]", encodeResourceIDs(nil))
	assert.Equal(t, "[7,9]", encodeResourceIDs([]uint64{7, 9}))
	assert.Equal(t, []uint64{7, 9}, decodeResourceIDs("[7,9]"))
	assert.Empty(t, decodeResourceIDs(""))
	assert.Empty(t, decodeResourceIDs("not-json"))
	assert.Empty(t, decodeResourceIDs("[]"))
}

func TestValidateAssessmentRequest(t *testing.T) {
	base := models.CreateSecurityAssessmentRequest{
		Mode:          "automation",
		ScanType:      "traditional",
		Target:        "192.168.1.0/24",
		Profile:       "standard",
		ModelProvider: "deepseek",
	}
	assert.NoError(t, validateAssessmentRequest(base))

	passiveWithoutResource := base
	passiveWithoutResource.ScanType = "passive"
	assert.Error(t, validateAssessmentRequest(passiveWithoutResource))

	passiveWithResource := passiveWithoutResource
	passiveWithResource.ResourceIDs = []uint64{1}
	assert.NoError(t, validateAssessmentRequest(passiveWithResource))

	traditionalWithResource := base
	traditionalWithResource.ResourceIDs = []uint64{1}
	assert.Error(t, validateAssessmentRequest(traditionalWithResource))

	badMode := base
	badMode.Mode = "manual"
	assert.Error(t, validateAssessmentRequest(badMode))

	badProfile := base
	badProfile.Profile = "extreme"
	assert.Error(t, validateAssessmentRequest(badProfile))

	missingProvider := base
	missingProvider.ModelProvider = ""
	assert.Error(t, validateAssessmentRequest(missingProvider))
}

func TestMarkStagePersistsRunningAndFinishedTimestamps(t *testing.T) {
	db := newAssessmentTestDB(t)
	service := newSecurityAssessmentService(db, nil, nil, nil, nil)
	run := seedAssessmentRun(t, db, 42)

	stages, err := service.loadStages(run.ID)
	require.NoError(t, err)
	require.Len(t, stages, 4)
	assert.Equal(t, "资产发现", stages[0].Title)

	require.NoError(t, service.markStage(&stages[0], models.AssessmentStageStatusRunning, 1001, 77, ""))
	running, err := service.loadStages(run.ID)
	require.NoError(t, err)
	assert.Equal(t, models.AssessmentStageStatusRunning, running[0].Status)
	assert.Equal(t, uint64(1001), running[0].FlowID)
	assert.Equal(t, uint64(77), running[0].RunID)
	require.NotNil(t, running[0].StartedAt)
	assert.Nil(t, running[0].FinishedAt)

	require.NoError(t, service.markStage(&running[0], models.AssessmentStageStatusFinished, 0, 0, ""))
	finished, err := service.loadStages(run.ID)
	require.NoError(t, err)
	assert.Equal(t, models.AssessmentStageStatusFinished, finished[0].Status)
	// A finish without an explicit flow keeps the stage flow it already had.
	assert.Equal(t, uint64(1001), finished[0].FlowID)
	require.NotNil(t, finished[0].FinishedAt)
}

func TestResetStageClearsProgress(t *testing.T) {
	db := newAssessmentTestDB(t)
	service := newSecurityAssessmentService(db, nil, nil, nil, nil)
	run := seedAssessmentRun(t, db, 42)

	stages, err := service.loadStages(run.ID)
	require.NoError(t, err)
	require.NoError(t, service.markStage(&stages[1], models.AssessmentStageStatusFailed, 2002, 88, "boom"))

	failed, err := service.loadStages(run.ID)
	require.NoError(t, err)
	require.Equal(t, models.AssessmentStageStatusFailed, failed[1].Status)

	require.NoError(t, service.resetStage(&failed[1]))
	reset, err := service.loadStages(run.ID)
	require.NoError(t, err)
	assert.Equal(t, models.AssessmentStageStatusPending, reset[1].Status)
	assert.Equal(t, uint64(0), reset[1].FlowID)
	assert.Equal(t, uint64(0), reset[1].RunID)
	assert.Empty(t, reset[1].Error)
	assert.Nil(t, reset[1].StartedAt)
	assert.Nil(t, reset[1].FinishedAt)
}

func TestUpdateRunTracksCurrentStageAndFlow(t *testing.T) {
	db := newAssessmentTestDB(t)
	service := newSecurityAssessmentService(db, nil, nil, nil, nil)
	run := seedAssessmentRun(t, db, 42)

	stages, err := service.loadStages(run.ID)
	require.NoError(t, err)
	stage := stages[1]
	stage.FlowID = 555

	require.NoError(t, service.updateRun(&run, models.AssessmentStatusRunning, &stage, ""))
	assert.Equal(t, models.AssessmentStatusRunning, run.Status)
	assert.Equal(t, models.AssessmentStageScan, run.CurrentStage)
	require.NotNil(t, run.FlowID)
	assert.Equal(t, uint64(555), *run.FlowID)

	var stored models.SecurityAssessmentRun
	require.NoError(t, db.Where("id = ?", run.ID).First(&stored).Error)
	assert.Equal(t, models.AssessmentStatusRunning, stored.Status)
	assert.Equal(t, models.AssessmentStageScan, stored.CurrentStage)
	require.NotNil(t, stored.FlowID)
	assert.Equal(t, uint64(555), *stored.FlowID)

	require.NoError(t, service.updateRun(&run, models.AssessmentStatusFinished, nil, ""))
	assert.Empty(t, run.CurrentStage)
	// Finishing must not drop the last stage flow the user may still want to open.
	require.NotNil(t, run.FlowID)
	assert.Equal(t, uint64(555), *run.FlowID)
}

func TestBuildRunViewsGroupsStagesPerRun(t *testing.T) {
	db := newAssessmentTestDB(t)
	service := newSecurityAssessmentService(db, nil, nil, nil, nil)
	first := seedAssessmentRun(t, db, 42)
	second := seedAssessmentRun(t, db, 42)

	views, err := service.buildRunViews(42, []models.SecurityAssessmentRun{first, second})
	require.NoError(t, err)
	require.Len(t, views, 2)
	for _, view := range views {
		require.Len(t, view.Stages, 4)
		assert.Equal(t, models.AssessmentStageDiscovery, view.Stages[0].Key)
		assert.Equal(t, models.AssessmentStagePentest, view.Stages[3].Key)
		assert.Equal(t, "渗透测试", view.Stages[3].Title)
	}
	assert.Equal(t, first.ID, views[0].ID)
	assert.Equal(t, second.ID, views[1].ID)

	// Another user must not see these stages.
	views, err = service.buildRunViews(43, []models.SecurityAssessmentRun{first})
	require.NoError(t, err)
	require.Len(t, views, 1)
	assert.Empty(t, views[0].Stages)
}

func TestFlowStatusReportsProgressAndDeletion(t *testing.T) {
	db := newAssessmentTestDB(t)
	service := newSecurityAssessmentService(db, nil, nil, nil, nil)
	require.NoError(t, db.Exec(`INSERT INTO flows (id, status) VALUES (900, 'finished')`).Error)

	status, err := service.flowStatus(900)
	require.NoError(t, err)
	assert.Equal(t, models.FlowStatusFinished, status)

	_, err = service.flowStatus(901)
	assert.Error(t, err)

	_, err = service.flowStatus(0)
	assert.Error(t, err)

	require.NoError(t, db.Exec(`INSERT INTO flows (id, status, deleted_at) VALUES (902, 'running', ?)`, time.Now()).Error)
	_, err = service.flowStatus(902)
	assert.Error(t, err)
}

func TestBuildPentestPromptCarriesChainGraph(t *testing.T) {
	run := models.SecurityAssessmentRun{
		ID:           31,
		Target:       "example.com",
		Mode:         "automation",
		Instructions: "只做非破坏性验证",
	}
	chainStage := &models.SecurityAssessmentStage{Key: models.AssessmentStageChain, FlowID: 404}
	graph := models.ExploitChainGraph{
		Nodes: []models.ExploitChainGraphNode{{ID: "n1", Label: "入口", Type: "entry"}},
		Edges: []models.ExploitChainGraphEdge{{Source: "n1", Target: "n2", Label: "reachable"}},
	}

	prompt, err := buildPentestPrompt(&run, chainStage, graph)
	require.NoError(t, err)
	assert.Contains(t, prompt, "example.com")
	assert.Contains(t, prompt, "编排记录编号 31")
	assert.Contains(t, prompt, "Flow #404")
	assert.Contains(t, prompt, `"n1"`)
	assert.Contains(t, prompt, "只做非破坏性验证")
	assert.Contains(t, prompt, "自动执行模式")

	interactive := run
	interactive.Mode = "assistant"
	interactive.Instructions = ""
	prompt, err = buildPentestPrompt(&interactive, nil, graph)
	require.NoError(t, err)
	assert.Contains(t, prompt, "交互助手模式")
	assert.Contains(t, prompt, "非破坏性验证")
	assert.Contains(t, prompt, "未记录")
}
