package services

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"pentagi/pkg/server/models"
	"pentagi/pkg/server/response"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/sirupsen/logrus"
)

const (
	intelligenceMaxResponseBytes = 64 << 20
	intelligenceMaxDecodedBytes  = 128 << 20
)

var cvePattern = regexp.MustCompile(`(?i)CVE-\d{4}-\d{4,}`)

type IntelligenceService struct {
	db     *gorm.DB
	client *http.Client
	locks  sync.Map
}

func NewIntelligenceService(db *gorm.DB) *IntelligenceService {
	s := &IntelligenceService{
		db: db,
		client: &http.Client{
			Timeout: 45 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("too many redirects")
				}
				return validatePublicURL(req.URL.String())
			},
		},
	}
	go s.runScheduler()
	return s
}

func (s *IntelligenceService) runScheduler() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		var due []models.IntelligenceSource
		if err := s.db.Where("enabled = TRUE AND next_sync_at IS NOT NULL AND next_sync_at <= ?", time.Now()).Find(&due).Error; err != nil {
			logrus.WithError(err).Warn("failed to load due intelligence sources")
			continue
		}
		for i := range due {
			if _, err := s.syncSource(context.Background(), &due[i]); err != nil {
				logrus.WithError(err).WithField("source_id", due[i].ID).Warn("scheduled intelligence sync failed")
			}
		}
	}
}

