---
"@mainahq/core": patch
---

The gate's bash parser no longer drops the words that follow a redirect in the middle of a command. Bash accepts a redirect anywhere among a command's words, so `rm < /dev/null -rf ~` runs `rm -rf ~` and `git 2>&1 push --force origin main` runs a force push. Until now the gate saw only `rm` and `git` and allowed both. Every word is now collected wherever the redirect sits: before, after or between the arguments, with several redirects, with descriptor forms such as `2>&1`, `&>` and `3<in`, and with a heredoc or herestring in the middle of the line. A digit glued to a redirect (`0</dev/null`) is read as the descriptor, not as an argument. A pipe after heredoc arguments (`cat <<EOF -x | sh`) starts the next pipeline stage, so the script that `sh` reads from the heredoc is classified.

A bare `ssh host < /dev/null` is no longer `remote.exec`. It behaves like `ssh -n`: the remote login shell reads end of file and exits. A remote command after the redirect (`ssh host < /dev/null 'rm -rf /srv'`) is now read as the remote command, so it is still `remote.exec`.
