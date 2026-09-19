package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"pentagi/pkg/providers/provider"
	"pentagi/pkg/server/logger"
	"pentagi/pkg/server/models"
	"pentagi/pkg/server/response"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/sirupsen/logrus"
)

var assetInventoryPattern = regexp.MustCompile(`(?s)<asset_inventory>\s*(\{.*?\})\s*</asset_inventory>`)

type assetInventoryDocument struct {
	Assets []assetInventoryRecord `json:"assets"`
}

type assetInventoryRecord struct {
	Address         string                        `json:"address"`
	AssetType       string                        `json:"asset_type"`
	Confidence      string                        `json:"confidence"`
	Evidence        string                        `json:"evidence"`
	Exposure        string                        `json:"exposure"`
	Name            string                        `json:"name"`
	OperatingSystem string                        `json:"operating_system"`
	Services        []assetInventoryServiceRecord `json:"services"`
	Status          string                        `json:"status"`
}

type assetInventoryServiceRecord struct {
	Port      int    `json:"port"`
	Product   string `json:"product"`
	Service   string `json:"service"`
	State     string `json:"state"`
	Transport string `json:"transport"`
	Version   string `json:"version"`
}

func (s *VulnerabilityScanService) ListAssets(c *gin.Context) {
	uid := c.GetUint64("uid")
	if err := s.syncFinishedDiscoveries(uid); err != nil {
		logger.FromContext(c).WithError(err).Warn("failed to synchronize discovered assets")
	}
	var assets []models.DiscoveredAsset
	if err := s.db.Where("user_id = ?", uid).Order("last_seen_at DESC, address ASC").Find(&assets).Error; err != nil {
		scanError(c, http.StatusInternalServerError, "读取资产清单失败", err)
		return
	}
	if len(assets) > 0 {
		ids := make([]uint64, 0, len(assets))
		for _, asset := range assets {
			ids = append(ids, asset.ID)
		}
		var services []models.DiscoveredAssetService
		if err := s.db.Where("asset_id IN (?)", ids).Order("asset_id ASC, port ASC").Find(&services).Error; err != nil {
			scanError(c, http.StatusInternalServerError, "读取资产服务失败", err)
			return
		}
		byAsset := make(map[uint64][]models.DiscoveredAssetService)
		for _, service := range services {
			byAsset[service.AssetID] = append(byAsset[service.AssetID], service)
		}
		for index := range assets {
			assets[index].Services = byAsset[assets[index].ID]
		}
	}
	response.Success(c, http.StatusOK, gin.H{"items": assets, "total": len(assets)})
}

func (s *VulnerabilityScanService) ListDiscoveries(c *gin.Context) {
	uid := c.GetUint64("uid")
	if err := s.syncFinishedDiscoveries(uid); err != nil {
		logger.FromContext(c).WithError(err).Warn("failed to synchronize discovery results")
	}
	var runs []models.AssetDiscoveryRunView
	query := `SELECT discovery.id, discovery.flow_id, discovery.discovery_type, discovery.target,
             discovery.profile, flows.status, flows.title, discovery.import_error,
             discovery.created_at, flows.updated_at,
             (SELECT COUNT(*) FROM discovered_assets asset WHERE asset.discovery_run_id = discovery.id) AS asset_count
        FROM asset_discovery_runs discovery
        JOIN flows ON flows.id = discovery.flow_id
       WHERE discovery.user_id = ? AND flows.deleted_at IS NULL
       ORDER BY discovery.created_at DESC
       LIMIT 100`
	if err := s.db.Raw(query, uid).Scan(&runs).Error; err != nil {
		scanError(c, http.StatusInternalServerError, "读取资产发现记录失败", err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"items": runs, "total": len(runs)})
}

