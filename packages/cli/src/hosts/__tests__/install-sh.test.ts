/**
 * `install.sh` is a thin wrapper (FR-INS-4, FR-INS-6): it installs the
 * package and hands over to `maina setup`. It never writes a host config
 * itself — its own `cat > settings.json` was P1, and its whole-file
 * rewrites of `mcp.json` were P8.
 */

import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const INSTALL_SH = resolve(import.meta.dir, "../../../../../install.sh");
const source = readFileSync(INSTALL_SH, "utf-8");

/** Shell code with comments and quoted strings blanked out. */
function codeOnly(sh: string): string[] {
	return sh
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.map((line) =>
			line
				.replace(/"(?:[^"\\]|\\.)*"/g, '""')
				.replace(/'[^']*'/g, "''")
				.replace(/\s#.*$/, ""),
		);
}

describe("install.sh performs no direct file writes", () => {
	test("no redirection into a file", () => {
		const offenders = codeOnly(source).filter((line) => {
			for (const m of line.matchAll(/(?<![<0-9&])(?:[0-9]|&)?>>?\s*(\S+)/g)) {
				const target = m[1] ?? "";
				if (!/^(\/dev\/null|\/dev\/tty|&[12])\b/.test(target)) return true;
			}
			return false;
		});
		expect(offenders).toEqual([]);
	});

	test("no file-mutating commands", () => {
		const mutators =
			/(^|[;&|({]\s*|\b(then|do|else)\s+)(cp|mv|rm|mkdir|touch|tee|ln|chmod|install)\s/;
		const offenders = codeOnly(source).filter(
			(line) => mutators.test(line.trim()) || /\bsed\s+-i\b/.test(line),
		);
		expect(offenders).toEqual([]);
	});

	test("it hands host configuration to `maina setup`", () => {
		expect(source).toMatch(/\bmaina setup\b/);
		expect(source).not.toMatch(/configure_mcp_|mcpServers|context_servers/);
	});
});

// ── Behaviour: run the real script with stubbed tools ─────────────────────

function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			const st = statSync(full);
			if (st.isDirectory()) walk(full);
			else out[relative(root, full)] = readFileSync(full, "utf-8");
		}
	};
	walk(root);
	return out;
}

function stub(bin: string, name: string, log: string): void {
	const path = join(bin, name);
	writeFileSync(
		path,
		`#!/bin/sh\nprintf '%s\\n' "${name} $*" >> ${JSON.stringify(log)}\n[ "$1" = "--version" ] && echo 9.9.9\nexit 0\n`,
	);
	chmodSync(path, 0o755);
}

describe("install.sh behaviour", () => {
	test("installs the package, then runs `maina setup`, writing nothing itself", async () => {
		const root = mkdtempSync(join(tmpdir(), "maina-install-sh-"));
		try {
			const home = join(root, "home");
			const cwd = join(root, "project");
			const bin = join(root, "bin");
			const log = join(root, "calls.log");
			for (const d of [home, cwd, bin]) mkdirSync(d, { recursive: true });
			// A user who already has host configs the old script clobbered.
			mkdirSync(join(home, ".cursor"), { recursive: true });
			writeFileSync(join(home, ".cursor", "mcp.json"), '{"mcpServers":{}}\n');
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), '{"hooks":{}}\n');
			for (const tool of ["bun", "maina", "claude", "cursor", "codex"]) {
				stub(bin, tool, log);
			}
			Bun.spawnSync(["git", "init", "-q"], { cwd });

			const before = { home: snapshot(home), cwd: snapshot(cwd) };
			const proc = Bun.spawn(["/bin/bash", INSTALL_SH], {
				cwd,
				env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect({ code, stderr, stdout: stdout.slice(-500) }).toMatchObject({
				code: 0,
			});
			expect({ home: snapshot(home), cwd: snapshot(cwd) }).toEqual(before);

			const calls = readFileSync(log, "utf-8").trim().split("\n");
			expect(calls).toContain("bun install -g @mainahq/cli");
			expect(calls).toContain("maina setup --yes");
			// Nothing but the package manager and maina itself is run.
			expect(
				calls.filter((c) => !c.startsWith("bun ") && !c.startsWith("maina ")),
			).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
