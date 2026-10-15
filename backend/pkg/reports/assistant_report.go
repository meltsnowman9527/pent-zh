// Package reports turns recorded engagement material into structured report
// prose. Automation-mode flows get their per-task reports from the reporter
// agent (see pkg/providers); an interactive assistant session has no such
// artifact, so its transcript is condensed into material and written up by one
// bounded model call.
package reports

import (
	"context"
	"fmt"
	"strings"
	"time"

	"pentagi/pkg/database"
	"pentagi/pkg/providers"
	"pentagi/pkg/providers/pconfig"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/templates"

	"github.com/sirupsen/logrus"
)

const (
	// Material budgets, in bytes of the assembled material. They bound the prompt
	// regardless of how long the session ran: one very long conversation must not
	// turn into a multi-megabyte request or a truncated one.
	materialTotalBudget    = 48 * 1024
	materialInputsBudget   = 4 * 1024
	materialAnswersBudget  = 24 * 1024
	materialResearchBudget = 6 * 1024
	materialToolsBudget    = 10 * 1024

	// Per-entry ceilings inside those budgets.
	maxAnswerBytes     = 6 * 1024
	maxResearchBytes   = 800
	maxToolResultBytes = 900
	maxInputBytes      = 2 * 1024

	// Terminal output keeps its tail: failures are usually reported at the end.
	terminalTailShare = 0.4

	reportTemplateName = "assistant_reporter.tmpl"

	// AssistantReportLogType marks the generated report inside the assistant log.
	AssistantReportLogType = database.MsglogTypeReport

	// ReportMessage is the log headline for a Chinese engagement; other languages
	// use the generic English one so the conversation list stays readable.
	ReportMessage        = "分析报告"
	ReportMessageEnglish = "Analysis report"
)

// MaterialEntry is one assistant log condensed for the report prompt.
type MaterialEntry struct {
	Type      database.MsglogType
	Step      int64
	Timestamp time.Time
	Intent    string
	Detail    string
	Truncated bool
}

// Material is the bounded, reorganised input of one report generation.
type Material struct {
	FlowID          int64
	FlowTitle       string
	AssistantTitle  string
	Language        string
	StartedAt       time.Time
	EndedAt         time.Time
	MessageCount    int
	TypeCounts      map[database.MsglogType]int
	Inputs          []MaterialEntry
	Answers         []MaterialEntry
	Research        []MaterialEntry
	Execution       []MaterialEntry
	Other           []MaterialEntry
	TruncatedNotice []string
}

