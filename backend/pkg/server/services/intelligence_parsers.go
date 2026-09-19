package services

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"pentagi/pkg/server/models"
)

const intelligenceParserVersion = "2026-09-20.1"

var cweIDPattern = regexp.MustCompile(`(?i)CWE-\d+`)

type intelligenceCollection struct {
	Items     []models.IntelligenceItem
	Relations []models.IntelligenceRelation
	Payload   []byte
	MediaType string
}

func parseIntelligencePayload(format string, body []byte, feedURL string) (intelligenceCollection, error) {
	var (
		items     []models.IntelligenceItem
		relations []models.IntelligenceRelation
		err       error
	)
	// Auto detection deliberately recognizes STIX before generic JSON.
	if format == "auto" || format == "json" {
		var header struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal(body, &header)
		if header.Type == "bundle" {
			format = "stix"
		}
	}

	switch format {
	case "stix":
		items, relations, err = parseSTIXBundle(body, feedURL)
	case "cwe":
		items, relations, err = parseCWECatalog(body, feedURL)
	case "rss":
		items, err = parseIntelligenceXML(body, feedURL)
	default:
		items, err = parseIntelligenceJSON(body, feedURL)
	}
	if err != nil {
		return intelligenceCollection{}, err
	}

	for idx := range items {
		if items[idx].ItemType == "" {
			items[idx].ItemType = "vulnerability"
		}
		if len(items[idx].Data) == 0 {
			items[idx].Data = json.RawMessage(`{}`)
		}
		if items[idx].CVEID != "" && items[idx].Weakness != "" {
			for _, weakness := range cweIDPattern.FindAllString(items[idx].Weakness, -1) {
				relations = append(relations, models.IntelligenceRelation{
					SourceExternalID: items[idx].CVEID,
					TargetExternalID: strings.ToUpper(weakness),
					RelationType:     "has_weakness",
				})
			}
		}
	}
	return intelligenceCollection{Items: items, Relations: deduplicateRelations(relations), Payload: body, MediaType: format}, nil
}

func parseSTIXBundle(body []byte, feedURL string) ([]models.IntelligenceItem, []models.IntelligenceRelation, error) {
	var bundle struct {
		Objects []map[string]any `json:"objects"`
		Type    string           `json:"type"`
	}
	if err := json.Unmarshal(body, &bundle); err != nil {
		return nil, nil, fmt.Errorf("STIX 解析失败: %w", err)
	}
	if bundle.Type != "bundle" {
		return nil, nil, fmt.Errorf("STIX 根对象不是 bundle")
	}

	internalToExternal := make(map[string]string)
	phaseToTactic := make(map[string]string)
	items := make([]models.IntelligenceItem, 0, len(bundle.Objects))
	for _, object := range bundle.Objects {
		objectType := stringValue(object["type"])
		itemType := stixItemType(objectType)
		if itemType == "" || boolValue(object["revoked"]) {
			continue
		}
		externalID, sourceURL := stixExternalIdentity(object, feedURL)
		if externalID == "" {
			externalID = stringValue(object["id"])
		}
		if externalID == "" {
			continue
		}
		internalToExternal[stringValue(object["id"])] = externalID
		if itemType == "tactic" {
			phaseToTactic[stringValue(object["x_mitre_shortname"])] = externalID
		}
		metadata, _ := json.Marshal(map[string]any{
			"platforms":  object["x_mitre_platforms"],
			"deprecated": object["x_mitre_deprecated"],
			"domains":    object["x_mitre_domains"],
		})
		items = append(items, models.IntelligenceItem{
			ExternalID:  externalID,
			ItemType:    itemType,
			Title:       truncate(stringValue(object["name"]), 500),
			Summary:     truncate(stringValue(object["description"]), 8000),
			Severity:    "info",
			SourceURL:   sourceURL,
			PublishedAt: parseTime(stringValue(object["created"])),
			ModifiedAt:  parseTime(stringValue(object["modified"])),
			Data:        metadata,
		})
	}

	relations := make([]models.IntelligenceRelation, 0)
	for _, object := range bundle.Objects {
		if stringValue(object["type"]) == "relationship" {
			source := internalToExternal[stringValue(object["source_ref"])]
			target := internalToExternal[stringValue(object["target_ref"])]
			if source != "" && target != "" {
				relations = append(relations, models.IntelligenceRelation{
					SourceExternalID: source,
					TargetExternalID: target,
					RelationType:     firstNonEmpty(stringValue(object["relationship_type"]), "related_to"),
					Description:      truncate(stringValue(object["description"]), 2000),
				})
			}
			continue
		}
		if stixItemType(stringValue(object["type"])) != "technique" {
			continue
		}
		source := internalToExternal[stringValue(object["id"])]
		for _, phase := range mapSlice(object["kill_chain_phases"]) {
			target := phaseToTactic[stringValue(phase["phase_name"])]
			if source != "" && target != "" {
				relations = append(relations, models.IntelligenceRelation{
					SourceExternalID: source, TargetExternalID: target, RelationType: "belongs_to_tactic",
				})
			}
		}
	}
	return items, deduplicateRelations(relations), nil
}

