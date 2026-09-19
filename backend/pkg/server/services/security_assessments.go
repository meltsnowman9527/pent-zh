package services

import (
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"pentagi/pkg/controller"
	"pentagi/pkg/providers"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/server/logger"
	"pentagi/pkg/server/models"
	"pentagi/pkg/server/response"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
)

type SecurityAssessmentService struct {
	db         *gorm.DB
	providers  providers.ProviderController
	controller controller.FlowController
}

type assessmentTaskProbe struct {
	Title  string
	Status string
}

func NewSecurityAssessmentService(
	db *gorm.DB,
	pc providers.ProviderController,
	fc controller.FlowController,
) *SecurityAssessmentService {
	return &SecurityAssessmentService{db: db, providers: pc, controller: fc}
}

func (s *SecurityAssessmentService) List(c *gin.Context) {
	uid := c.GetUint64("uid")
	var runs []models.SecurityAssessmentRunView
	query := `SELECT run.id, run.user_id, run.flow_id, run.mode, run.scan_type, run.target,
                    run.profile, run.focus, run.instructions, run.created_at, run.updated_at,
                    flows.status, flows.title
               FROM security_assessment_runs run
               JOIN flows ON flows.id = run.flow_id
              WHERE run.user_id = ? AND flows.deleted_at IS NULL
              ORDER BY run.created_at DESC
              LIMIT 50`
	if err := s.db.Raw(query, uid).Scan(&runs).Error; err != nil {
		assessmentError(c, http.StatusInternalServerError, "读取安全评估编排失败", err)
		return
	}
	for idx := range runs {
		runs[idx].Stages, runs[idx].CurrentStage = s.stageProgress(runs[idx].FlowID, runs[idx].Status)
	}
	response.Success(c, http.StatusOK, gin.H{"items": runs, "total": len(runs)})
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
	dbResources, err := validateServiceResources(s.db, uid, privileges, req.ResourceIDs)
	if err != nil {
		assessmentError(c, http.StatusBadRequest, "所选流量文件不可用", err)
		return
	}
	if req.ScanType == "passive" && (len(dbResources) != 1 || dbResources[0].IsDir || !isTrafficCapture(dbResources[0].Name)) {
		err = errors.New("被动式编排只能使用一个 PCAP、PCAPNG 或 CAP 流量文件")
		assessmentError(c, http.StatusBadRequest, err.Error(), err)
		return
	}

	providerName := provider.ProviderName(req.ModelProvider)
	selectedProvider, err := s.providers.GetProvider(c, providerName, int64(uid))
	if err != nil {
		assessmentError(c, http.StatusBadRequest, "所选模型服务不可用", err)
		return
	}

	prompt := buildSecurityAssessmentPrompt(req)
	var flowID int64
	if req.Mode == "assistant" {
		assistant, createErr := s.controller.CreateAssistant(
			c, int64(uid), 0, prompt, true, providerName, selectedProvider.Type(), nil, dbResources,
		)
		if createErr != nil {
			err = createErr
		} else {
			flowID = assistant.GetFlowID()
		}
	} else {
		flowID, err = s.controller.CreateFlow(
			c, int64(uid), prompt, providerName, selectedProvider.Type(), nil, dbResources,
		)
	}
	if err != nil {
		logger.FromContext(c).WithError(err).Error("failed to create security assessment orchestration")
		assessmentError(c, http.StatusInternalServerError, "启动安全评估编排失败", err)
		return
	}

	run := models.SecurityAssessmentRun{
		UserID: uid, FlowID: uint64(flowID), Mode: req.Mode, ScanType: req.ScanType,
		Target: req.Target, Profile: req.Profile, Focus: req.Focus, Instructions: req.Instructions,
	}
	if err := s.db.Create(&run).Error; err != nil {
		assessmentError(c, http.StatusInternalServerError, "任务已启动，但保存编排记录失败", err)
		return
	}

	view := models.SecurityAssessmentRunView{SecurityAssessmentRun: run, Status: models.FlowStatusCreated}
	view.Stages, view.CurrentStage = s.stageProgress(run.FlowID, view.Status)
	response.Success(c, http.StatusCreated, view)
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
	if len(req.Focus) > 2000 || len(req.Instructions) > 4000 {
		return errors.New("利用链重点或渗透测试要求过长")
	}
	return nil
}