// BuildMaterial condenses an assistant transcript into the report material.
//
// Answers are kept as complete as the budget allows because they carry the
// analysis; tool entries keep only their intent plus an excerpt of the output,
// and the session's internal reasoning (`thinking`) is dropped entirely — it is
// the bulk of the stored bytes and it is not evidence.
func BuildMaterial(flow database.Flow, assistant database.Assistant, logs []database.Assistantlog) Material {
	material := Material{
		FlowID:         flow.ID,
		FlowTitle:      flow.Title,
		AssistantTitle: assistant.Title,
		Language:       flow.Language,
		MessageCount:   len(logs),
		TypeCounts:     map[database.MsglogType]int{},
	}

	for _, log := range logs {
		material.TypeCounts[log.Type]++

		entry := MaterialEntry{
			Type: log.Type,
			Step: log.ID,
			// Assistant logs carry a created_at, but the fragment may arrive without
			// one (streaming frames); fall back to the zero time and let the writer
			// ignore the timestamp.
			Timestamp: log.CreatedAt.Time,
		}
		if entry.Timestamp.IsZero() {
			entry.Timestamp = time.Time{}
		}
		if material.StartedAt.IsZero() || (!entry.Timestamp.IsZero() && entry.Timestamp.Before(material.StartedAt)) {
			material.StartedAt = entry.Timestamp
		}
		if entry.Timestamp.After(material.EndedAt) {
			material.EndedAt = entry.Timestamp
		}

		switch log.Type {
		case database.MsglogTypeInput:
			entry.Intent, entry.Truncated = cut(log.Message, maxInputBytes)
			material.Inputs = append(material.Inputs, entry)
		case database.MsglogTypeAnswer:
			entry.Detail, entry.Truncated = cut(log.Message, maxAnswerBytes)
			material.Answers = append(material.Answers, entry)
		case database.MsglogTypeSearch, database.MsglogTypeBrowser:
			entry.Intent = truncate(log.Message, maxResearchBytes)
			entry.Detail, entry.Truncated = cut(log.Result, maxResearchBytes)
			material.Research = append(material.Research, entry)
		case database.MsglogTypeTerminal, database.MsglogTypeFile:
			entry.Intent = truncate(log.Message, maxResearchBytes)
			entry.Detail, entry.Truncated = cutMiddle(log.Result, maxToolResultBytes, terminalTailShare)
			material.Execution = append(material.Execution, entry)
		default:
			// thoughts / advice / ask / done / report and anything new: keep the
			// headline so the writer knows the step happened, without its bulk.
			entry.Intent = truncate(log.Message, maxResearchBytes)
			material.Other = append(material.Other, entry)
		}
	}

	// Apply the section budgets, evenly across entries, oldest first.
	applyBudget(material.Inputs, materialInputsBudget, func(e *MaterialEntry, share int) {
		applyCut(&e.Intent, &e.Truncated, share)
	})
	applyBudget(material.Answers, materialAnswersBudget, func(e *MaterialEntry, share int) {
		applyCut(&e.Detail, &e.Truncated, share)
	})
	applyBudget(material.Research, materialResearchBudget, func(e *MaterialEntry, share int) {
		applyCut(&e.Intent, &e.Truncated, share/3)
		applyCut(&e.Detail, &e.Truncated, share)
	})
	applyBudget(material.Execution, materialToolsBudget, func(e *MaterialEntry, share int) {
		applyCut(&e.Intent, &e.Truncated, share/4)
		applyCut(&e.Detail, &e.Truncated, share)
	})

	material.TruncatedNotice = []string{
		"材料由系统自动整理：助手回复尽量保留全文，终端/文件/检索条目只保留意图与输出摘录。",
		"本次会话的内部推理（thinking）未纳入材料，它属于模型的中间过程而非证据。",
	}
	if hasTruncated(material) {
		material.TruncatedNotice = append(material.TruncatedNotice,
			"部分条目超出长度上限已被截断，截断处标记为「…（已截断）」。")
	}

	return material
}

// Render builds the prompt the report writer model receives.
func (m Material) Render() (string, error) {
	raw, err := templates.ReadReportTemplate(reportTemplateName)
	if err != nil {
		return "", err
	}

	params := map[string]any{
		"Lang":     languageOrChinese(m.Language),
		"Material": m.materialText(),
		"Title":    m.FlowTitle,
	}

	rendered, err := templates.RenderPrompt(reportTemplateName, raw, params)
	if err != nil {
		return "", fmt.Errorf("failed to render the assistant report template: %w", err)
	}

	return rendered, nil
}

// materialText lays the material out section by section. The writer is told to
// reorganise by topic; the sections only separate evidence kinds.
func (m Material) materialText() string {
	var b strings.Builder

	fmt.Fprintf(&b, "## 会话概览\n\n")
	fmt.Fprintf(&b, "- 流程：#%d《%s》\n", m.FlowID, m.FlowTitle)
	fmt.Fprintf(&b, "- 助手：%s\n", m.AssistantTitle)
	fmt.Fprintf(&b, "- 会话语言：%s\n", languageOrChinese(m.Language))
	fmt.Fprintf(&b, "- 消息总数：%d（输入 %d / 回复 %d / 终端 %d / 文件 %d / 检索 %d / 其他 %d）\n",
		m.MessageCount,
		m.TypeCounts[database.MsglogTypeInput],
		m.TypeCounts[database.MsglogTypeAnswer],
		m.TypeCounts[database.MsglogTypeTerminal],
		m.TypeCounts[database.MsglogTypeFile],
		m.TypeCounts[database.MsglogTypeSearch]+m.TypeCounts[database.MsglogTypeBrowser],
		len(m.Other),
	)
	if !m.StartedAt.IsZero() && !m.EndedAt.IsZero() {
		fmt.Fprintf(&b, "- 时间范围：%s ~ %s\n",
			m.StartedAt.UTC().Format(time.RFC3339), m.EndedAt.UTC().Format(time.RFC3339))
	}

	for _, notice := range m.TruncatedNotice {
		fmt.Fprintf(&b, "- %s\n", notice)
	}

	writeSection(&b, "用户输入（按时间顺序）", m.Inputs, func(e MaterialEntry) string {
		return fmt.Sprintf("### 输入 #%d\n%s\n", e.Step, e.Intent)
	})
	writeSection(&b, "助手的分析与结论（主要信源，按时间顺序）", m.Answers, func(e MaterialEntry) string {
		return fmt.Sprintf("### 回复 #%d\n%s\n", e.Step, e.Detail)
	})
	writeSection(&b, "调研与信息收集（search / browser）", m.Research, func(e MaterialEntry) string {
		return fmt.Sprintf("### 步骤 #%d · %s\n意图：%s\n结果摘录：%s\n", e.Step, e.Type, e.Intent, e.Detail)
	})
	writeSection(&b, "终端执行与文件操作（terminal / file）", m.Execution, func(e MaterialEntry) string {
		return fmt.Sprintf("### 步骤 #%d · %s\n意图：%s\n输出摘录：\n%s\n", e.Step, e.Type, e.Intent, e.Detail)
	})
	writeSection(&b, "其他记录（thoughts / advice / ask / done / report）", m.Other, func(e MaterialEntry) string {
		return fmt.Sprintf("### 步骤 #%d · %s\n%s\n", e.Step, e.Type, e.Intent)
	})

	return b.String()
}

