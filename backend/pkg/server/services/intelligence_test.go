package services

import (
	"testing"
	"time"

	"pentagi/pkg/server/models"

	"github.com/stretchr/testify/require"
)

func TestParseIntelligenceJSONCISA(t *testing.T) {
	payload := []byte(`{
        "vulnerabilities": [{
            "cveID": "CVE-2026-12345",
            "vendorProject": "Example Vendor",
            "product": "Example Product",
            "vulnerabilityName": "Example authorization vulnerability",
            "dateAdded": "2026-09-16",
            "shortDescription": "A concise vulnerability description."
        }]
    }`)

	items, err := parseIntelligenceJSON(payload, "https://example.com/feed.json")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "CVE-2026-12345", items[0].CVEID)
	require.Equal(t, "known-exploited", items[0].Severity)
	require.Equal(t, "Example Vendor", items[0].Vendor)
	require.Equal(t, "Example Product", items[0].Product)
	require.NotNil(t, items[0].PublishedAt)
}

func TestParseIntelligenceXML(t *testing.T) {
	payload := []byte(`<rss><channel><item><title>CVE-2026-54321 security update</title><description>Update now.</description><guid>notice-1</guid><pubDate>Wed, 16 Sep 2026 10:00:00 +0000</pubDate></item></channel></rss>`)

	items, err := parseIntelligenceXML(payload, "https://example.com/feed.xml")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "CVE-2026-54321", items[0].CVEID)
	require.Equal(t, "notice-1", items[0].ExternalID)
}

func TestNextSyncAt(t *testing.T) {
	from := time.Date(2026, time.September, 16, 8, 0, 0, 0, time.UTC)
	require.Equal(t, from.Add(time.Hour), *nextSyncAt("hourly", from))
	require.Equal(t, from.Add(24*time.Hour), *nextSyncAt("daily", from))
	require.Equal(t, from.Add(7*24*time.Hour), *nextSyncAt("weekly", from))
	require.Nil(t, nextSyncAt("manual", from))
}

func TestParseSTIXBundleWithRelationships(t *testing.T) {
	payload := []byte(`{
      "type":"bundle",
      "objects":[
        {"type":"x-mitre-tactic","id":"x-mitre-tactic--1","name":"Initial Access","x_mitre_shortname":"initial-access","external_references":[{"external_id":"TA0001","url":"https://attack.mitre.org/tactics/TA0001/"}]},
        {"type":"attack-pattern","id":"attack-pattern--1","name":"Exploit Public-Facing Application","description":"Exploit an exposed application.","kill_chain_phases":[{"phase_name":"initial-access"}],"external_references":[{"external_id":"T1190","url":"https://attack.mitre.org/techniques/T1190/"}]},
        {"type":"course-of-action","id":"course-of-action--1","name":"Update Software","external_references":[{"external_id":"M1051"}]},
        {"type":"relationship","id":"relationship--1","source_ref":"course-of-action--1","target_ref":"attack-pattern--1","relationship_type":"mitigates"}
      ]
    }`)

	items, relations, err := parseSTIXBundle(payload, "https://example.com/enterprise-attack.json")
	require.NoError(t, err)
	require.Len(t, items, 3)
	require.Contains(t, relations, models.IntelligenceRelation{SourceExternalID: "T1190", TargetExternalID: "TA0001", RelationType: "belongs_to_tactic"})
	require.Contains(t, relations, models.IntelligenceRelation{SourceExternalID: "M1051", TargetExternalID: "T1190", RelationType: "mitigates"})
}

func TestParseCWECatalogWithHierarchy(t *testing.T) {
	payload := []byte(`<Weakness_Catalog><Weaknesses>
      <Weakness ID="79" Name="Cross-site Scripting" Abstraction="Base" Status="Stable">
        <Description>Improper neutralization of input in a web page.</Description>
        <Related_Weaknesses><Related_Weakness Nature="ChildOf" CWE_ID="74" /></Related_Weaknesses>
        <Related_Attack_Patterns><Related_Attack_Pattern CAPEC_ID="63" /></Related_Attack_Patterns>
      </Weakness>
    </Weaknesses></Weakness_Catalog>`)

	items, relations, err := parseCWECatalog(payload, "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "CWE-79", items[0].ExternalID)
	require.Equal(t, "weakness", items[0].ItemType)
	require.Contains(t, relations, models.IntelligenceRelation{SourceExternalID: "CWE-79", TargetExternalID: "CWE-74", RelationType: "child_of"})
	require.Contains(t, relations, models.IntelligenceRelation{SourceExternalID: "CWE-79", TargetExternalID: "CAPEC-63", RelationType: "related_attack_pattern"})
}