func (s *IntelligenceService) ensureDefaults(uid uint64) error {
	now := time.Now()
	defaults := []models.IntelligenceSource{
		{UserID: uid, Name: "CISA 已知在野利用漏洞", Description: "CISA Known Exploited Vulnerabilities，记录已确认在野利用的 CVE。", URL: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", Format: "json", Schedule: "daily", Enabled: true, Builtin: true, Status: "pending", NextSyncAt: &now},
		{UserID: uid, Name: "NVD 最近更新漏洞", Description: "NVD CVE 2.0 最近更新数据，包含 CVSS、CWE 与漏洞描述。", URL: "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json.gz", Format: "json", Schedule: "daily", Enabled: true, Builtin: true, Status: "pending", NextSyncAt: &now},
		{UserID: uid, Name: "MITRE ATT&CK Enterprise", Description: "MITRE ATT&CK 企业域的战术、技术、组织、软件和缓解措施。", URL: "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json", Format: "stix", Schedule: "weekly", Enabled: true, Builtin: true, Status: "pending", NextSyncAt: &now},
		{UserID: uid, Name: "MITRE CWE", Description: "MITRE CWE 弱点目录及弱点之间的层级和关联关系。", URL: "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip", Format: "cwe", Schedule: "weekly", Enabled: true, Builtin: true, Status: "pending", NextSyncAt: &now},
	}
	for _, source := range defaults {
		query := `INSERT INTO intelligence_sources
            (user_id, name, description, url, format, schedule, enabled, builtin, status, next_sync_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)
            ON CONFLICT (user_id, url) DO UPDATE SET
              name=EXCLUDED.name, description=EXCLUDED.description,
              format=EXCLUDED.format, builtin=TRUE`
		if err := s.db.Exec(query, source.UserID, source.Name, source.Description, source.URL, source.Format, source.Schedule, source.Enabled, source.Status, source.NextSyncAt).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *IntelligenceService) GetOverview(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.view") {
		return
	}
	uid := c.GetUint64("uid")
	if err := s.ensureDefaults(uid); err != nil {
		intelligenceError(c, http.StatusInternalServerError, "读取情报源失败", err)
		return
	}

	var result models.IntelligenceOverview
	if err := s.db.Where("user_id = ?", uid).Order("created_at ASC").Find(&result.Sources).Error; err != nil {
		intelligenceError(c, http.StatusInternalServerError, "读取情报源失败", err)
		return
	}
	itemQuery := `WITH ranked AS (
                  SELECT id, source_id, external_id, item_type, title, summary, cve_id,
                         severity, vendor, product, weakness, source_url, published_at, modified_at,
                         '{}'::jsonb AS data, created_at, updated_at,
                         ROW_NUMBER() OVER (
                           PARTITION BY source_id
                           ORDER BY COALESCE(modified_at, published_at, updated_at) DESC
                         ) AS source_rank,
                         COALESCE(modified_at, published_at, updated_at) AS sort_at
                    FROM intelligence_items
                   WHERE user_id = ?
                )
                SELECT id, source_id, external_id, item_type, title, summary, cve_id,
                       severity, vendor, product, weakness, source_url, published_at, modified_at,
                       data, created_at, updated_at
                  FROM ranked
                 ORDER BY source_rank ASC, sort_at DESC
                 LIMIT 100`
	if err := s.db.Raw(itemQuery, uid).Scan(&result.Items).Error; err != nil {
		intelligenceError(c, http.StatusInternalServerError, "读取漏洞情报失败", err)
		return
	}

	result.Stats.Sources = uint64(len(result.Sources))
	for _, source := range result.Sources {
		if source.Enabled {
			result.Stats.Enabled++
		}
		if source.Status == "failed" {
			result.Stats.FailedSources++
		}
	}
	s.db.Model(&models.IntelligenceItem{}).Where("user_id = ?", uid).Count(&result.Stats.Items)
	s.db.Model(&models.IntelligenceItem{}).Where("user_id = ? AND severity IN (?)", uid, []string{"critical", "known-exploited"}).Count(&result.Stats.Critical)
	s.db.Model(&models.IntelligenceRelation{}).Where("user_id = ?", uid).Count(&result.Stats.Relations)
	response.Success(c, http.StatusOK, result)
}

func (s *IntelligenceService) GetGraph(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.view") {
		return
	}
	uid := c.GetUint64("uid")
	limit := 500
	if requested, err := strconv.Atoi(c.Query("limit")); err == nil && requested > 0 {
		limit = requested
	}
	if limit > 1000 {
		limit = 1000
	}
	var nodes []models.IntelligenceGraphNode
	perType := limit / 8
	if perType < 25 {
		perType = 25
	}
	query := `WITH latest AS (
              SELECT DISTINCT ON (item.external_id)
                     item.external_id AS id, item.title AS label, item.item_type AS type,
                     item.summary AS description, item.severity, item.source_id,
                     source.name AS source_name, item.updated_at
                FROM intelligence_items item
                JOIN intelligence_sources source ON source.id = item.source_id
               WHERE item.user_id = ? AND item.external_id != ''
               ORDER BY item.external_id, item.updated_at DESC
            ), ranked AS (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY updated_at DESC) AS type_rank
                FROM latest
            )
            SELECT id, label, type, description, severity, source_id, source_name
              FROM ranked WHERE type_rank <= ?
             ORDER BY updated_at DESC LIMIT ?`
	if err := s.db.Raw(query, uid, perType, limit).Scan(&nodes).Error; err != nil {
		intelligenceError(c, http.StatusInternalServerError, "读取知识图谱节点失败", err)
		return
	}
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	edges := make([]models.IntelligenceGraphEdge, 0)
	if len(ids) > 0 {
		edgeQuery := `SELECT source_external_id AS source, target_external_id AS target,
                            relation_type AS type, MAX(description) AS description
                       FROM intelligence_relations
                      WHERE user_id = ?
                        AND source_external_id IN (?) AND target_external_id IN (?)
                      GROUP BY source_external_id, target_external_id, relation_type
                      LIMIT 3000`
		if err := s.db.Raw(edgeQuery, uid, ids, ids).Scan(&edges).Error; err != nil {
			intelligenceError(c, http.StatusInternalServerError, "读取知识图谱关系失败", err)
			return
		}
	}
	response.Success(c, http.StatusOK, models.IntelligenceGraph{Nodes: nodes, Edges: edges})
}

func (s *IntelligenceService) CreateSource(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.manage") {
		return
	}
	uid := c.GetUint64("uid")
	var req models.CreateIntelligenceSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		intelligenceError(c, http.StatusBadRequest, "情报源信息不完整", err)
		return
	}
	req.Name, req.URL = strings.TrimSpace(req.Name), strings.TrimSpace(req.URL)
	if err := validatePublicURL(req.URL); err != nil {
		intelligenceError(c, http.StatusBadRequest, "请输入可公开访问的 HTTP 或 HTTPS 地址", err)
		return
	}
	if req.Format == "" {
		req.Format = "auto"
	}
	if req.Schedule == "" {
		req.Schedule = "daily"
	}
	if !validChoice(req.Format, "auto", "json", "rss", "stix", "cwe") || !validChoice(req.Schedule, "manual", "hourly", "daily", "weekly") {
		intelligenceError(c, http.StatusBadRequest, "采集格式或更新频率无效", nil)
		return
	}
	now := time.Now()
	source := models.IntelligenceSource{UserID: uid, Name: req.Name, URL: req.URL, Format: req.Format, Schedule: req.Schedule, Enabled: true, Status: "pending"}
	source.NextSyncAt = nextSyncAt(req.Schedule, now)
	if err := s.db.Create(&source).Error; err != nil {
		intelligenceError(c, http.StatusConflict, "该情报源已经存在", err)
		return
	}
	response.Success(c, http.StatusCreated, source)
}