func (s *VulnerabilityScanService) CreateDiscovery(c *gin.Context) {
	if !hasPermission(c, "flows.create") {
		response.Error(c, response.ErrNotPermitted, nil)
		return
	}
	var req models.CreateAssetDiscoveryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		scanError(c, http.StatusBadRequest, "资产发现参数不完整", err)
		return
	}
	run, err := s.CreateDiscoveryRun(c, c.GetUint64("uid"), c.GetStringSlice("prm"), req)
	if err != nil {
		if message, isInput := inputErrorMessage(err); isInput {
			scanError(c, http.StatusBadRequest, message, err)
			return
		}
		logger.FromContext(c).WithError(err).Error("failed to start asset discovery flow")
		scanError(c, http.StatusInternalServerError, "创建资产发现任务失败", err)
		return
	}
	response.Success(c, http.StatusCreated, run)
}

// CreateDiscoveryRun starts an asset discovery flow. The REST handler and the
// security assessment orchestrator share it, so it works with any context.
func (s *VulnerabilityScanService) CreateDiscoveryRun(
	ctx context.Context,
	uid uint64,
	privileges []string,
	req models.CreateAssetDiscoveryRequest,
) (models.AssetDiscoveryRun, error) {
	req.Target = strings.TrimSpace(req.Target)
	req.ModelProvider = strings.TrimSpace(req.ModelProvider)
	if err := validateDiscoveryRequest(req); err != nil {
		return models.AssetDiscoveryRun{}, newInputError(err.Error(), nil)
	}
	resources, err := validateServiceResources(s.db, uid, privileges, req.ResourceIDs)
	if err != nil {
		return models.AssetDiscoveryRun{}, newInputError("所选流量文件不可用", err)
	}
	if req.DiscoveryType == "passive" && (len(resources) != 1 || resources[0].IsDir || !isTrafficCapture(resources[0].Name)) {
		return models.AssetDiscoveryRun{}, newInputError("被动发现只能使用一个 PCAP、PCAPNG 或 CAP 流量文件", nil)
	}
	providerName := provider.ProviderName(req.ModelProvider)
	selectedProvider, err := s.providers.GetProvider(ctx, providerName, int64(uid))
	if err != nil {
		return models.AssetDiscoveryRun{}, newInputError("所选模型服务不可用", err)
	}
	flowID, err := s.controller.CreateFlow(ctx, int64(uid), buildDiscoveryPrompt(req), providerName, selectedProvider.Type(), nil, resources)
	if err != nil {
		return models.AssetDiscoveryRun{}, fmt.Errorf("创建资产发现任务失败: %w", err)
	}
	run := models.AssetDiscoveryRun{UserID: uid, FlowID: uint64(flowID), DiscoveryType: req.DiscoveryType, Target: req.Target, Profile: req.Profile}
	if err := s.db.Create(&run).Error; err != nil {
		return models.AssetDiscoveryRun{}, fmt.Errorf("资产发现任务已创建，但保存记录失败: %w", err)
	}
	return run, nil
}

func hasPermission(c *gin.Context, permission string) bool {
	for _, candidate := range c.GetStringSlice("prm") {
		if candidate == permission {
			return true
		}
	}
	return false
}

func validateDiscoveryRequest(req models.CreateAssetDiscoveryRequest) error {
	if !validChoice(req.DiscoveryType, "passive", "traditional") {
		return errors.New("资产发现方式无效")
	}
	if !validChoice(req.Profile, "quick", "standard", "deep") {
		return errors.New("发现强度无效")
	}
	if req.Target == "" || len(req.Target) > 500 || !scanTargetPattern.MatchString(req.Target) {
		return errors.New("请输入有效的域名、IP、网段或 URL，且一次只能填写一个范围")
	}
	if req.DiscoveryType == "passive" && len(req.ResourceIDs) != 1 {
		return errors.New("被动发现必须选择一个流量文件")
	}
	if req.DiscoveryType == "traditional" && len(req.ResourceIDs) != 0 {
		return errors.New("主动发现不需要流量文件")
	}
	return nil
}

