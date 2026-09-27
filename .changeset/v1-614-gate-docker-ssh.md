---
"@mainahq/core": patch
---

The gate now asks before two kinds of destructive action that the default policy used to allow.

- Deleting Docker data is `system.destructive`. This covers `docker volume prune`, `docker volume rm`, `docker system prune` with `--volumes` or `-a`, `docker image prune -a`, `docker compose down -v` (and `docker-compose`), and `podman system reset`. Podman is handled the same way as Docker. Global options such as `-H ssh://host` or `--context prod` are skipped before the subcommand is read. A plain `docker system prune` or `docker image prune` is still allowed, because neither removes volumes or tagged images.
- A command that runs on another machine over ssh is `remote.exec`. This covers `ssh host cmd`, `-o RemoteCommand=…`, and a script sent to a bare `ssh host` through a heredoc, herestring, `< file` or pipe. It also applies when the command goes through `sshpass`. A `ProxyCommand` or `LocalCommand` runs on the local machine, so it is classified as shell. A login, a tunnel (`-N`, `-L`, `-D`), `ssh -T git@github.com` and `ssh -G` are still allowed.
