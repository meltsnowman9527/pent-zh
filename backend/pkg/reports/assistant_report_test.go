package reports

import (
	"database/sql"
	"strings"
	"testing"
	"time"

	"pentagi/pkg/database"

	"github.com/stretchr/testify/require"
)

func makeLog(id int64, msgType database.MsglogType, message, result string) database.Assistantlog {
	return database.Assistantlog{
		ID:           id,
		Type:         msgType,
		Message:      message,
		Result:       result,
		ResultFormat: database.MsglogResultFormatMarkdown,
		FlowID:       1,
		AssistantID:  3,
		CreatedAt:    sql.NullTime{Time: time.Date(2026, 9, 14, 5, 27, 57, 0, time.UTC), Valid: true},
	}
}

func testFlow() database.Flow {
	return database.Flow{ID: 1, Title: "网站安全测试计划", Language: "Chinese"}
}

func testAssistant() database.Assistant {
	return database.Assistant{ID: 3, FlowID: 1, Title: "网站安全测试计划", ModelProviderName: "deepseek"}
}

func TestBuildMaterialGroupsByEvidenceKind(t *testing.T) {
	logs := []database.Assistantlog{
		makeLog(1, database.MsglogTypeInput, "请测试 http://target 并给出结论", ""),
		makeLog(2, database.MsglogTypeThoughts, "先做被动信息收集", ""),
		makeLog(3, database.MsglogTypeAnswer, "收到，我先做被动收集。", ""),
		makeLog(4, database.MsglogTypeSearch, "检索该挑战的公开解法", "# 1. CTFtime 题解\n关键点：CSS 属性选择器外带"),
		makeLog(5, database.MsglogTypeTerminal, "抓取响应头", "HTTP/1.1 200 OK\nX-Powered-By: Express"),
		makeLog(6, database.MsglogTypeFile, "写回调服务", "Successfully wrote 1326 bytes to /work/logsrv.py"),
		makeLog(7, database.MsglogTypeAnswer, "结论：存在 HTML 注入。", ""),
	}

	material := BuildMaterial(testFlow(), testAssistant(), logs)

	require.Equal(t, int64(1), material.FlowID)
	require.Equal(t, "网站安全测试计划", material.FlowTitle)
	require.Equal(t, 7, material.MessageCount)
	require.Len(t, material.Inputs, 1)
	require.Len(t, material.Answers, 2)
	require.Len(t, material.Research, 1)
	require.Len(t, material.Execution, 2)
	require.Len(t, material.Other, 1)
	require.Equal(t, 2, material.TypeCounts[database.MsglogTypeAnswer])

	text := material.materialText()

	// Sections keep the evidence kinds apart and the answers stay the primary source.
	require.Contains(t, text, "## 用户输入")
	require.Contains(t, text, "## 助手的分析与结论")
	require.Contains(t, text, "## 调研与信息收集")
	require.Contains(t, text, "## 终端执行与文件操作")
	require.Contains(t, text, "HTTP/1.1 200 OK")
	require.Contains(t, text, "Successfully wrote 1326 bytes")
	require.Contains(t, text, "先做被动信息收集")

	// Order is preserved inside a section.
	require.Less(t, strings.Index(text, "收到，我先做被动收集。"), strings.Index(text, "结论：存在 HTML 注入。"))
}

func TestBuildMaterialDropsThinkingAndTruncatesWithinBudget(t *testing.T) {
	long := strings.Repeat("很长的终端输出", 4000)
	logs := []database.Assistantlog{
		makeLog(1, database.MsglogTypeInput, "开始", ""),
		makeLog(2, database.MsglogTypeTerminal, "跑一个很长的命令", long),
		makeLog(3, database.MsglogTypeAnswer, strings.Repeat("分析", 20000), ""),
	}
	logs[0].Thinking = sql.NullString{String: "REASONING-SENTINEL " + strings.Repeat("x", 1000), Valid: true}

	material := BuildMaterial(testFlow(), testAssistant(), logs)
	text := material.materialText()

	// thinking is never material: it is the model's middle game, not evidence.
	require.NotContains(t, text, "REASONING-SENTINEL")
	require.Contains(t, text, "未纳入材料")

	// The assembled material stays inside the budget even for an oversized session,
	// and every truncation is announced rather than silent.
	require.Less(t, len(text), materialTotalBudget+4096)
	require.Contains(t, text, "已截断")
	require.True(t, hasTruncated(material))

	// A long tool output keeps both ends: the intent up front, the failure at the end.
	require.Contains(t, text, "跑一个很长的命令")
	require.True(t, material.Execution[0].Truncated)
}

func TestMaterialRenderCarriesLanguageAndStructure(t *testing.T) {
	logs := []database.Assistantlog{
		makeLog(1, database.MsglogTypeInput, "请全程使用中文", ""),
		makeLog(2, database.MsglogTypeAnswer, "好的。", ""),
	}

	rendered, err := BuildMaterial(testFlow(), testAssistant(), logs).Render()
	require.NoError(t, err)

	// The writer must be told the target language and the required outline; the
	// material follows the instructions.
	require.Contains(t, rendered, "Chinese")
	require.Contains(t, rendered, "## 一、摘要")
	require.Contains(t, rendered, "## 六、结论与成果")
	require.Contains(t, rendered, "No tables")
	require.Contains(t, rendered, "请全程使用中文")
	require.Less(t, strings.Index(rendered, "## MATERIAL"), strings.Index(rendered, "请全程使用中文"))
}

func TestExistingReportLogFindsTheStoredReport(t *testing.T) {
	logs := []database.Assistantlog{
		makeLog(1, database.MsglogTypeInput, "问题", ""),
		makeLog(2, database.MsglogTypeReport, ReportMessage, "# 报告\n正文"),
		makeLog(3, database.MsglogTypeAnswer, "后续回答", ""),
	}

	found, ok := existingReportLog(logs)
	require.True(t, ok)
	require.Equal(t, int64(2), found.ID)

	// An empty report row does not count: a failed attempt must not shadow a retry.
	empty := []database.Assistantlog{makeLog(4, database.MsglogTypeReport, ReportMessage, "  ")}
	_, ok = existingReportLog(empty)
	require.False(t, ok)
}

func TestCutKeepsMultiByteTextIntact(t *testing.T) {
	text := strings.Repeat("中文", 100)

	short, truncated := cut(text, 60)
	require.True(t, truncated)
	require.True(t, strings.HasSuffix(short, truncatedSuffix))
	require.LessOrEqual(t, len([]rune(short)), 100)
	require.NotContains(t, short, "\ufffd")

	untouched, truncated := cut("短", 60)
	require.False(t, truncated)
	require.Equal(t, "短", untouched)
}
