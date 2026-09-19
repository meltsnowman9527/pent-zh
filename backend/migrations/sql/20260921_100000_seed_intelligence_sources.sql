-- +goose Up
-- +goose StatementBegin

INSERT INTO intelligence_sources
  (user_id, name, description, url, format, schedule, enabled, builtin, status, next_sync_at)
SELECT users.id, defaults.name, defaults.description, defaults.url, defaults.format,
       defaults.schedule, TRUE, TRUE, 'pending', CURRENT_TIMESTAMP
  FROM users
 CROSS JOIN (VALUES
   ('CISA 已知在野利用漏洞', 'CISA Known Exploited Vulnerabilities，记录已确认在野利用的 CVE。', 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', 'json', 'daily'),
   ('NVD 最近更新漏洞', 'NVD CVE 2.0 最近更新数据，包含 CVSS、CWE 与漏洞描述。', 'https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json.gz', 'json', 'daily'),
   ('MITRE ATT&CK Enterprise', 'MITRE ATT&CK 企业域的战术、技术、组织、软件和缓解措施。', 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json', 'stix', 'weekly'),
   ('MITRE CWE', 'MITRE CWE 弱点目录及弱点之间的层级和关联关系。', 'https://cwe.mitre.org/data/xml/cwec_latest.xml.zip', 'cwe', 'weekly')
 ) AS defaults(name, description, url, format, schedule)
ON CONFLICT (user_id, url) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  format=EXCLUDED.format,
  builtin=TRUE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Source rows are user-visible data and may already have been synchronized or
-- configured after the upgrade. A rollback leaves them intact; the preceding
-- schema rollback converts STIX/CWE formats to generic JSON if it is also run.

-- +goose StatementEnd
