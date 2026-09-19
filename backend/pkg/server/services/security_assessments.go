package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"pentagi/pkg/controller"
	"pentagi/pkg/providers"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/server/models"
	"pentagi/pkg/server/response"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/sirupsen/logrus"
)

// assessmentSchedulerInterval is how often active orchestrations are advanced
// without a browser tab open. The API also advances a run on read, so the
// interval only bounds how late an unattended assessment can become.
const assessmentSchedulerInterval = 30 * time.Second

// SecurityAssessmentService runs the four stages of one authorized assessment:
// asset discovery, vulnerability scanning, exploit chain reasoning and the
// penetration test itself. Every stage owns its flow, and the stage table is the
// single source of truth for progress.
type SecurityAssessmentService struct {
	db        *gorm.DB
	providers providers.ProviderController
	controller controller.FlowController
	discovery *VulnerabilityScanService
	chains    *ExploitChainService
	// mx serializes stage transitions so the scheduler and an API request can
	// never start the same stage twice.
	mx sync.Mutex
}

type assessmentStageDefinition struct {
	Key   string
	Title string
	Order int
}

var assessmentStageDefinitions = []assessmentStageDefinition{
	{Key: models.AssessmentStageDiscovery, Title: "资产发现", Order: 1},
	{Key: models.AssessmentStageScan, Title: "漏洞扫描", Order: 2},
	{Key: models.AssessmentStageChain, Title: "利用链推理", Order: 3},
	{Key: models.AssessmentStagePentest, Title: "渗透测试", Order: 4},
}

// stageOutcome is what one pass over a running stage learned about its flow.
type stageOutcome int

const (
	stageOutcomeRunning stageOutcome = iota
	stageOutcomeWaiting
	stageOutcomeFinished
)

func NewSecurityAssessmentService(
	db *gorm.DB,
	pc providers.ProviderController,
	fc controller.FlowController,
	discovery *VulnerabilityScanService,
	chains *ExploitChainService,
) *SecurityAssessmentService {
	s := newSecurityAssessmentService(db, pc, fc, discovery, chains)
	go s.runScheduler()
	return s
}

func newSecurityAssessmentService(
	db *gorm.DB,
	pc providers.ProviderController,
	fc controller.FlowController,
	discovery *VulnerabilityScanService,
	chains *ExploitChainService,
) *SecurityAssessmentService {
	return &SecurityAssessmentService{db: db, providers: pc, controller: fc, discovery: discovery, chains: chains}
}

// runScheduler keeps unattended orchestrations moving and resumes them after a
// restart, because a stage left running is picked up again from its flow status.
func (s *SecurityAssessmentService) runScheduler() {
	ticker := time.NewTicker(assessmentSchedulerInterval)
	defer ticker.Stop()
	for range ticker.C {
		var runs []models.SecurityAssessmentRun
		query := s.db.Where("status IN (?)", []string{
			models.AssessmentStatusPending,
			models.AssessmentStatusRunning,
			models.AssessmentStatusWaiting,
		}).Order("id ASC").Limit(20)
		if err := query.Find(&runs).Error; err != nil {
			logrus.WithError(err).Warn("failed to load active security assessments")
			continue
		}
		for idx := range runs {
			if err := s.advanceRun(context.Background(), &runs[idx]); err != nil {
				logrus.WithError(err).WithField("assessment_run_id", runs[idx].ID).Warn("scheduled assessment advance failed")
			}
		}
	}
}

func (s *SecurityAssessmentService) List(c *gin.Context) {
	uid := c.GetUint64("uid")
	var runs []models.SecurityAssessmentRun
	if err := s.db.Where("user_id = ?", uid).Order("created_at DESC").Limit(50).Find(&runs).Error; err != nil {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	for idx := range runs {
		if terminalAssessmentStatus(runs[idx].Status) {
			continue
		}
		if err := s.advanceRun(c, &runs[idx]); err != nil {
			logrus.WithError(err).WithField("assessment_run_id", runs[idx].ID).Warn("failed to advance assessment on read")
		}
	}

	views, err := s.buildRunViews(uid, runs)
	if err != nil {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"items": views, "total": len(views)})
}