func (s *IntelligenceService) UpdateSource(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.manage") {
		return
	}
	uid := c.GetUint64("uid")
	var req models.UpdateIntelligenceSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		intelligenceError(c, http.StatusBadRequest, "更新内容无效", err)
		return
	}
	var source models.IntelligenceSource
	if err := s.db.Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&source).Error; err != nil {
		intelligenceError(c, http.StatusNotFound, "未找到情报源", err)
		return
	}
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = strings.TrimSpace(req.Name)
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Schedule != "" {
		if !validChoice(req.Schedule, "manual", "hourly", "daily", "weekly") {
			intelligenceError(c, http.StatusBadRequest, "更新频率无效", nil)
			return
		}
		updates["schedule"] = req.Schedule
		updates["next_sync_at"] = nextSyncAt(req.Schedule, time.Now())
	}
	if err := s.db.Model(&source).Updates(updates).Error; err != nil {
		intelligenceError(c, http.StatusInternalServerError, "更新情报源失败", err)
		return
	}
	s.db.Where("id = ?", source.ID).First(&source)
	response.Success(c, http.StatusOK, source)
}

func (s *IntelligenceService) DeleteSource(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.manage") {
		return
	}
	uid := c.GetUint64("uid")
	var source models.IntelligenceSource
	if err := s.db.Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&source).Error; err != nil {
		intelligenceError(c, http.StatusNotFound, "未找到情报源", err)
		return
	}
	if source.Builtin {
		intelligenceError(c, http.StatusConflict, "内置来源可以停用，但不能删除", nil)
		return
	}
	result := s.db.Where("id = ? AND user_id = ?", c.Param("id"), uid).Delete(&models.IntelligenceSource{})
	if result.Error != nil {
		intelligenceError(c, http.StatusInternalServerError, "删除情报源失败", result.Error)
		return
	}
	if result.RowsAffected == 0 {
		intelligenceError(c, http.StatusNotFound, "未找到情报源", nil)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"deleted": true})
}

func (s *IntelligenceService) SyncSource(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.sync") {
		return
	}
	uid := c.GetUint64("uid")
	var source models.IntelligenceSource
	if err := s.db.Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&source).Error; err != nil {
		intelligenceError(c, http.StatusNotFound, "未找到情报源", err)
		return
	}
	count, err := s.syncSource(c.Request.Context(), &source)
	if err != nil {
		intelligenceError(c, http.StatusBadGateway, "采集失败："+err.Error(), err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"collected": count})
}

func (s *IntelligenceService) SyncAll(c *gin.Context) {
	if !requireIntelligencePermission(c, "intelligence.sync") {
		return
	}
	uid := c.GetUint64("uid")
	var sources []models.IntelligenceSource
	if err := s.db.Where("user_id = ? AND enabled = TRUE", uid).Find(&sources).Error; err != nil {
		intelligenceError(c, http.StatusInternalServerError, "读取情报源失败", err)
		return
	}
	total, failed := 0, 0
	for i := range sources {
		count, err := s.syncSource(c.Request.Context(), &sources[i])
		if err != nil {
			failed++
		} else {
			total += count
		}
	}
	response.Success(c, http.StatusOK, gin.H{"collected": total, "failed": failed})
}