func buildDiscoveryPrompt(req models.CreateAssetDiscoveryRequest) string {
	profile := map[string]string{
		"quick":    "快速：低流量识别常用主机、域名、端口和服务",
		"standard": "标准：完成常规资产枚举、存活验证、端口与服务识别，并交叉确认",
		"deep":     "深入：在合理速率下扩大资产和端口覆盖，对关键识别结果做完整复核",
	}[req.Profile]
	method := `使用主动探测识别范围内的存活主机、IP、域名、开放端口、服务、版本、操作系统线索和技术栈。只做资产识别，不执行漏洞模板、CVE 检测或利用验证。`
	if req.DiscoveryType == "passive" {
		method = `首先分析附带的 PCAP、PCAPNG 或 CAP 流量，提取主机、IP、域名、协议、端口、服务、通信方向和会话证据；仅在授权范围内做最低限度主动确认。明确区分流量确认、主动确认和推测。只做资产识别，不执行漏洞检测。`
	}
	return fmt.Sprintf(`执行已授权的资产发现任务。

授权范围：%s
发现强度：%s

边界：
1. %s
2. 不扫描范围外地址，不进行口令爆破、漏洞扫描、漏洞利用、数据修改、拒绝服务或持久化。
3. 合并同一资产的域名、IP 和服务证据，避免把每个端口重复算作资产。
4. 状态仅使用 active、inactive、unknown；暴露面仅使用 external、internal、unknown；置信度仅使用 confirmed、probable、inferred。
5. 最终先给出便于阅读的资产发现摘要，再原样输出一个且仅一个机器可读块，不能使用 Markdown 代码围栏：
<asset_inventory>{"assets":[{"asset_type":"host|ip|domain|url|network|device|cloud|unknown","name":"资产名称","address":"IP、域名或URL","status":"active|inactive|unknown","exposure":"external|internal|unknown","confidence":"confirmed|probable|inferred","operating_system":"操作系统线索","evidence":"发现证据摘要","services":[{"port":443,"transport":"tcp","service":"https","product":"产品","version":"版本","state":"open"}]}]}</asset_inventory>
6. JSON 必须合法；未知内容使用空字符串或 unknown，不得虚构资产、端口、产品或版本。`, req.Target, profile, method)
}

func parseAssetInventory(text string) ([]assetInventoryRecord, error) {
	matches := assetInventoryPattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil, errors.New("任务结果中没有结构化资产清单")
	}
	var document assetInventoryDocument
	if err := json.Unmarshal([]byte(matches[len(matches)-1][1]), &document); err != nil {
		return nil, fmt.Errorf("资产清单 JSON 无效: %w", err)
	}
	if len(document.Assets) == 0 {
		return nil, errors.New("任务结果中的资产清单为空")
	}
	return document.Assets, nil
}

func (s *VulnerabilityScanService) syncFinishedDiscoveries(uid uint64) error {
	var runs []models.AssetDiscoveryRun
	query := `SELECT discovery.* FROM asset_discovery_runs discovery
              JOIN flows ON flows.id = discovery.flow_id
             WHERE discovery.user_id = ? AND discovery.imported_at IS NULL
               AND flows.status = 'finished' AND flows.deleted_at IS NULL
             ORDER BY discovery.created_at ASC`
	if err := s.db.Raw(query, uid).Scan(&runs).Error; err != nil {
		return err
	}
	for index := range runs {
		if err := s.importDiscoveryResult(&runs[index]); err != nil {
			logrus.WithError(err).WithField("discovery_run_id", runs[index].ID).Warn("failed to import asset inventory")
		}
	}
	return nil
}

