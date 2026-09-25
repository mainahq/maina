/**
 * Runtime daemon entry, started by `daemonSpawner` when running from source
 * (ADR 0044). Arguments and exit codes: see `daemon-main.ts`.
 */

import { runDaemon } from "./daemon-main";

process.exit(await runDaemon(process.argv.slice(2)));
