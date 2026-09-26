/**
 * Compiled by `../embedded-tree-sitter.test.ts` with `bun build --compile`,
 * like the standalone runtime (`../../main.ts`), then run with no
 * `node_modules` to reach. Starts up the way the standalone does, then
 * prints one JSON line: whether the bash grammar loaded, what the Claude
 * Code gate answers for a harmless and a destructive Bash command, and
 * whether every code-graph grammar parses.
 *
 *   tree-sitter-probe <cwd> <home>
 */

import { type GraphLang, loadShellParser, parseFile } from "@mainahq/core";
import { runClaudeHook } from "../../../claude-hook";
import { systemGates } from "../../../gate-system";
import { useEmbeddedTreeSitter } from "../../tree-sitter-assets";

// What `../../main.ts` does before a mode that parses.
useEmbeddedTreeSitter();

const [cwd = process.cwd(), home = cwd] = process.argv.slice(2);

const shell = await loadShellParser();
const { runtime: gate } = systemGates({ home });

async function decide(command: string): Promise<string> {
	const run = await runClaudeHook(
		JSON.stringify({
			session_id: "probe",
			transcript_path: `${cwd}/transcript.jsonl`,
			cwd,
			hook_event_name: "PreToolUse",
			permission_mode: "default",
			tool_name: "Bash",
			tool_input: { command, description: command },
			tool_use_id: "toolu_probe",
		}),
		{
			evaluate: async (event) => gate(event),
			sessionSummary: async () => undefined,
		},
		"PreToolUse",
	);
	const out = JSON.parse(run.output.stdout) as {
		hookSpecificOutput?: { permissionDecision?: string };
	};
	return out.hookSpecificOutput?.permissionDecision ?? run.output.stdout;
}

const SAMPLES: Readonly<Record<GraphLang, readonly [string, string]>> = {
	typescript: ["a.ts", "export const a = 1;"],
	tsx: ["a.tsx", "export const A = () => <div />;"],
	javascript: ["a.js", "export function a() {}"],
	python: ["a.py", "def a():\n    pass\n"],
	go: ["a.go", "package a\nfunc A() {}\n"],
	rust: ["a.rs", "fn a() {}\n"],
	java: ["A.java", "class A {}\n"],
};

const graph: Record<string, string> = {};
for (const [lang, [path, content]] of Object.entries(SAMPLES)) {
	const parsed = await parseFile(path, content, lang as GraphLang);
	graph[lang] = parsed.ok ? "ok" : JSON.stringify(parsed.error);
}

process.stdout.write(
	`${JSON.stringify({
		shell: shell.ok ? "ok" : shell.error,
		echo: await decide("echo hello"),
		wipe: await decide("rm -rf ~/.claude"),
		graph,
	})}\n`,
);