func buildSecurityAssessmentPrompt(req models.CreateSecurityAssessmentRequest) string {
	scanMethod := "传统主动资产发现"
	if req.ScanType == "passive" {
		scanMethod = "流量被动发现，并在授权范围内进行主动补全"
	}
	profile := map[string]string{"quick": "快速", "standard": "标准", "deep": "深入"}[req.Profile]
	focus := req.Focus
	if focus == "" {
		focus = "分析所有有证据支持的攻击路径"
	}
	instructions := req.Instructions
	if instructions == "" {
		instructions = "在授权范围内验证利用链的可达性，优先采用非破坏性验证"
	}
	decisionPolicy := `这是自动执行模式。你可以在授权范围和安全限制内自主选择下一步，但必须在任务日志中说明选择依据、备选方案和结果，不得隐藏或省略关键判断。`
	if req.Mode == "assistant" {
		decisionPolicy = `这是交互助手模式。常规的只读收集可以继续执行；遇到范围扩展、主动利用、凭据使用、权限提升、横向移动、可能影响服务的操作，或存在多个明显不同的验证方案时，必须暂停相关操作，通过助手向用户列出证据、风险和可选方案，等待用户明确选择后再继续。不得代替用户作出这些决定。`
	}

	return fmt.Sprintf(`执行一次完整、已授权的安全评估编排。目标范围：%s。

本次执行必须保持全过程可观察。必须为以下四个阶段分别创建独立任务，不得把全部工作合并成一个任务；标题必须分别以“阶段1-资产发现”“阶段2-漏洞扫描”“阶段3-利用链推理”“阶段4-渗透测试”开头。在每个阶段内按实际工作拆分子任务并使用智能体执行，使用户能在任务、智能体、终端、搜索、文件和截图页面查看过程。

每次关键行动都要留下可读记录：行动目标、使用的工具或智能体、输入范围、关键原始证据、结果摘要、判断依据和下一步。失败、跳过、证据不足和等待用户决定的事项也必须明确记录，不得只给最终结论。

阶段1-资产发现：使用%s，识别资产、主机、域名、端口、服务、版本、技术栈和网络关系。被动发现必须与主动确认明确区分。
阶段2-漏洞扫描：采用%s强度，对阶段1确认的资产执行匹配的非破坏性漏洞检测，复核关键结果，记录 CVE/CWE、风险、证据和影响资产。
阶段3-利用链推理：基于前两阶段的真实证据构建入口、横向移动、权限提升、关键目标和影响之间的漏洞利用链。分析重点：%s。不得虚构缺失证据。
阶段4-渗透测试：%s。只对已确认且位于授权范围内的目标执行；禁止拒绝服务、破坏数据、持久化和无关扩展。

%s

每个阶段结束后先在对应任务中整理输入、执行过程、证据、发现、未完成项和向下一阶段交付的内容，再进入下一阶段。最终报告必须包含资产清单、漏洞证据、利用链、实际验证结果、用户决策记录、未验证项、阻断点和修复建议。`, req.Target, scanMethod, profile, focus, instructions, decisionPolicy)
}

func (s *SecurityAssessmentService) stageProgress(
	flowID uint64,
	flowStatus models.FlowStatus,
) ([]models.SecurityAssessmentStage, string) {
	stages := []models.SecurityAssessmentStage{
		{Key: "discovery", Title: "资产发现", Status: "pending"},
		{Key: "scan", Title: "漏洞扫描", Status: "pending"},
		{Key: "chain", Title: "利用链推理", Status: "pending"},
		{Key: "pentest", Title: "渗透测试", Status: "pending"},
	}
	if flowStatus == models.FlowStatusFinished {
		for idx := range stages {
			stages[idx].Status = "finished"
		}
		return stages, "done"
	}

	var tasks []assessmentTaskProbe
	_ = s.db.Raw(`SELECT title, status::text AS status FROM tasks WHERE flow_id = ? ORDER BY created_at`, flowID).
		Scan(&tasks).Error
	highest := 0
	currentStatus := "running"
	for _, task := range tasks {
		stageIndex := assessmentStageIndex(task.Title)
		if stageIndex < highest {
			continue
		}
		highest = stageIndex
		currentStatus = task.Status
	}
	if highest < 0 {
		highest = 0
	}
	for idx := 0; idx < highest; idx++ {
		stages[idx].Status = "finished"
	}

	if flowStatus == models.FlowStatusFailed || currentStatus == "failed" {
		stages[highest].Status = "failed"
		return stages, stages[highest].Key
	}
	if currentStatus == "finished" && highest < len(stages)-1 {
		stages[highest].Status = "finished"
		highest++
		currentStatus = "running"
	}
	if flowStatus == models.FlowStatusWaiting || currentStatus == "waiting" {
		currentStatus = "waiting"
	} else if currentStatus == "created" {
		currentStatus = "running"
	}
	stages[highest].Status = currentStatus
	return stages, stages[highest].Key
}

func assessmentStageIndex(title string) int {
	switch {
	case strings.Contains(title, "阶段4"):
		return 3
	case strings.Contains(title, "阶段3"):
		return 2
	case strings.Contains(title, "阶段2"):
		return 1
	default:
		return 0
	}
}

func assessmentError(c *gin.Context, status int, message string, err error) {
	response.Error(c, response.NewHttpError(status, "SecurityAssessmentError", message), err)
}
