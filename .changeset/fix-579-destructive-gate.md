---
"@mainahq/core": patch
---

The default gate now stops destructive repo, cloud and hook actions it used to allow:

- `gh repo delete` and MCP tools such as `delete_repository` are `git.discard` (ask).
- Cloud CLI deletes are `db.destructive` for data stores (`aws rds delete-db-instance`, `aws dynamodb delete-table`, `aws s3 rb`, `aws s3 rm --recursive`, `gcloud sql instances delete`, `az sql db delete`, `heroku pg:reset`, `gsutil rb`) and `deploy` for other live resources (`aws ec2 terminate-instances`, `gcloud projects delete`, `az group delete`, `heroku apps:destroy`). Both ask. Routine per-item deletes such as `aws sqs delete-message` still pass.
- MCP tools whose name ends on the resource they delete (`s3_delete_bucket`, `delete_namespace`, `drop_table`) get the same classes.
- Pointing `core.hooksPath` where no repo hook runs is `gate.self_override` and is denied. That covers `/dev/null`, an empty value, a directory outside the workspace, unsetting it, removing `[core]`, and `git -c core.hooksPath=…`. Repo hook directories such as `.githooks` and `.husky/_` stay allowed.
- The same actions through other spellings are caught too: `gh api -X DELETE repos/<owner>/<repo>`, `heroku addons:destroy`, MCP names with a trailing qualifier (`delete_table_by_name`, `drop_table_if_exists`), `gcloud`/`az` global options before the group, and `core.hooksPath` set through `git --config-env`, `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_PARAMETERS`, or pointed at a directory inside `.git` other than `.git/hooks`.