func writeSection(b *strings.Builder, title string, entries []MaterialEntry, render func(MaterialEntry) string) {
	if len(entries) == 0 {
		return
	}

	fmt.Fprintf(b, "\n## %s\n\n", title)

	for _, entry := range entries {
		b.WriteString(strings.TrimSpace(render(entry)))
		b.WriteString("\n\n")
	}
}

// GeneratedReport is one written report plus the log row that carries it.
type GeneratedReport struct {
	LogID     int64
	Markdown  string
	Model     string
	CreatedAt time.Time
	Replaced  bool
}

// Generate writes the report for one assistant session.
//
// It reuses whatever log row already carries a report for that assistant: the
// report is a property of the session, not a message, so regenerating replaces
// it instead of piling up copies. The model call is bounded by the material
// budget, and the writer's output is stored as markdown in the assistant log so
// every existing export path (web view, Markdown, PDF) picks it up unchanged.
func Generate(
	ctx context.Context,
	db database.Querier,
	provs providers.ProviderController,
	logger *logrus.Entry,
	userID, flowID, assistantID int64,
) (*GeneratedReport, error) {
	flow, err := db.GetFlow(ctx, flowID)
	if err != nil {
		return nil, fmt.Errorf("failed to load flow %d: %w", flowID, err)
	}

	assistant, err := db.GetAssistant(ctx, assistantID)
	if err != nil {
		return nil, fmt.Errorf("failed to load assistant %d: %w", assistantID, err)
	}
	if assistant.FlowID != flowID {
		return nil, fmt.Errorf("assistant %d does not belong to flow %d", assistantID, flowID)
	}

	logs, err := db.GetFlowAssistantLogs(ctx, database.GetFlowAssistantLogsParams{
		FlowID:      flowID,
		AssistantID: assistantID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load the assistant transcript: %w", err)
	}
	if len(logs) == 0 {
		return nil, fmt.Errorf("assistant %d has no messages to report on", assistantID)
	}

	material := BuildMaterial(flow, assistant, logs)

	prompt, err := material.Render()
	if err != nil {
		return nil, err
	}

	prvname := provider.ProviderName(assistant.ModelProviderName)
	prv, err := provs.GetProvider(ctx, prvname, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to load provider %q: %w", prvname, err)
	}

	model := prv.Model(pconfig.OptionsTypeSimple)

	if logger != nil {
		logger.WithFields(logrus.Fields{
			"assistant_id": assistantID,
			"flow_id":      flowID,
			"model":        model,
			"prompt_bytes": len(prompt),
			"messages":     len(logs),
		}).Info("generating assistant session report")
	}

	markdown, err := prv.Call(ctx, pconfig.OptionsTypeSimple, prompt)
	if err != nil {
		return nil, fmt.Errorf("failed to write the report: %w", err)
	}

	markdown = strings.TrimSpace(markdown)
	if markdown == "" {
		return nil, fmt.Errorf("the report writer returned nothing")
	}

	report := &GeneratedReport{Markdown: markdown, Model: model}
	headline := headlineFor(flow.Language)

	existing, found := existingReportLog(logs)
	if found {
		updated, err := db.UpdateAssistantLog(ctx, database.UpdateAssistantLogParams{
			ID:           existing.ID,
			Type:         AssistantReportLogType,
			Message:      headline,
			Thinking:     database.StringToNullString(""),
			Result:       markdown,
			ResultFormat: database.MsglogResultFormatMarkdown,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to store the report: %w", err)
		}

		report.LogID, report.CreatedAt, report.Replaced = updated.ID, updated.CreatedAt.Time, true

		return report, nil
	}

	created, err := db.CreateResultAssistantLog(ctx, database.CreateResultAssistantLogParams{
		Type:         AssistantReportLogType,
		Message:      headline,
		Thinking:     database.StringToNullString(""),
		Result:       markdown,
		ResultFormat: database.MsglogResultFormatMarkdown,
		FlowID:       flowID,
		AssistantID:  assistantID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to store the report: %w", err)
	}

	report.LogID, report.CreatedAt = created.ID, created.CreatedAt.Time

	return report, nil
}

// headlineFor labels the report entry in the conversation list, which the
// engagement language owns; the report body itself is written by the model.
func headlineFor(language string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "english") {
		return ReportMessageEnglish
	}

	return ReportMessage
}

func existingReportLog(logs []database.Assistantlog) (database.Assistantlog, bool) {
	for i := len(logs) - 1; i >= 0; i-- {
		if logs[i].Type == AssistantReportLogType && strings.TrimSpace(logs[i].Result) != "" {
			return logs[i], true
		}
	}

	return database.Assistantlog{}, false
}

func languageOrChinese(language string) string {
	if strings.TrimSpace(language) == "" {
		return "Chinese"
	}

	return language
}

func hasTruncated(m Material) bool {
	for _, entries := range [][]MaterialEntry{m.Inputs, m.Answers, m.Research, m.Execution} {
		for _, entry := range entries {
			if entry.Truncated {
				return true
			}
		}
	}

	return false
}

// applyBudget hands every entry an equal share of the section budget and lets
// the caller cut its fields accordingly; a single long entry therefore cannot
// starve the rest of the section.
func applyBudget(entries []MaterialEntry, budget int, cut func(*MaterialEntry, int)) {
	if len(entries) == 0 {
		return
	}

	share := budget / len(entries)
	if share < 64 {
		share = 64
	}

	for i := range entries {
		cut(&entries[i], share)
	}
}

const truncatedSuffix = "…（已截断）"

// applyCut shortens a field and ORs the truncation flag, so a field cut by the
// per-entry ceiling and one cut by the section budget are reported the same way.
func applyCut(field *string, truncated *bool, limit int) {
	text, cut := cut(*field, limit)
	*field = text
	*truncated = *truncated || cut
}

// cut shortens text to at most limit bytes worth of runes and reports whether it
// had to.
func cut(text string, limit int) (string, bool) {
	if limit <= 0 || len(text) <= limit {
		return text, false
	}

	runes := []rune(text)
	// Byte budget to a rune budget: keep the same proportion so multi-byte
	// (CJK) text is truncated consistently with ASCII.
	limitRunes := limit * len(runes) / len(text)
	if limitRunes >= len(runes) {
		limitRunes = len(runes) - 1
	}
	if limitRunes < 1 {
		limitRunes = 1
	}

	return strings.TrimSpace(string(runes[:limitRunes])) + truncatedSuffix, true
}

func truncate(text string, limit int) string {
	cut, _ := cut(text, limit)

	return cut
}

// cutMiddle keeps the head and the tail of a long tool output, because a failing
// command reports at the end what it printed at the start.
func cutMiddle(text string, limit int, tailShare float64) (string, bool) {
	if limit <= 0 || len(text) <= limit {
		return text, false
	}

	runes := []rune(text)
	limitRunes := limit * len(runes) / len(text)
	if limitRunes < 8 {
		limitRunes = 8
	}
	if limitRunes >= len(runes) {
		return text, false
	}

	tail := int(float64(limitRunes) * tailShare)
	head := limitRunes - tail

	return strings.TrimSpace(string(runes[:head])) + "\n" + truncatedSuffix + "\n" +
		strings.TrimSpace(string(runes[len(runes)-tail:])), true
}
