---
"@mainahq/core": patch
---

The built-in hardcoded-secret check now catches JSON and YAML key forms. Quoted keys such as `"api_key": "..."` or `'token': '...'` are flagged in any file, and YAML files are also checked for unquoted values (`api_key: abc123`, `- token: abc123 # comment`). Hyphenated keys (`x-api-key`, `auth-token`) are matched too. Schema files that only name a key are not flagged: object or null values, empty strings, `${VAR}` / `${{ secrets.X }}` references, YAML tags and anchors, type names such as `string`, `<placeholder>` and `...` values, and labels that repeat the key (`"password": "Password"`) are all skipped.