func (s *IntelligenceService) syncSource(ctx context.Context, source *models.IntelligenceSource) (int, error) {
	lockValue, _ := s.locks.LoadOrStore(source.ID, &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	s.db.Model(source).Updates(map[string]any{"status": "syncing", "last_error": ""})
	collection, err := s.fetchSource(ctx, source)
	now := time.Now()
	if err != nil {
		s.db.Model(source).Updates(map[string]any{"status": "failed", "last_error": truncate(err.Error(), 1500), "next_sync_at": nextSyncAt(source.Schedule, now)})
		return 0, err
	}

	tx := s.db.Begin()
	if tx.Error != nil {
		return 0, tx.Error
	}
	if err := upsertIntelligenceItems(tx, source.UserID, source.ID, collection.Items, now); err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := tx.Where("source_id = ? AND last_seen_at < ?", source.ID, now).Delete(&models.IntelligenceItem{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := tx.Where("source_id = ?", source.ID).Delete(&models.IntelligenceRelation{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := insertIntelligenceRelations(tx, source.UserID, source.ID, collection.Relations); err != nil {
		tx.Rollback()
		return 0, err
	}
	compressed, err := gzipBytes(collection.Payload)
	if err != nil {
		tx.Rollback()
		return 0, err
	}
	checksum := sha256.Sum256(collection.Payload)
	snapshotQuery := `INSERT INTO intelligence_snapshots
        (user_id, source_id, checksum, content_type, parser_version, byte_size, item_count, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_id, checksum) DO NOTHING`
	if err := tx.Exec(snapshotQuery, source.UserID, source.ID, hex.EncodeToString(checksum[:]), collection.MediaType, intelligenceParserVersion, len(collection.Payload), len(collection.Items), compressed).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := tx.Exec(`DELETE FROM intelligence_snapshots WHERE source_id = ? AND id NOT IN
        (SELECT id FROM intelligence_snapshots WHERE source_id = ? ORDER BY fetched_at DESC LIMIT 3)`, source.ID, source.ID).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := tx.Commit().Error; err != nil {
		return 0, err
	}
	var itemCount uint64
	s.db.Model(&models.IntelligenceItem{}).Where("source_id = ?", source.ID).Count(&itemCount)
	s.db.Model(source).Updates(map[string]any{"status": "ready", "item_count": itemCount, "last_error": "", "last_sync_at": now, "next_sync_at": nextSyncAt(source.Schedule, now)})
	return len(collection.Items), nil
}

func (s *IntelligenceService) fetchSource(ctx context.Context, source *models.IntelligenceSource) (intelligenceCollection, error) {
	if err := validatePublicURL(source.URL); err != nil {
		return intelligenceCollection{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil)
	if err != nil {
		return intelligenceCollection{}, err
	}
	req.Header.Set("User-Agent", "PentAGI-Intelligence-Collector/1.0")
	req.Header.Set("Accept", "application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, application/gzip, application/x-gzip, application/zip, application/octet-stream, */*")
	resp, err := s.client.Do(req)
	if err != nil {
		return intelligenceCollection{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return intelligenceCollection{}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, intelligenceMaxResponseBytes+1))
	if err != nil {
		return intelligenceCollection{}, err
	}
	if len(raw) > intelligenceMaxResponseBytes {
		return intelligenceCollection{}, errors.New("响应内容超过 64 MB")
	}
	reader := io.Reader(bytes.NewReader(raw))
	if strings.HasSuffix(strings.ToLower(source.URL), ".gz") || strings.Contains(resp.Header.Get("Content-Type"), "gzip") {
		gz, gzErr := gzip.NewReader(reader)
		if gzErr != nil {
			return intelligenceCollection{}, gzErr
		}
		defer gz.Close()
		reader = gz
	} else if strings.HasSuffix(strings.ToLower(source.URL), ".zip") || strings.Contains(resp.Header.Get("Content-Type"), "zip") {
		archive, zipErr := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if zipErr != nil || len(archive.File) == 0 {
			return intelligenceCollection{}, firstError(zipErr, errors.New("ZIP 文件为空"))
		}
		var selected *zip.File
		for _, file := range archive.File {
			if !file.FileInfo().IsDir() && (selected == nil || strings.HasSuffix(strings.ToLower(file.Name), ".xml")) {
				selected = file
				if strings.HasSuffix(strings.ToLower(file.Name), ".xml") {
					break
				}
			}
		}
		if selected == nil {
			return intelligenceCollection{}, errors.New("ZIP 文件中没有可解析内容")
		}
		opened, openErr := selected.Open()
		if openErr != nil {
			return intelligenceCollection{}, openErr
		}
		defer opened.Close()
		reader = opened
	}
	body, err := io.ReadAll(io.LimitReader(reader, intelligenceMaxDecodedBytes+1))
	if err != nil {
		return intelligenceCollection{}, err
	}
	if len(body) > intelligenceMaxDecodedBytes {
		return intelligenceCollection{}, errors.New("解压后内容超过 128 MB")
	}
	format := source.Format
	if format == "auto" {
		contentType := strings.ToLower(resp.Header.Get("Content-Type"))
		if strings.Contains(contentType, "xml") || (len(strings.TrimSpace(string(body))) > 0 && strings.TrimSpace(string(body))[0] == '<') {
			format = "rss"
		} else {
			format = "json"
		}
	}
	return parseIntelligencePayload(format, body, source.URL)
}

func gzipBytes(value []byte) ([]byte, error) {
	var result bytes.Buffer
	writer := gzip.NewWriter(&result)
	if _, err := writer.Write(value); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return result.Bytes(), nil
}

func firstError(primary, fallback error) error {
	if primary != nil {
		return primary
	}
	return fallback
}

func parseIntelligenceJSON(body []byte, feedURL string) ([]models.IntelligenceItem, error) {
	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	entries := arrayFromRoot(root)
	items := make([]models.IntelligenceItem, 0, len(entries))
	for _, raw := range entries {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		item := normalizeJSONItem(m, feedURL)
		if item.Title == "" {
			continue
		}
		items = append(items, item)
		if len(items) >= 10000 {
			break
		}
	}
	return items, nil
}

func arrayFromRoot(root any) []any {
	if entries, ok := root.([]any); ok {
		return entries
	}
	m, ok := root.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range []string{"vulnerabilities", "items", "results", "entries", "data"} {
		if entries, ok := m[key].([]any); ok {
			return entries
		}
	}
	return nil
}

func normalizeJSONItem(m map[string]any, feedURL string) models.IntelligenceItem {
	if cve, ok := m["cve"].(map[string]any); ok {
		return normalizeNVDItem(cve, m, feedURL)
	}
	cveID := firstString(m, "cveID", "cve_id", "cve", "id")
	title := firstString(m, "vulnerabilityName", "title", "name", "summary")
	summary := firstString(m, "shortDescription", "description", "summary", "details")
	if title == "" {
		title = cveID
	}
	if cveID == "" {
		cveID = cvePattern.FindString(title + " " + summary)
	}
	severity := strings.ToLower(firstString(m, "severity", "baseSeverity", "threat"))
	if firstString(m, "dateAdded") != "" && severity == "" {
		severity = "known-exploited"
	}
	if severity == "" {
		severity = "unknown"
	}
	externalID := firstString(m, "cveID", "cve_id", "id", "guid", "uuid")
	if externalID == "" {
		externalID = stableID(title, summary)
	}
	return models.IntelligenceItem{
		ExternalID: externalID, ItemType: "vulnerability", Title: truncate(title, 500), Summary: truncate(summary, 8000), CVEID: strings.ToUpper(cveID), Severity: severity,
		Vendor: firstString(m, "vendorProject", "vendor", "publisher"), Product: firstString(m, "product", "affectedProduct"), Weakness: firstString(m, "cwe", "weakness"),
		SourceURL: firstStringDefault(m, feedURL, "url", "link", "source_url"), PublishedAt: parseTime(firstString(m, "dateAdded", "published", "published_at", "Published", "modified")),
	}
}

func normalizeNVDItem(cve, wrapper map[string]any, feedURL string) models.IntelligenceItem {
	id := firstString(cve, "id")
	description := nestedDescription(cve["descriptions"])
	severity := "unknown"
	if metrics, ok := cve["metrics"].(map[string]any); ok {
		for _, key := range []string{"cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"} {
			arr, ok := metrics[key].([]any)
			if !ok || len(arr) == 0 {
				continue
			}
			metric, _ := arr[0].(map[string]any)
			data, _ := metric["cvssData"].(map[string]any)
			severity = strings.ToLower(firstString(data, "baseSeverity"))
			if severity == "" {
				severity = strings.ToLower(firstString(metric, "baseSeverity"))
			}
			if severity != "" {
				break
			}
		}
	}
	weakness := ""
	if weaknesses, ok := cve["weaknesses"].([]any); ok && len(weaknesses) > 0 {
		if wm, ok := weaknesses[0].(map[string]any); ok {
			weakness = nestedDescription(wm["description"])
		}
	}
	if severity == "" {
		severity = "unknown"
	}
	vendor, product := nvdVendorProduct(cve)
	metadata, _ := json.Marshal(map[string]any{"metrics": cve["metrics"], "references": cve["references"]})
	return models.IntelligenceItem{ExternalID: id, ItemType: "vulnerability", Title: id, Summary: truncate(description, 8000), CVEID: id, Severity: severity, Vendor: vendor, Product: product, Weakness: weakness, SourceURL: feedURL, PublishedAt: parseTime(firstString(cve, "published")), ModifiedAt: parseTime(firstString(cve, "lastModified")), Data: metadata}
}

func nvdVendorProduct(cve map[string]any) (string, string) {
	configurations, _ := cve["configurations"].([]any)
	for _, configuration := range configurations {
		config, _ := configuration.(map[string]any)
		nodes, _ := config["nodes"].([]any)
		for _, rawNode := range nodes {
			node, _ := rawNode.(map[string]any)
			matches, _ := node["cpeMatch"].([]any)
			for _, rawMatch := range matches {
				match, _ := rawMatch.(map[string]any)
				criteria := firstString(match, "criteria")
				parts := strings.Split(criteria, ":")
				if len(parts) > 4 {
					return strings.ReplaceAll(parts[3], "_", " "), strings.ReplaceAll(parts[4], "_", " ")
				}
			}
		}
	}
	return "", ""
}

func nestedDescription(value any) string {
	arr, ok := value.([]any)
	if !ok {
		return ""
	}
	for _, raw := range arr {
		if m, ok := raw.(map[string]any); ok {
			if v := firstString(m, "value", "description"); v != "" {
				return v
			}
		}
	}
	return ""
}

type rssDocument struct {
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
	Entries []rssItem `xml:"entry"`
}
type rssItem struct {
	Title       string `xml:"title"`
	Description string `xml:"description"`
	Summary     string `xml:"summary"`
	Link        string `xml:"link"`
	GUID        string `xml:"guid"`
	ID          string `xml:"id"`
	PubDate     string `xml:"pubDate"`
	Updated     string `xml:"updated"`
}

func parseIntelligenceXML(body []byte, feedURL string) ([]models.IntelligenceItem, error) {
	var doc rssDocument
	if err := xml.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("RSS/XML 解析失败: %w", err)
	}
	entries := append(doc.Channel.Items, doc.Entries...)
	items := make([]models.IntelligenceItem, 0, len(entries))
	for _, entry := range entries {
		summary := entry.Description
		if summary == "" {
			summary = entry.Summary
		}
		id := entry.GUID
		if id == "" {
			id = entry.ID
		}
		if id == "" {
			id = stableID(entry.Title, summary)
		}
		link := entry.Link
		if link == "" {
			link = feedURL
		}
		cveID := strings.ToUpper(cvePattern.FindString(entry.Title + " " + summary))
		items = append(items, models.IntelligenceItem{ExternalID: id, ItemType: "advisory", Title: truncate(entry.Title, 500), Summary: truncate(summary, 8000), CVEID: cveID, Severity: "unknown", SourceURL: link, PublishedAt: parseTime(firstNonEmpty(entry.PubDate, entry.Updated)), Data: json.RawMessage(`{}`)})
	}
	return items, nil
}

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func firstStringDefault(m map[string]any, fallback string, keys ...string) string {
	if value := firstString(m, keys...); value != "" {
		return value
	}
	return fallback
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func stableID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:16])
}
func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}
func validChoice(value string, choices ...string) bool {
	for _, choice := range choices {
		if value == choice {
			return true
		}
	}
	return false
}

func parseTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano, time.RFC1123Z, time.RFC1123, "2006-01-02", "2006-01-02T15:04:05.000"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed
		}
	}
	return nil
}

func nextSyncAt(schedule string, from time.Time) *time.Time {
	var next time.Time
	switch schedule {
	case "hourly":
		next = from.Add(time.Hour)
	case "daily":
		next = from.Add(24 * time.Hour)
	case "weekly":
		next = from.Add(7 * 24 * time.Hour)
	default:
		return nil
	}
	return &next
}

func validatePublicURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("unsupported URL scheme")
	}
	if parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("invalid URL")
	}
	ips, err := net.LookupIP(parsed.Hostname())
	if err != nil {
		return err
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() {
			return errors.New("private network addresses are not allowed")
		}
	}
	return nil
}

func intelligenceError(c *gin.Context, status int, message string, err error) {
	response.Error(c, response.NewHttpError(status, "IntelligenceError", message), err)
}

func requireIntelligencePermission(c *gin.Context, permission string) bool {
	if slices.Contains(c.GetStringSlice("prm"), permission) {
		return true
	}
	response.Error(c, response.ErrNotPermitted, nil)
	return false
}