func (s *SecurityAssessmentService) Get(c *gin.Context) {
	uid := c.GetUint64("uid")
	run, err := s.loadRun(uid, c.Param("id"))
	if err != nil {
		assessmentError(c, http.StatusNotFound, "安全评估编排不存在", err)
		return
	}
	if !terminalAssessmentStatus(run.Status) {
		if err := s.advanceRun(c, run); err != nil {
			logrus.WithError(err).WithField("assessment_run_id", run.ID).Warn("failed to advance assessment on read")
		}
	}
	views, err := s.buildRunViews(uid, []models.SecurityAssessmentRun{*run})
	if err != nil || len(views) == 0 {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	response.Success(c, http.StatusOK, views[0])
}

func (s *SecurityAssessmentService) Create(c *gin.Context) {
	privileges := c.GetStringSlice("prm")
	if !slices.Contains(privileges, "flows.create") {
		response.Error(c, response.ErrNotPermitted, nil)
		return
	}

	var req models.CreateSecurityAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		assessmentError(c, http.StatusBadRequest, "编排参数不完整", err)
		return
	}
	req.Mode = strings.TrimSpace(req.Mode)
	req.ScanType = strings.TrimSpace(req.ScanType)
	req.Target = strings.TrimSpace(req.Target)
	req.Profile = strings.TrimSpace(req.Profile)
	req.ModelProvider = strings.TrimSpace(req.ModelProvider)
	req.Focus = strings.TrimSpace(req.Focus)
	req.Instructions = strings.TrimSpace(req.Instructions)
	if err := validateAssessmentRequest(req); err != nil {
		assessmentError(c, http.StatusBadRequest, err.Error(), err)
		return
	}
	if req.Mode == "assistant" && !slices.Contains(privileges, "assistants.create") {
		response.Error(c, response.ErrNotPermitted, nil)
		return
	}

	uid := c.GetUint64("uid")
	run := models.SecurityAssessmentRun{
		UserID:        uid,
		Mode:          req.Mode,
		ScanType:      req.ScanType,
		Target:        req.Target,
		Profile:       req.Profile,
		Focus:         req.Focus,
		Instructions:  req.Instructions,
		ModelProvider: req.ModelProvider,
		Status:        models.AssessmentStatusPending,
		ResourcesJSON: encodeResourceIDs(req.ResourceIDs),
	}
	if err := s.db.Create(&run).Error; err != nil {
		assessmentError(c, http.StatusInternalServerError, "保存安全评估编排失败", err)
		return
	}
	for _, definition := range assessmentStageDefinitions {
		stage := models.SecurityAssessmentStage{
			AssessmentRunID: run.ID,
			UserID:          uid,
			Key:             definition.Key,
			Order:           definition.Order,
			Status:          models.AssessmentStageStatusPending,
		}
		if err := s.db.Create(&stage).Error; err != nil {
			assessmentError(c, http.StatusInternalServerError, "保存安全评估阶段失败", err)
			return
		}
	}

	// The first stage starts inline so the caller immediately gets the flow that
	// the workbench should open.
	if err := s.advanceRun(c, &run); err != nil {
		if message, isInput := inputErrorMessage(err); isInput {
			assessmentError(c, http.StatusBadRequest, message, err)
			return
		}
		assessmentError(c, http.StatusInternalServerError, "启动安全评估编排失败", err)
		return
	}

	views, err := s.buildRunViews(uid, []models.SecurityAssessmentRun{run})
	if err != nil || len(views) == 0 {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	response.Success(c, http.StatusCreated, views[0])
}

func (s *SecurityAssessmentService) Stop(c *gin.Context) {
	if !slices.Contains(c.GetStringSlice("prm"), "flows.create") {
		response.Error(c, response.ErrNotPermitted, nil)
		return
	}
	uid := c.GetUint64("uid")
	run, err := s.loadRun(uid, c.Param("id"))
	if err != nil {
		assessmentError(c, http.StatusNotFound, "安全评估编排不存在", err)
		return
	}
	if terminalAssessmentStatus(run.Status) {
		assessmentError(c, http.StatusBadRequest, "该编排已经结束", nil)
		return
	}

	s.mx.Lock()
	stages, err := s.loadStages(run.ID)
	if err != nil {
		s.mx.Unlock()
		assessmentError(c, http.StatusInternalServerError, "读取安全评估阶段失败", err)
		return
	}
	active := activeStage(stages)
	if active != nil {
		if active.FlowID != 0 {
			if stopErr := s.controller.StopFlow(c, int64(active.FlowID)); stopErr != nil &&
				!errors.Is(stopErr, controller.ErrFlowAlreadyStopped) {
				logrus.WithError(stopErr).WithField("flow_id", active.FlowID).Warn("failed to stop assessment stage flow")
			}
		}
		if err := s.markStage(active, models.AssessmentStageStatusStopped, 0, 0, "用户停止了编排"); err != nil {
			s.mx.Unlock()
			assessmentError(c, http.StatusInternalServerError, "保存阶段状态失败", err)
			return
		}
	}
	updateErr := s.updateRun(run, models.AssessmentStatusStopped, active, "用户停止了编排")
	s.mx.Unlock()
	if updateErr != nil {
		assessmentError(c, http.StatusInternalServerError, "保存编排状态失败", updateErr)
		return
	}

	views, err := s.buildRunViews(uid, []models.SecurityAssessmentRun{*run})
	if err != nil || len(views) == 0 {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	response.Success(c, http.StatusOK, views[0])
}

func (s *SecurityAssessmentService) Retry(c *gin.Context) {
	if !slices.Contains(c.GetStringSlice("prm"), "flows.create") {
		response.Error(c, response.ErrNotPermitted, nil)
		return
	}
	uid := c.GetUint64("uid")
	run, err := s.loadRun(uid, c.Param("id"))
	if err != nil {
		assessmentError(c, http.StatusNotFound, "安全评估编排不存在", err)
		return
	}
	if !terminalAssessmentStatus(run.Status) {
		assessmentError(c, http.StatusBadRequest, "该编排仍在进行中，无需重试", nil)
		return
	}
	if run.Status == models.AssessmentStatusFinished {
		assessmentError(c, http.StatusBadRequest, "该编排已经完成", nil)
		return
	}

	s.mx.Lock()
	stages, err := s.loadStages(run.ID)
	if err != nil {
		s.mx.Unlock()
		assessmentError(c, http.StatusInternalServerError, "读取安全评估阶段失败", err)
		return
	}
	target := retryTargetStage(stages)
	if target == nil {
		s.mx.Unlock()
		assessmentError(c, http.StatusBadRequest, "没有可以重试的阶段", nil)
		return
	}
	// The retried stage and everything after it must run again from scratch.
	for idx := range stages {
		if stages[idx].Order < target.Order {
			continue
		}
		if err := s.resetStage(&stages[idx]); err != nil {
			s.mx.Unlock()
			assessmentError(c, http.StatusInternalServerError, "重置阶段状态失败", err)
			return
		}
	}
	updateErr := s.updateRun(run, models.AssessmentStatusPending, nil, "")
	advanceErr := error(nil)
	if updateErr == nil {
		// Already holding mx, so continue through the locked path.
		advanceErr = s.advanceRunLocked(c, run)
	}
	s.mx.Unlock()
	if updateErr != nil {
		assessmentError(c, http.StatusInternalServerError, "保存编排状态失败", updateErr)
		return
	}
	if advanceErr != nil {
		if message, isInput := inputErrorMessage(advanceErr); isInput {
			assessmentError(c, http.StatusBadRequest, message, advanceErr)
			return
		}
		assessmentError(c, http.StatusInternalServerError, "重试安全评估编排失败", advanceErr)
		return
	}

	views, err := s.buildRunViews(uid, []models.SecurityAssessmentRun{*run})
	if err != nil || len(views) == 0 {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	response.Success(c, http.StatusOK, views[0])
}

// advanceRun moves one orchestration as far as the underlying flows allow. It
// either starts the next pending stage, records the outcome of the running one,
// or marks the run finished. The returned error is the stage-start failure, so
// the API can answer 400 while the scheduler only logs it.
func (s *SecurityAssessmentService) advanceRun(ctx context.Context, run *models.SecurityAssessmentRun) error {
	s.mx.Lock()
	defer s.mx.Unlock()
	return s.advanceRunLocked(ctx, run)
}

func (s *SecurityAssessmentService) advanceRunLocked(ctx context.Context, run *models.SecurityAssessmentRun) error {
	if terminalAssessmentStatus(run.Status) {
		return nil
	}
	stages, err := s.loadStages(run.ID)
	if err != nil {
		return err
	}

	for idx := range stages {
		stage := stages[idx]
		switch stage.Status {
		case models.AssessmentStageStatusFinished, models.AssessmentStageStatusSkipped:
			continue

		case models.AssessmentStageStatusFailed, models.AssessmentStageStatusStopped:
			// Waiting for an explicit retry; the run status already says so.
			return nil

		case models.AssessmentStageStatusRunning, models.AssessmentStageStatusWaiting:
			outcome, outcomeErr := s.refreshRunningStage(run, &stage, stages)
			if outcomeErr != nil {
				return s.failStage(run, &stage, outcomeErr)
			}
			if outcome == stageOutcomeFinished {
				continue
			}
			return s.updateRun(run, runStatusForOutcome(outcome), &stage, "")

		case models.AssessmentStageStatusPending:
			if err := s.startStage(ctx, run, stages, &stage); err != nil {
				return s.failStage(run, &stage, err)
			}
			return s.updateRun(run, models.AssessmentStatusRunning, &stage, "")

		default:
			return fmt.Errorf("阶段 %s 状态无效: %s", stage.Key, stage.Status)
		}
	}

	return s.updateRun(run, models.AssessmentStatusFinished, nil, "")
}

// refreshRunningStage reads the flow behind a running stage and completes the
// stage when that flow is finished.
func (s *SecurityAssessmentService) refreshRunningStage(
	run *models.SecurityAssessmentRun,
	stage *models.SecurityAssessmentStage,
	stages []models.SecurityAssessmentStage,
) (stageOutcome, error) {
	status, err := s.flowStatus(stage.FlowID)
	if err != nil {
		return stageOutcomeRunning, err
	}
	switch status {
	case models.FlowStatusFinished:
		if err := s.completeStage(run, stage, stages); err != nil {
			return stageOutcomeRunning, err
		}
		return stageOutcomeFinished, nil
	case models.FlowStatusFailed:
		return stageOutcomeRunning, errors.New("阶段任务执行失败")
	case models.FlowStatusWaiting:
		return stageOutcomeWaiting, nil
	default:
		return stageOutcomeRunning, nil
	}
}

// completeStage validates the stage output and marks the stage finished.
func (s *SecurityAssessmentService) completeStage(
	run *models.SecurityAssessmentRun,
	stage *models.SecurityAssessmentStage,
	stages []models.SecurityAssessmentStage,
) error {
	switch stage.Key {
	case models.AssessmentStageDiscovery:
		// Importing here gives the scan stage a structured asset list instead of
		// raw flow text, and fails fast when discovery found nothing usable.
		if err := s.discovery.syncFinishedDiscoveries(run.UserID); err != nil {
			return fmt.Errorf("导入资产清单失败: %w", err)
		}
		assetIDs, err := s.discovery.activeAssetIDsForDiscovery(run.UserID, stage.RunID)
		if err != nil {
			return fmt.Errorf("读取资产清单失败: %w", err)
		}
		if len(assetIDs) == 0 {
			return errors.New("资产发现没有产出可用的存活资产")
		}
	case models.AssessmentStageChain:
		if _, err := s.chains.loadGraph(stage.FlowID); err != nil {
			return fmt.Errorf("利用链推理结果中没有结构化图谱: %w", err)
		}
	}
	return s.markStage(stage, models.AssessmentStageStatusFinished, 0, 0, "")
}

// startStage creates the flow (and the stage record) for one definition.
func (s *SecurityAssessmentService) startStage(
	ctx context.Context,
	run *models.SecurityAssessmentRun,
	stages []models.SecurityAssessmentStage,
	stage *models.SecurityAssessmentStage,
) error {
	switch stage.Key {
	case models.AssessmentStageDiscovery:
		discoveryRun, err := s.discovery.CreateDiscoveryRun(ctx, run.UserID, []string{"flows.create"}, models.CreateAssetDiscoveryRequest{
			DiscoveryType: run.ScanType,
			ModelProvider: run.ModelProvider,
			Profile:       run.Profile,
			ResourceIDs:   decodeResourceIDs(run.ResourcesJSON),
			Target:        run.Target,
		})
		if err != nil {
			return err
		}
		return s.markStage(stage, models.AssessmentStageStatusRunning, discoveryRun.FlowID, discoveryRun.ID, "")

	case models.AssessmentStageScan:
		discoveryStage, ok := stageByKey(stages, models.AssessmentStageDiscovery)
		if !ok || discoveryStage.RunID == 0 {
			return errors.New("资产发现阶段没有产生可用的记录")
		}
		assetIDs, err := s.discovery.activeAssetIDsForDiscovery(run.UserID, discoveryStage.RunID)
		if err != nil {
			return fmt.Errorf("读取资产清单失败: %w", err)
		}
		if len(assetIDs) == 0 {
			return newInputError("资产发现没有产出可扫描的存活资产", nil)
		}
		scanRun, err := s.discovery.CreateScanRun(ctx, run.UserID, models.CreateVulnerabilityScanRequest{
			ModelProvider: run.ModelProvider,
			Profile:       run.Profile,
			AssetIDs:      assetIDs,
		})
		if err != nil {
			return err
		}
		return s.markStage(stage, models.AssessmentStageStatusRunning, scanRun.FlowID, scanRun.ID, "")

	case models.AssessmentStageChain:
		scanStage, ok := stageByKey(stages, models.AssessmentStageScan)
		if !ok || scanStage.RunID == 0 {
			return errors.New("漏洞扫描阶段没有产生可用的记录")
		}
		focus := strings.TrimSpace(run.Focus)
		if focus == "" {
			focus = "分析所有有证据支持的攻击路径"
		}
		chainRun, err := s.chains.CreateChainRun(ctx, run.UserID, models.CreateExploitChainRequest{
			ModelProvider: run.ModelProvider,
			SourceScanID:  scanStage.RunID,
			Focus:         focus,
		})
		if err != nil {
			return err
		}
		return s.markStage(stage, models.AssessmentStageStatusRunning, chainRun.FlowID, chainRun.ID, "")

	case models.AssessmentStagePentest:
		chainStage, ok := stageByKey(stages, models.AssessmentStageChain)
		if !ok || chainStage.FlowID == 0 {
			return errors.New("利用链推理阶段没有产生可用的记录")
		}
		graph, err := s.chains.loadGraph(chainStage.FlowID)
		if err != nil {
			return newInputError("利用链推理结果中没有结构化图谱", err)
		}
		flowID, err := s.startPentestFlow(ctx, run, &chainStage, graph)
		if err != nil {
			return err
		}
		return s.markStage(stage, models.AssessmentStageStatusRunning, flowID, 0, "")
	}

	return fmt.Errorf("未知的评估阶段: %s", stage.Key)
}

// startPentestFlow creates the verification flow. It is the only stage that
// honours the requested execution mode; the earlier stages are always automatic.
func (s *SecurityAssessmentService) startPentestFlow(
	ctx context.Context,
	run *models.SecurityAssessmentRun,
	chainStage *models.SecurityAssessmentStage,
	graph models.ExploitChainGraph,
) (uint64, error) {
	prompt, err := buildPentestPrompt(run, chainStage, graph)
	if err != nil {
		return 0, err
	}
	providerName := provider.ProviderName(run.ModelProvider)
	selectedProvider, err := s.providers.GetProvider(ctx, providerName, int64(run.UserID))
	if err != nil {
		return 0, newInputError("所选模型服务不可用", err)
	}
	if run.Mode == "assistant" {
		assistant, err := s.controller.CreateAssistant(
			ctx, int64(run.UserID), 0, prompt, true, providerName, selectedProvider.Type(), nil, nil,
		)
		if err != nil {
			return 0, fmt.Errorf("创建渗透测试助手会话失败: %w", err)
		}
		return uint64(assistant.GetFlowID()), nil
	}
	flowID, err := s.controller.CreateFlow(ctx, int64(run.UserID), prompt, providerName, selectedProvider.Type(), nil, nil)
	if err != nil {
		return 0, fmt.Errorf("创建渗透测试任务失败: %w", err)
	}
	return uint64(flowID), nil
}

func (s *SecurityAssessmentService) failStage(
	run *models.SecurityAssessmentRun,
	stage *models.SecurityAssessmentStage,
	cause error,
) error {
	message := cause.Error()
	if err := s.markStage(stage, models.AssessmentStageStatusFailed, 0, 0, message); err != nil {
		logrus.WithError(err).WithField("assessment_run_id", run.ID).Warn("failed to record stage failure")
	}
	if err := s.updateRun(run, models.AssessmentStatusFailed, stage, message); err != nil {
		return err
	}
	// The stage failure is the reportable cause, not the bookkeeping error.
	return cause
}

func (s *SecurityAssessmentService) markStage(
	stage *models.SecurityAssessmentStage,
	status string,
	flowID, runID uint64,
	message string,
) error {
	updates := map[string]any{"status": status, "error": message}
	if flowID != 0 {
		updates["flow_id"] = flowID
	}
	if runID != 0 {
		updates["run_id"] = runID
	}
	now := time.Now()
	switch status {
	case models.AssessmentStageStatusRunning:
		updates["started_at"] = now
		updates["finished_at"] = nil
	case models.AssessmentStageStatusFinished, models.AssessmentStageStatusFailed,
		models.AssessmentStageStatusSkipped, models.AssessmentStageStatusStopped:
		updates["finished_at"] = now
	}
	if err := s.db.Model(&models.SecurityAssessmentStage{}).Where("id = ?", stage.ID).Updates(updates).Error; err != nil {
		return err
	}
	stage.Status = status
	stage.Error = message
	if flowID != 0 {
		stage.FlowID = flowID
	}
	if runID != 0 {
		stage.RunID = runID
	}
	return nil
}

func (s *SecurityAssessmentService) resetStage(stage *models.SecurityAssessmentStage) error {
	updates := map[string]any{
		"status":      models.AssessmentStageStatusPending,
		"error":       "",
		"run_id":      0,
		"flow_id":     0,
		"started_at":  nil,
		"finished_at": nil,
	}
	if err := s.db.Model(&models.SecurityAssessmentStage{}).Where("id = ?", stage.ID).Updates(updates).Error; err != nil {
		return err
	}
	stage.Status = models.AssessmentStageStatusPending
	stage.Error = ""
	stage.RunID = 0
	stage.FlowID = 0
	stage.StartedAt = nil
	stage.FinishedAt = nil
	return nil
}

func (s *SecurityAssessmentService) updateRun(
	run *models.SecurityAssessmentRun,
	status string,
	stage *models.SecurityAssessmentStage,
	message string,
) error {
	currentStage := ""
	updates := map[string]any{"status": status, "error": message}
	if stage != nil {
		currentStage = stage.Key
		if stage.FlowID != 0 {
			updates["flow_id"] = stage.FlowID
		}
	}
	updates["current_stage"] = currentStage
	if err := s.db.Model(&models.SecurityAssessmentRun{}).Where("id = ?", run.ID).Updates(updates).Error; err != nil {
		return err
	}
	run.Status = status
	run.CurrentStage = currentStage
	run.Error = message
	if stage != nil && stage.FlowID != 0 {
		flowID := stage.FlowID
		run.FlowID = &flowID
	}
	return nil
}

func (s *SecurityAssessmentService) loadRun(uid uint64, rawID string) (*models.SecurityAssessmentRun, error) {
	runID, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || runID == 0 {
		return nil, errors.New("编排记录编号无效")
	}
	var run models.SecurityAssessmentRun
	err = s.db.Where("id = ? AND user_id = ?", runID, uid).First(&run).Error
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (s *SecurityAssessmentService) loadStages(runID uint64) ([]models.SecurityAssessmentStage, error) {
	stages := make([]models.SecurityAssessmentStage, 0, len(assessmentStageDefinitions))
	if err := s.db.Where("assessment_run_id = ?", runID).Order("stage_order ASC").Find(&stages).Error; err != nil {
		return nil, err
	}
	for idx := range stages {
		stages[idx].Title = assessmentStageTitle(stages[idx].Key)
	}
	return stages, nil
}

func (s *SecurityAssessmentService) buildRunViews(
	uid uint64,
	runs []models.SecurityAssessmentRun,
) ([]models.SecurityAssessmentRunView, error) {
	views := make([]models.SecurityAssessmentRunView, 0, len(runs))
	if len(runs) == 0 {
		return views, nil
	}
	runIDs := make([]uint64, 0, len(runs))
	for idx := range runs {
		runIDs = append(runIDs, runs[idx].ID)
	}
	var stages []models.SecurityAssessmentStage
	if err := s.db.Where("assessment_run_id IN (?) AND user_id = ?", runIDs, uid).
		Order("assessment_run_id ASC, stage_order ASC").Find(&stages).Error; err != nil {
		return nil, err
	}
	byRun := make(map[uint64][]models.SecurityAssessmentStage, len(runs))
	for idx := range stages {
		stages[idx].Title = assessmentStageTitle(stages[idx].Key)
		byRun[stages[idx].AssessmentRunID] = append(byRun[stages[idx].AssessmentRunID], stages[idx])
	}
	for idx := range runs {
		views = append(views, models.SecurityAssessmentRunView{
			SecurityAssessmentRun: runs[idx],
			Stages:                byRun[runs[idx].ID],
		})
	}
	return views, nil
}

func (s *SecurityAssessmentService) flowStatus(flowID uint64) (models.FlowStatus, error) {
	if flowID == 0 {
		return "", errors.New("阶段任务还没有创建")
	}
	var row struct {
		Status    models.FlowStatus
		DeletedAt *time.Time
	}
	if err := s.db.Raw(`SELECT status, deleted_at FROM flows WHERE id = ?`, flowID).Scan(&row).Error; err != nil {
		return "", err
	}
	if row.Status == "" {
		return "", gorm.ErrRecordNotFound
	}
	if row.DeletedAt != nil {
		return "", errors.New("阶段任务已被删除")
	}
	return row.Status, nil
}

func validateAssessmentRequest(req models.CreateSecurityAssessmentRequest) error {
	if !validChoice(req.Mode, "automation", "assistant") {
		return errors.New("执行方式无效")
	}
	if !validChoice(req.ScanType, "passive", "traditional") {
		return errors.New("资产发现方式无效")
	}
	if !validChoice(req.Profile, "quick", "standard", "deep") {
		return errors.New("扫描强度无效")
	}
	if req.ModelProvider == "" {
		return errors.New("请选择模型服务")
	}
	if req.Target == "" || len(req.Target) > 500 || !scanTargetPattern.MatchString(req.Target) {
		return errors.New("请输入有效的域名、IP、网段或 URL，且一次只能填写一个目标")
	}
	if req.ScanType == "passive" && len(req.ResourceIDs) != 1 {
		return errors.New("被动式资产发现必须选择一个流量文件")
	}
	if req.ScanType == "traditional" && len(req.ResourceIDs) != 0 {
		return errors.New("主动式资产发现不需要流量文件")
	}
	if len(req.Focus) > 2000 || len(req.Instructions) > 4000 {
		return errors.New("利用链重点或渗透测试要求过长")
	}
	return nil
}

// buildPentestPrompt hands the validated chain graph to the verification flow so
// stage four starts from reasoning that already happened instead of re-deriving it.
func buildPentestPrompt(
	run *models.SecurityAssessmentRun,
	chainStage *models.SecurityAssessmentStage,
	graph models.ExploitChainGraph,
) (string, error) {
	graphJSON, err := json.Marshal(graph)
	if err != nil {
		return "", fmt.Errorf("序列化漏洞利用链图谱失败: %w", err)
	}
	instructions := strings.TrimSpace(run.Instructions)
	if instructions == "" {
		instructions = "在授权范围内验证利用链的可达性，优先采用非破坏性验证。"
	}
	decisionPolicy := `这是自动执行模式。你可以在授权范围和安全限制内自主选择下一步，但必须在任务日志中说明选择依据、备选方案和结果，不得隐藏或省略关键判断。`
	if run.Mode == "assistant" {
		decisionPolicy = `这是交互助手模式。常规的只读收集可以继续执行；遇到范围扩展、主动利用、凭据使用、权限提升、横向移动、可能影响服务的操作，或存在多个明显不同的验证方案时，必须暂停相关操作，通过助手向用户列出证据、风险和可选方案，等待用户明确选择后再继续。不得代替用户作出这些决定。`
	}

	return fmt.Sprintf(`执行已授权的渗透测试验证，范围：%s。

本阶段是四阶段安全评估编排的最后一步，前三个阶段（资产发现、漏洞扫描、利用链推理）已完成，编排记录编号 %d。
利用链来源：%s

以下是通过校验的漏洞利用链图谱，请以这些证据为起点开展验证，不得虚构不存在的资产、端口或漏洞：
%s

要求：
1. 只对图谱中已确认且位于授权范围内的目标执行操作，不扩展新的网段、子域或未知资产。
2. 优先进行非破坏性验证，记录每条结论对应的命令、原始输出和证据。
3. 禁止拒绝服务、数据破坏、持久化、口令爆破和无关扩展。
4. 区分已确认、疑似、被排除和证据不足四种结论，说明尚未验证的环节和阻断点。
5. 最终报告包含资产清单、漏洞证据、利用链、实际验证结果、未验证项、阻断点和修复建议。

%s

本次渗透测试要求：
%s`, run.Target, run.ID, stageFlowTitle(chainStage), string(graphJSON), decisionPolicy, instructions), nil
}

func stageFlowTitle(stage *models.SecurityAssessmentStage) string {
	if stage == nil || stage.FlowID == 0 {
		return "未记录"
	}
	return fmt.Sprintf("%s（Flow #%d）", assessmentStageTitle(stage.Key), stage.FlowID)
}

func assessmentStageTitle(key string) string {
	for _, definition := range assessmentStageDefinitions {
		if definition.Key == key {
			return definition.Title
		}
	}
	return key
}

func terminalAssessmentStatus(status string) bool {
	switch status {
	case models.AssessmentStatusFinished, models.AssessmentStatusFailed, models.AssessmentStatusStopped:
		return true
	default:
		return false
	}
}

func runStatusForOutcome(outcome stageOutcome) string {
	if outcome == stageOutcomeWaiting {
		return models.AssessmentStatusWaiting
	}
	return models.AssessmentStatusRunning
}

func activeStage(stages []models.SecurityAssessmentStage) *models.SecurityAssessmentStage {
	for idx := range stages {
		switch stages[idx].Status {
		case models.AssessmentStageStatusFinished, models.AssessmentStageStatusSkipped:
			continue
		default:
			return &stages[idx]
		}
	}
	return nil
}

func retryTargetStage(stages []models.SecurityAssessmentStage) *models.SecurityAssessmentStage {
	for idx := range stages {
		switch stages[idx].Status {
		case models.AssessmentStageStatusFailed, models.AssessmentStageStatusStopped:
			return &stages[idx]
		}
	}
	return activeStage(stages)
}

func stageByKey(stages []models.SecurityAssessmentStage, key string) (models.SecurityAssessmentStage, bool) {
	for idx := range stages {
		if stages[idx].Key == key {
			return stages[idx], true
		}
	}
	return models.SecurityAssessmentStage{}, false
}

func encodeResourceIDs(ids []uint64) string {
	if len(ids) == 0 {
		return "[]"
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func decodeResourceIDs(raw string) []uint64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var ids []uint64
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	return ids
}

func assessmentError(c *gin.Context, status int, message string, err error) {
	response.Error(c, response.NewHttpError(status, "SecurityAssessmentError", message), err)
}
