package services

import (
	"testing"

	"pentagi/pkg/server/models"

	"github.com/stretchr/testify/require"
)

func TestParseAssetInventory(t *testing.T) {
	t.Parallel()

	input := `资产发现完成。
<asset_inventory>{"assets":[{"asset_type":"ip","name":"gateway","address":"192.0.2.1","status":"active","exposure":"external","confidence":"confirmed","operating_system":"Linux","evidence":"nmap host discovery","services":[{"port":443,"transport":"tcp","service":"https","product":"nginx","version":"1.24","state":"open"}]}]}</asset_inventory>`

	records, err := parseAssetInventory(input)
	require.NoError(t, err)
	require.Len(t, records, 1)
	require.Equal(t, "192.0.2.1", records[0].Address)
	require.Equal(t, "confirmed", records[0].Confidence)
	require.Len(t, records[0].Services, 1)
	require.Equal(t, 443, records[0].Services[0].Port)
}

func TestParseAssetInventoryRejectsMissingOrInvalidPayload(t *testing.T) {
	t.Parallel()

	_, err := parseAssetInventory("没有结构化结果")
	require.ErrorContains(t, err, "没有结构化资产清单")

	_, err = parseAssetInventory(`<asset_inventory>{invalid}</asset_inventory>`)
	require.ErrorContains(t, err, "JSON 无效")
}

func TestDiscoveryAndScanPromptsKeepStageBoundary(t *testing.T) {
	t.Parallel()

	discovery := buildDiscoveryPrompt(testDiscoveryRequest())
	require.Contains(t, discovery, "只做资产识别，不执行漏洞模板")
	require.Contains(t, discovery, "<asset_inventory>")

	scan := buildScanPrompt(testScanRequest(), nil)
	require.Contains(t, scan, "不执行新的网段、子域或未知资产枚举")
	require.NotContains(t, scan, "形成资产清单")
}

func testDiscoveryRequest() models.CreateAssetDiscoveryRequest {
	return models.CreateAssetDiscoveryRequest{DiscoveryType: "traditional", Profile: "standard", Target: "192.0.2.0/24"}
}

func testScanRequest() models.CreateVulnerabilityScanRequest {
	return models.CreateVulnerabilityScanRequest{Profile: "standard", AssetIDs: []uint64{1}}
}