func (s *VulnerabilityScanService) importDiscoveryResult(run *models.AssetDiscoveryRun) error {
	var rows []struct{ Result string }
	query := `SELECT result FROM tasks WHERE flow_id = ? AND result <> ''
              UNION ALL SELECT result FROM assistantlogs WHERE flow_id = ? AND result <> ''
              UNION ALL SELECT result FROM msglogs WHERE flow_id = ? AND result <> ''`
	if err := s.db.Raw(query, run.FlowID, run.FlowID, run.FlowID).Scan(&rows).Error; err != nil {
		return err
	}
	parts := make([]string, 0, len(rows))
	for _, row := range rows {
		parts = append(parts, row.Result)
	}
	records, parseErr := parseAssetInventory(strings.Join(parts, "\n"))
	now := time.Now()
	if parseErr != nil {
		s.db.Model(run).Updates(map[string]any{"import_error": parseErr.Error(), "imported_at": now})
		return parseErr
	}
	tx := s.db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	for _, record := range records {
		if err := upsertDiscoveredAsset(tx, run, record, now); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Model(run).Updates(map[string]any{"import_error": "", "imported_at": now}).Error; err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit().Error
}

func upsertDiscoveredAsset(tx *gorm.DB, run *models.AssetDiscoveryRun, record assetInventoryRecord, now time.Time) error {
	record.Address = strings.TrimSpace(record.Address)
	record.Name = strings.TrimSpace(record.Name)
	if record.Address == "" || len(record.Address) > 500 || !scanTargetPattern.MatchString(record.Address) {
		return fmt.Errorf("资产地址无效: %q", record.Address)
	}
	record.AssetType = normalizedChoice(record.AssetType, "unknown", "host", "ip", "domain", "url", "network", "device", "cloud", "unknown")
	record.Status = normalizedChoice(record.Status, "unknown", "active", "inactive", "unknown")
	record.Exposure = normalizedChoice(record.Exposure, "unknown", "external", "internal", "unknown")
	record.Confidence = normalizedChoice(record.Confidence, "inferred", "confirmed", "probable", "inferred")
	assetKey := record.AssetType + ":" + strings.ToLower(record.Address)
	var assetID uint64
	query := `INSERT INTO discovered_assets
              (user_id, discovery_run_id, asset_key, asset_type, name, address, status, exposure,
               discovery_method, confidence, operating_system, evidence, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, asset_key) DO UPDATE SET
              discovery_run_id = EXCLUDED.discovery_run_id,
              name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE discovered_assets.name END,
              status = EXCLUDED.status, exposure = EXCLUDED.exposure,
              discovery_method = EXCLUDED.discovery_method, confidence = EXCLUDED.confidence,
              operating_system = CASE WHEN EXCLUDED.operating_system <> '' THEN EXCLUDED.operating_system ELSE discovered_assets.operating_system END,
              evidence = CASE WHEN EXCLUDED.evidence <> '' THEN EXCLUDED.evidence ELSE discovered_assets.evidence END,
              last_seen_at = EXCLUDED.last_seen_at
            RETURNING id`
	if err := tx.Raw(query, run.UserID, run.ID, assetKey, record.AssetType, record.Name, record.Address,
		record.Status, record.Exposure, run.DiscoveryType, record.Confidence, strings.TrimSpace(record.OperatingSystem),
		strings.TrimSpace(record.Evidence), now, now).Row().Scan(&assetID); err != nil {
		return err
	}
	for _, service := range record.Services {
		if service.Port < 1 || service.Port > 65535 {
			continue
		}
		transport := normalizedChoice(service.Transport, "tcp", "tcp", "udp", "sctp")
		state := normalizedChoice(service.State, "open", "open", "closed", "filtered", "unknown")
		serviceQuery := `INSERT INTO discovered_asset_services
                (asset_id, port, transport, service, product, version, state, first_seen_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (asset_id, port, transport) DO UPDATE SET
                service = EXCLUDED.service, product = EXCLUDED.product, version = EXCLUDED.version,
                state = EXCLUDED.state, last_seen_at = EXCLUDED.last_seen_at`
		if err := tx.Exec(serviceQuery, assetID, service.Port, transport, strings.TrimSpace(service.Service),
			strings.TrimSpace(service.Product), strings.TrimSpace(service.Version), state, now, now).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizedChoice(value, fallback string, choices ...string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, choice := range choices {
		if value == choice {
			return value
		}
	}
	return fallback
}
