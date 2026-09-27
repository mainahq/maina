---
"@mainahq/core": patch
---

The gate now reads the remaining ways a command can run on another machine, or through another program on this one. Before this change it allowed each of them without looking at the command.

A command run on a host, container or task the gate cannot see is now `remote.exec` and asks. This covers `kubectl exec`, `docker exec`, `podman exec`, `nerdctl exec` and `docker compose exec`, as well as `gcloud compute ssh --command` (or a command after `--`), `aws ssm send-command`, `aws ecs execute-command`, and an `aws ssm start-session` whose document runs a command. It also covers `rsync --rsync-path` with anything other than an rsync binary, and `sftp -s` naming a server program. A login or a tunnel with these tools stays clear.

A program that rsync, scp or sftp runs locally in place of ssh is now classified with its own command: `rsync -e`/`--rsh`, `scp -S`, `sftp -D`, and `-o ProxyCommand`. So `rsync -e 'sh -c "rm -rf ~"'` is a recursive delete. The value of `-e` is no longer read as a source path, so `rsync -e 'ssh -i ~/.ssh/key'` no longer asks as a secret read. Every `find -exec`, `-execdir`, `-ok` and `-okdir` command is now classified in full, not only checked for `rm`. Text piped into a subshell, group or loop (`… | (ssh host)`, `curl … | (cd /tmp && bash)`) reaches the commands inside it. `docker rm -v`, `docker container rm --volumes` and `docker compose rm -v` delete a container's anonymous volumes, so they are now `system.destructive`. `nerdctl` gets the same docker rules.