func stixItemType(value string) string {
	switch value {
	case "attack-pattern":
		return "technique"
	case "x-mitre-tactic":
		return "tactic"
	case "course-of-action":
		return "mitigation"
	case "intrusion-set":
		return "group"
	case "malware", "tool":
		return "software"
	case "campaign":
		return "campaign"
	default:
		return ""
	}
}

func stixExternalIdentity(object map[string]any, fallback string) (string, string) {
	for _, reference := range mapSlice(object["external_references"]) {
		if id := stringValue(reference["external_id"]); id != "" {
			return id, firstNonEmpty(stringValue(reference["url"]), fallback)
		}
	}
	return "", fallback
}

type cweCatalog struct {
	Weaknesses []cweWeakness `xml:"Weaknesses>Weakness"`
}

type cweWeakness struct {
	ID          string `xml:"ID,attr"`
	Name        string `xml:"Name,attr"`
	Abstraction string `xml:"Abstraction,attr"`
	Status      string `xml:"Status,attr"`
	Description string `xml:"Description"`
	Extended    string `xml:"Extended_Description"`
	Related     []struct {
		Nature string `xml:"Nature,attr"`
		CWEID  string `xml:"CWE_ID,attr"`
	} `xml:"Related_Weaknesses>Related_Weakness"`
	CAPEC []struct {
		ID string `xml:"CAPEC_ID,attr"`
	} `xml:"Related_Attack_Patterns>Related_Attack_Pattern"`
}

func parseCWECatalog(body []byte, feedURL string) ([]models.IntelligenceItem, []models.IntelligenceRelation, error) {
	var catalog cweCatalog
	if err := xml.Unmarshal(body, &catalog); err != nil {
		return nil, nil, fmt.Errorf("CWE XML 解析失败: %w", err)
	}
	if len(catalog.Weaknesses) == 0 {
		return nil, nil, fmt.Errorf("CWE 目录中没有 Weakness 记录")
	}
	items := make([]models.IntelligenceItem, 0, len(catalog.Weaknesses))
	relations := make([]models.IntelligenceRelation, 0)
	for _, weakness := range catalog.Weaknesses {
		id := "CWE-" + weakness.ID
		metadata, _ := json.Marshal(map[string]string{"abstraction": weakness.Abstraction, "status": weakness.Status})
		items = append(items, models.IntelligenceItem{
			ExternalID: id,
			ItemType:   "weakness",
			Title:      truncate(weakness.Name, 500),
			Summary:    truncate(firstNonEmpty(weakness.Description, weakness.Extended), 8000),
			Severity:   "info",
			Weakness:   id,
			SourceURL:  fmt.Sprintf("https://cwe.mitre.org/data/definitions/%s.html", weakness.ID),
			Data:       metadata,
		})
		for _, related := range weakness.Related {
			if related.CWEID == "" {
				continue
			}
			relations = append(relations, models.IntelligenceRelation{
				SourceExternalID: id,
				TargetExternalID: "CWE-" + related.CWEID,
				RelationType:     normalizeRelationType(related.Nature),
			})
		}
		for _, attack := range weakness.CAPEC {
			if attack.ID != "" {
				relations = append(relations, models.IntelligenceRelation{
					SourceExternalID: id, TargetExternalID: "CAPEC-" + attack.ID, RelationType: "related_attack_pattern",
				})
			}
		}
	}
	_ = feedURL
	return items, deduplicateRelations(relations), nil
}

func normalizeRelationType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "related_to"
	}
	var result strings.Builder
	for idx, r := range value {
		if idx > 0 && r >= 'A' && r <= 'Z' {
			result.WriteByte('_')
		}
		result.WriteRune(r)
	}
	return strings.ToLower(result.String())
}

func deduplicateRelations(input []models.IntelligenceRelation) []models.IntelligenceRelation {
	seen := make(map[string]models.IntelligenceRelation, len(input))
	for _, relation := range input {
		if relation.SourceExternalID == "" || relation.TargetExternalID == "" || relation.SourceExternalID == relation.TargetExternalID {
			continue
		}
		key := relation.SourceExternalID + "\x00" + relation.TargetExternalID + "\x00" + relation.RelationType
		seen[key] = relation
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]models.IntelligenceRelation, 0, len(keys))
	for _, key := range keys {
		result = append(result, seen[key])
	}
	return result
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func mapSlice(value any) []map[string]any {
	values, _ := value.([]any)
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if object, ok := value.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}
