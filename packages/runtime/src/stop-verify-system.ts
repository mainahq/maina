/**
 * The real ports for verify on session stop (FR-VER-7): roots come from git
 * through the async probe (FR-INS-3), and verify is core's pipeline on the
 * session's files, diff-only against the base branch, as `maina verify`
 * runs it. A repository maina was never set up in (no `.maina/`) is left
 * alone, as is a session whose edited files are all gone: its stop runs
 * nothing.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runPipeline, systemProcess } from "@mainahq/core";
import { realPath } from "./graph-hooks";
import { asyncGitProbe, resolveRootAsync } from "./root";
import type { StopVerifyPorts } from "./stop-verify";

export function systemStopVerifyPorts(): StopVerifyPorts {
	return {
		rootOf: async (dir) => {
			const root = await resolveRootAsync({ cwd: dir }, asyncGitProbe);
			return root.ok ? root.value.path : null;
		},
		verify: async (root, files) => {
			const mainaDir = join(root, ".maina");
			// A file the session deleted has nothing left to check.
			const present = files.filter((file) => existsSync(join(root, file)));
			if (!existsSync(mainaDir) || present.length === 0) return null;
			const result = await runPipeline({
				cwd: root,
				files: present,
				mainaDir,
				env: process.env,
				process: systemProcess,
			});
			return {
				status: result.status,
				findings: result.findings.length,
				files: result.scope.files.length,
			};
		},
		// git reports the root with symlinks resolved; hosts may not.
		canonical: realPath,
	};
}
