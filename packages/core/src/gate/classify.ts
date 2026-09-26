/**
 * `classifyAction` (FR-GATE-2, FR-GATE-4): which action classes an event
 * falls in. The rules engine turns classes into a verdict; this module only
 * observes.
 *
 * The shell walk resolves what it can (variable values it saw assigned,
 * quoting, wrappers, nesting, substitutions) and treats the rest as
 * `shell.opaque`, so a command the gate cannot understand still asks rather
 * than slips through. Every branch of a conditional, loop or `case` is
 * visited: the gate cannot know which one runs.
 */

import type { ActionClass } from "../policy/defaults";
import {
	DEFAULT_PROTECTED_BRANCHES,
	type GateContext,
	type GateEvent,
} from "./events";
import type {
	Assignment,
	Redirect,
	ShellNode,
	ShellParser,
	ShellScript,
	ShellWord,
	WordPart,
} from "./parsers/shell";
import { literalText } from "./parsers/shell";
import { isDestructiveSql } from "./parsers/sql";
import {
	isBlockDevice,
	isInside,
	isSafeDevice,
	isScratchPath,
	resolvePath,
} from "./paths";
import {
	containsSecret,
	isCredentialStorePath,
	isSecretPath,
	isSecretVarName,
} from "./secrets";

export type ActionAnalysis = Readonly<{
	classes: readonly ActionClass[];
	/**
	 * For a shell event, every simple command in the line as a normalised
	 * `argv` string (wrappers stripped, the executable reduced to its base
	 * name, variables and simple substitutions resolved, nested `sh -c`/`eval`
	 * scripts included). Empty for other kinds. Rule matching uses it so a deny
	 * cannot be dodged by chaining or nesting, and an allow only fires when
	 * every command in the line is covered.
	 */
	commands: readonly string[];
}>;

export function analyzeAction(
	event: GateEvent,
	ctx: GateContext,
): ActionAnalysis {
	const set = new Set<ActionClass>();
	const commands: string[] = [];
	switch (event.kind) {
		case "shell":
			classifyShell(
				event.action.command,
				event.action.cwd ?? event.root,
				event,
				ctx,
				set,
			);
			collectCommands(event.action.command, ctx, commands);
			break;
		case "file.write":
			classifyWrite(event.action.path, event.action.content, event, ctx, set);
			break;
		case "file.read.outside":
			classifyRead(event.action.path, event, ctx, set);
			break;
		case "mcp":
			classifyMcp(event, ctx, set);
			break;
		case "network":
			set.add("network.fetch");
			break;
		default:
			assertNever(event);
	}
	return { classes: [...set], commands };
}

export function classifyAction(
	event: GateEvent,
	ctx: GateContext,
): readonly ActionClass[] {
	return analyzeAction(event, ctx).classes;
}

/** Exhaustiveness guard: the compiler proves `x` is `never`, so this is dead. */
function assertNever(x: never): never {
	return x;
}

// ── File events ───────────────────────────────────────────────────────────

function classifyWrite(
	path: string,
	content: string | undefined,
	event: GateEvent,
	ctx: GateContext,
	out: Set<ActionClass>,
): void {
	const resolved = resolvePath(path, event.root, ctx.home);
	if (
		isCredentialStorePath(resolved ?? path) ||
		isSecretPath(resolved ?? path)
	) {
		out.add("secrets.write");
	}
	if (content !== undefined && containsSecret(content))
		out.add("secrets.write");
	if (isGateControlFile(resolved ?? path)) out.add("gate.self_override");
	if (isOutsideWorkspace(resolved, event.root)) out.add("fs.write.outside");
	if (out.size === 0) out.add("fs.write");
}

function classifyRead(
	path: string,
	event: GateEvent,
	ctx: GateContext,
	out: Set<ActionClass>,
): void {
	const resolved = resolvePath(path, event.root, ctx.home);
	if (isSecretPath(resolved ?? path)) {
		out.add("secrets.read");
	} else if (isOutsideWorkspace(resolved, event.root)) {
		out.add("fs.read.outside");
	} else {
		// Hosts report every file read (Claude Code's Read, Grep, Glob), so a
		// plain workspace read needs a class of its own, like `fs.write`;
		// without one it would reach the backend with no class and ask.
		out.add("fs.read");
	}
}

// ── Gate control files (#447) ───────────────────────────────────────────────

/**
 * Files that configure the gate itself: a maina policy (`.maina/policy*`, in
 * the repo or the user's home) and the host hook configs that run maina
 * (`.claude/settings*.json`, `.cursor/hooks.json`, `.codex/hooks.json`,
 * `.codex/config.toml`). An agent writing, moving or deleting one could
 * override its own gate, so each is `gate.self_override`. The match ignores
 * letter case: macOS and Windows file systems do, so `.Claude/Settings.json`
 * is the same file there.
 */
function isGateControlFile(path: string): boolean {
	const segments = path.toLowerCase().split(/[\\/]+/);
	const name = segments.at(-1) ?? "";
	switch (segments.at(-2)) {
		case ".maina":
			return name.startsWith("policy");
		case ".claude":
			return /^settings(\.[^.]+)*\.json$/.test(name);
		case ".cursor":
			return name === "hooks.json";
		case ".codex":
			return name === "hooks.json" || name === "config.toml";
		default:
			return false;
	}
}

const GATE_CONTROL_DIRS: ReadonlySet<string> = new Set([
	".maina",
	".claude",
	".cursor",
	".codex",
]);

/** Whether a path segment names a control dir, in any letter case. */
const isGateControlDir = (segment: string): boolean =>
	GATE_CONTROL_DIRS.has(segment.toLowerCase());

/** The last path segment, ignoring a trailing slash (`~/.claude/`). */
const lastSegment = (path: string): string =>
	path
		.split(/[\\/]+/)
		.filter((s) => s !== "")
		.at(-1) ?? "";

/** Deleting or moving a path removes a control file when it is one or holds one. */
function removesGateControl(path: string): boolean {
	return isGateControlDir(lastSegment(path)) || isGateControlFile(path);
}

/**
 * Where a copy, move or link lands. When the destination is a directory
 * each source lands at `DEST/<its name>`, and the gate cannot know which, so
 * both readings count. Landing on a control file, pouring a tree's contents
 * into a control dir (`cp -r x/. .maina`, `rsync -a x/ .claude/`) or putting
 * a control dir in place as a tree (`cp -r x/.maina .`) is
 * `gate.self_override`. Any other tree put into, or as, a control dir might
 * carry a control file, so it asks (`shell.opaque`). Scratch landings are
 * backups, not the gate's config.
 */
function landsOnGateControl(
	args: Argv,
	cwd: string | null,
	ctx: ShellCtx,
	how: Readonly<{ tree: boolean; targetOption: boolean }>,
): void {
	const { destination, sources } = copyOperands(args, how.targetOption);
	if (destination === undefined) return;
	const dest = resolvePath(destination, cwd, ctx.gate.home) ?? destination;
	if (isScratchPath(dest)) return;
	if (isGateControlFile(dest)) ctx.out.add("gate.self_override");
	const intoControlDir = isGateControlDir(lastSegment(dest));
	for (const source of sources) {
		const name = source.split(/[\\/]/).at(-1) ?? "";
		if (name === "" || name === ".") {
			if (how.tree && intoControlDir) ctx.out.add("gate.self_override");
		} else if (
			isGateControlFile(`${dest}/${name}`) ||
			(how.tree && isGateControlDir(name))
		) {
			ctx.out.add("gate.self_override");
		} else if (how.tree && intoControlDir) {
			ctx.out.add("shell.opaque");
		}
	}
}

/**
 * A link that stands in for a control dir (`ln -sfn /tmp/evil .claude`) swaps
 * the gate's config for another tree, and a link to a control path
 * (`ln -s .claude/settings.json /tmp/s`) lets a later write reach it where
 * the gate sees only the link (#513). A link target resolves against the
 * link's directory, not the shell's, so it is also matched as written.
 */
function linksGateControl(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	const { destination, sources } = copyOperands(args, true);
	if (destination === undefined) return;
	const dest = resolvePath(destination, cwd, ctx.gate.home) ?? destination;
	const linksToControl = sources.some(
		(source) =>
			removesGateControl(source) ||
			removesGateControl(resolvePath(source, cwd, ctx.gate.home) ?? source),
	);
	if (isGateControlDir(lastSegment(dest)) || linksToControl)
		ctx.out.add("gate.self_override");
}

/** `cp`/`mv`/`ln`/`install` take `-t DIR`; otherwise the last operand is the destination. */
function copyOperands(
	args: Argv,
	targetOption: boolean,
): Readonly<{ destination: string | undefined; sources: readonly string[] }> {
	const literals = literalArgs(args);
	const pos = positional(args);
	const at = literals.findIndex(
		(a) => a === "-t" || a === "--target-directory",
	);
	const target = !targetOption
		? undefined
		: at >= 0
			? literals[at + 1]
			: literals
					.find((a) => a.startsWith("--target-directory="))
					?.slice("--target-directory=".length);
	if (target !== undefined)
		return { destination: target, sources: pos.filter((p) => p !== target) };
	return { destination: pos.at(-1), sources: pos.slice(0, -1) };
}

/** `cp -r`, `cp -a`, `rsync -a`: the copy takes directories whole. */
function copiesTree(args: Argv): boolean {
	return literalArgs(args).some(
		(a) =>
			/^-[a-zA-Z]*[rRa]/.test(a) || a === "--recursive" || a === "--archive",
	);
}

/** True only when the path is known and lands outside the workspace and scratch dirs. */
function isOutsideWorkspace(resolved: string | null, root: string): boolean {
	if (resolved === null) return true;
	return !isInside(resolved, root) && !isScratchPath(resolved);
}

// ── MCP events ──────────────────────────────────────────────────────────────

function classifyMcp(
	event: Extract<GateEvent, { kind: "mcp" }>,
	ctx: GateContext,
	out: Set<ActionClass>,
): void {
	out.add("mcp.call");
	const input = event.action.input ?? {};
	for (const key of ["sql", "query", "statement"]) {
		const v = input[key];
		if (typeof v === "string" && isDestructiveSql(v)) out.add("db.destructive");
	}
	for (const key of ["command", "cmd", "script"]) {
		const v = input[key];
		if (typeof v === "string") {
			classifyShell(v, event.root, event, ctx, out);
		}
	}
	if (mcpTouchesGateControl(event, ctx)) out.add("gate.self_override");
}

/** Input keys an MCP filesystem tool names a path with (`path`, `file_path`, `destination`, `uri`). */
const MCP_PATH_KEY =
	/path|file|dir|folder|dest|target|source|src|uri|^to$|^from$/i;

/**
 * Tool-name words that only read, or only analyse what they read (maina's own
 * `verify`, `impact`, `context`, `review_triage`).
 */
const MCP_READ_VERBS: ReadonlySet<string> = new Set([
	"read",
	"get",
	"list",
	"search",
	"find",
	"view",
	"stat",
	"info",
	"tree",
	"show",
	"describe",
	"head",
	"tail",
	"glob",
	"grep",
	"cat",
	"ls",
	"verify",
	"check",
	"review",
	"triage",
	"impact",
	"context",
	"analyze",
	"analyse",
	"inspect",
	"lint",
	"diff",
	"query",
	"fetch",
	"explain",
]);

/** Tool-name words that change a file, overriding any read word beside them. */
const MCP_WRITE_VERBS: ReadonlySet<string> = new Set([
	"write",
	"edit",
	"create",
	"mkdir",
	"put",
	"set",
	"patch",
	"append",
	"insert",
	"update",
	"modify",
	"save",
	"upload",
	"touch",
	"truncate",
	"apply",
	"overwrite",
	"rewrite",
	"fix",
	"format",
	"restore",
	"revert",
	"reset",
	"clear",
]);

/** Tool-name words that remove or replace what a path names, a directory included. */
const MCP_REPLACE_VERBS: ReadonlySet<string> = new Set([
	"move",
	"mv",
	"rename",
	"delete",
	"remove",
	"rm",
	"rmdir",
	"unlink",
	"link",
	"symlink",
	"chmod",
	"chown",
	"copy",
	"cp",
	"replace",
]);

/**
 * An MCP tool that writes, moves, deletes or links a gate control file, or
 * removes or replaces a control dir, from a path in its input (#513). The
 * tool name tells a read (`read_file`, `get_file_info`) from a change; a
 * name the gate cannot read counts as a change, so it fails closed.
 */
function mcpTouchesGateControl(
	event: Extract<GateEvent, { kind: "mcp" }>,
	ctx: GateContext,
): boolean {
	const words = event.action.tool
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.split(/[^a-z0-9]+/);
	const replaces = words.some((w) => MCP_REPLACE_VERBS.has(w));
	const changes =
		replaces ||
		words.some((w) => MCP_WRITE_VERBS.has(w)) ||
		!words.some((w) => MCP_READ_VERBS.has(w));
	if (!changes) return false;
	return mcpPaths(event.action.input ?? {}, false, 0).some((raw) => {
		const path = raw.replace(/^file:\/\//i, "");
		const resolved = resolvePath(path, event.root, ctx.home) ?? path;
		return (
			isGateControlFile(resolved) ||
			(replaces && isGateControlDir(lastSegment(resolved)))
		);
	});
}

/** Every string under a path-like key in an MCP input, nested arrays and objects included. */
function mcpPaths(
	value: unknown,
	pathKey: boolean,
	depth: number,
): readonly string[] {
	if (depth > 8) return [];
	if (typeof value === "string") return pathKey ? [value] : [];
	if (Array.isArray(value))
		return value.flatMap((v) => mcpPaths(v, pathKey, depth + 1));
	if (value === null || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, v]) =>
		mcpPaths(v, MCP_PATH_KEY.test(key), depth + 1),
	);
}

// ── Shell events ────────────────────────────────────────────────────────────

/** A resolved argument vector: literal words with unknown parts marked. */
type Argv = readonly Arg[];
type Arg = Readonly<{ text: string | null; raw: string }>;

/** Variables the walk has seen assigned to a literal value, for `$X` resolution. */
type Scope = Map<string, string | null>;

type ShellCtx = Readonly<{
	event: GateEvent;
	gate: GateContext;
	protectedBranches: readonly string[];
	out: Set<ActionClass>;
	/** Basenames of files a fetch in this command wrote, for download-then-run. */
	downloads: Set<string>;
}>;

function classifyShell(
	command: string,
	cwd: string,
	event: GateEvent,
	gate: GateContext,
	out: Set<ActionClass>,
): void {
	out.add("shell.exec");
	const parser = gate.shell;
	if (parser === null) {
		out.add("shell.opaque");
		return;
	}
	const parsed = (parser as ShellParser).parse(command);
	if (!parsed.ok) {
		out.add("shell.opaque");
		return;
	}
	if (parsed.value.errors.length > 0) out.add("shell.opaque");
	const shellCtx: ShellCtx = {
		event,
		gate,
		protectedBranches: gate.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
		out,
		downloads: new Set(),
	};
	const scope: Scope = new Map();
	if (gate.home !== undefined) scope.set("HOME", gate.home);
	walkScript(parsed.value, cwd, scope, shellCtx);
}

function walkScript(
	script: ShellScript,
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): string | null {
	let dir = cwd;
	for (const node of script.nodes) {
		dir = walkNode(node, dir, scope, ctx);
	}
	return dir;
}

/** Returns the working directory after the node (a `cd` changes it). */
function walkNode(
	node: ShellNode,
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): string | null {
	switch (node.kind) {
		case "assign":
			for (const a of node.assignments) recordAssignment(a, scope, ctx);
			// `export`/`declare -p`/`export -p` with no assignment lists the
			// environment, which exposes secrets.
			if (
				node.keyword !== null &&
				["export", "declare", "readonly", "typeset"].includes(node.keyword) &&
				node.assignments.length === 0
			) {
				ctx.out.add("secrets.read");
			}
			return cwd;
		case "command":
			return walkCommand(node, cwd, scope, ctx);
		case "pipeline":
			walkPipeline(node.stages, cwd, scope, ctx);
			return cwd;
		case "sequence": {
			let dir = cwd;
			for (const inner of node.nodes) dir = walkNode(inner, dir, scope, ctx);
			// A redirect on a group or list applies after its commands run, so
			// it resolves against the working directory they left behind.
			redirectClasses(node.redirects, dir, scope, ctx);
			return dir;
		}
		case "loop":
			// The item list is expanded before the body runs (`for f in $(…)`).
			for (const item of node.items ?? []) {
				scanWordSubstitutions(item, scope, ctx);
			}
			walkNode(node.body, cwd, scope, ctx);
			return cwd;
		case "function":
			// Defining a function is inert; its body runs when it is called, but
			// we scan it anyway so an obfuscated `f(){ rm -rf /; }; f` is caught.
			if (isForkBomb(node.name, node.body)) ctx.out.add("system.destructive");
			walkNode(node.body, cwd, scope, ctx);
			return cwd;
		case "unknown":
			ctx.out.add("shell.opaque");
			return cwd;
		default:
			return assertNever(node);
	}
}

/** A function that spawns itself twice in a backgrounded pipeline (`:(){ :|:& };:`). */
function isForkBomb(name: string, body: ShellNode): boolean {
	let selfCalls = 0;
	const count = (node: ShellNode): void => {
		switch (node.kind) {
			case "command": {
				const exe = node.argv[0];
				if (exe && literalText(exe) === name) selfCalls++;
				break;
			}
			case "pipeline":
				for (const s of node.stages) count(s);
				break;
			case "sequence":
				for (const n of node.nodes) count(n);
				break;
			default:
				break;
		}
	};
	count(body);
	return selfCalls >= 2;
}

function recordAssignment(a: Assignment, scope: Scope, ctx: ShellCtx): void {
	// Substitutions in the value still run.
	if (a.value) scanWordSubstitutions(a.value, scope, ctx);
	scope.set(a.name, a.value === null ? null : resolveWord(a.value, scope));
}

function walkCommand(
	node: Extract<ShellNode, { kind: "command" }>,
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): string | null {
	for (const a of node.assignments) recordAssignment(a, scope, ctx);
	redirectClasses(node.redirects, cwd, scope, ctx);
	// Words carry substitutions that run regardless of the command.
	for (const word of node.argv) scanWordSubstitutions(word, scope, ctx);

	const argv = resolveArgv(node.argv, scope);
	const { rest, wrapped, bulk } = stripWrappers(argv, scope, ctx, cwd);
	if (rest.length === 0) return cwd;

	const exe = rest[0] as Arg;
	if (exe.text === null) {
		ctx.out.add("shell.opaque");
		return cwd;
	}
	const cmd = baseCommand(exe.text);
	const args = rest.slice(1);
	const runFrom = cwd ?? ctx.event.root;

	// `cd` changes the working directory for what follows.
	if ((cmd === "cd" || cmd === "pushd") && !wrapped) {
		return nextCwd(args, cwd, ctx);
	}

	// Running a script that was just downloaded, or an executor whose argument
	// fetches one (`bash <(curl …)`, `sh -c "$(curl …)"`): remote code.
	if (isExecutor(cmd) && argvFetches(node.argv)) ctx.out.add("remote.exec");
	if (runsDownload(cmd, exe.text, args, ctx)) ctx.out.add("remote.exec");

	// Nested shells: their `-c` script or their stdin is shell too.
	if (isShell(cmd)) {
		const script = shellCScript(args);
		if (script !== undefined) {
			if (script === null) ctx.out.add("shell.opaque");
			else classifyShell(script, runFrom, ctx.event, ctx.gate, ctx.out);
			return cwd;
		}
		const stdin = stdinText(node.redirects, scope);
		if (stdin === null) ctx.out.add("shell.opaque");
		else if (stdin !== undefined)
			classifyShell(stdin, runFrom, ctx.event, ctx.gate, ctx.out);
		return cwd;
	}
	if (cmd === "eval") {
		const joined = joinLiteral(args);
		if (joined === null) ctx.out.add("shell.opaque");
		else classifyShell(joined, runFrom, ctx.event, ctx.gate, ctx.out);
		return cwd;
	}
	// `script` runs its `-c` string, or the command after its log file (#513).
	if (cmd === "script") {
		for (const inner of scriptCommands(args)) {
			if (inner === null) ctx.out.add("shell.opaque");
			else classifyShell(inner, runFrom, ctx.event, ctx.gate, ctx.out);
		}
		return cwd;
	}
	// Inline code in another interpreter is beyond the gate's sight.
	if (INLINE_INTERPRETERS.has(cmd) && hasInlineCode(args)) {
		ctx.out.add("shell.opaque");
	}
	// A destructive SQL body fed on stdin (`psql <<'SQL' … DROP …`).
	if (isSqlTool(cmd)) {
		const stdin = stdinText(node.redirects, scope);
		if (stdin != null && isDestructiveSql(stdin)) ctx.out.add("db.destructive");
	}
	// A migration or deploy run pinned to production (`RAILS_ENV=production …`).
	if (MIGRATION_TOOLS.has(cmd) && hasProdEnv(node.assignments, scope)) {
		ctx.out.add("db.production");
	}
	// Echoing a secret-shaped variable exposes it.
	if ((cmd === "echo" || cmd === "printf") && argvExposesSecret(node.argv)) {
		ctx.out.add("secrets.read");
	}
	// A file read that lands on a credential (`cat .env`, `grep KEY .env.local`).
	if (READERS.has(cmd)) {
		for (const target of positional(args)) readTargets(target, cwd, ctx);
	}

	classifyCommand(cmd, args, cwd, scope, ctx, bulk);
	return cwd;
}

/** Reader commands whose path arguments could expose a secret file. */
const READERS: ReadonlySet<string> = new Set([
	"cat",
	"tac",
	"nl",
	"less",
	"more",
	"head",
	"tail",
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"ag",
	"strings",
	"base64",
	"xxd",
	"od",
	"hexdump",
	"awk",
	"cut",
	"sort",
	"view",
	"bat",
]);

const MIGRATION_TOOLS: ReadonlySet<string> = new Set([
	"rails",
	"rake",
	"prisma",
	"knex",
	"sequelize",
	"alembic",
	"artisan",
	"flyway",
]);

/** A prefix like `RAILS_ENV=production` or `DATABASE_URL=postgres://prod/…`. */
function hasProdEnv(assignments: readonly Assignment[], scope: Scope): boolean {
	return assignments.some((a) => {
		if (/_ENV$/.test(a.name)) {
			return a.value !== null && resolveWord(a.value, scope) === "production";
		}
		if (/_URL$/.test(a.name) || a.name.includes("DATABASE")) {
			const value = a.value === null ? null : resolveWord(a.value, scope);
			return value !== null && PROD_HOST.test(value);
		}
		return false;
	});
}

function argvExposesSecret(argv: readonly ShellWord[]): boolean {
	return argv.some((word) =>
		word.parts.some((p) => p.kind === "param" && isSecretVarName(p.name)),
	);
}

const INLINE_INTERPRETERS: ReadonlySet<string> = new Set([
	"python",
	"python2",
	"python3",
	"node",
	"nodejs",
	"ruby",
	"perl",
	"php",
]);

const isExecutor = (cmd: string): boolean =>
	isShell(cmd) ||
	cmd === "eval" ||
	cmd === "source" ||
	cmd === "." ||
	INLINE_INTERPRETERS.has(cmd) ||
	cmd === "at";

function hasInlineCode(args: Argv): boolean {
	return args.some(
		(a) =>
			a.text === "-c" ||
			a.text === "-e" ||
			a.text === "-r" ||
			a.text === "--eval",
	);
}

const FETCHERS: ReadonlySet<string> = new Set([
	"curl",
	"wget",
	"http",
	"httpie",
]);

/** Whether any word runs a fetch inside a substitution (`$(curl …)`, `<(curl …)`). */
function argvFetches(argv: readonly ShellWord[]): boolean {
	return argv.some(wordFetches);
}

function wordFetches(word: ShellWord): boolean {
	return word.parts.some((part) => {
		if (part.kind === "subst" || part.kind === "procsubst") {
			return scriptFetches(part.script);
		}
		return part.kind === "param" && part.fallback
			? wordFetches(part.fallback)
			: false;
	});
}

function scriptFetches(script: ShellScript): boolean {
	return script.nodes.some(nodeFetches);
}

function nodeFetches(node: ShellNode): boolean {
	switch (node.kind) {
		case "command": {
			const exe = node.argv[0];
			const text = exe ? literalText(exe) : null;
			return text !== null && FETCHERS.has(baseCommand(text));
		}
		case "pipeline":
			return node.stages.some(nodeFetches);
		case "sequence":
			return node.nodes.some(nodeFetches);
		case "loop":
		case "function":
			return nodeFetches(node.body);
		default:
			return false;
	}
}

/** `sh /tmp/i.sh`, `./tool`: running a path a fetch in this command wrote. */
function runsDownload(
	cmd: string,
	exe: string,
	args: Argv,
	ctx: ShellCtx,
): boolean {
	if (ctx.downloads.size === 0) return false;
	if (ctx.downloads.has(baseCommand(exe))) return true;
	if (!isShell(cmd) && !INLINE_INTERPRETERS.has(cmd)) return false;
	return positional(args).some((a) => ctx.downloads.has(baseCommand(a)));
}

const SQL_TOOLS: ReadonlySet<string> = new Set([
	"psql",
	"mysql",
	"sqlite3",
	"sqlcmd",
	"snowsql",
	"duckdb",
	"clickhouse-client",
	"bq",
	"cockroach",
]);
const isSqlTool = (cmd: string): boolean => SQL_TOOLS.has(cmd);

/** Text fed on stdin by a heredoc or herestring; null when present but unreadable. */
function stdinText(
	redirects: readonly Redirect[],
	scope: Scope,
): string | null | undefined {
	for (const r of redirects) {
		if (r.kind === "heredoc") return r.body;
		if (r.kind === "herestring") return resolveWord(r.word, scope);
	}
	return undefined;
}

// ── Command classification ────────────────────────────────────────────────

const SHELLS = /^(ba|z|da|k|a)?sh$/;
const isShell = (cmd: string): boolean => SHELLS.test(cmd);

function classifyCommand(
	cmd: string,
	args: Argv,
	cwd: string | null,
	_scope: Scope,
	ctx: ShellCtx,
	bulk: boolean,
): void {
	// `find … | xargs rm`, `xargs -0 rm -f`: a bulk delete of many files.
	if (bulk && (cmd === "rm" || cmd === "unlink" || cmd === "shred")) {
		ctx.out.add("fs.delete.recursive");
	}
	// `mkfs.ext4`, `mkfs.vfat`: any file-system maker wipes a device.
	if (/^mkfs(\.|$)/.test(cmd)) ctx.out.add("system.destructive");
	// `--env-file .env` / `--env-file=.env` loads a credential file.
	for (let i = 0; i < args.length; i++) {
		const a = args[i]?.text;
		if (a === "--env-file") {
			const f = args[i + 1]?.text;
			if (f != null && isSecretPath(f)) ctx.out.add("secrets.read");
		} else if (a?.startsWith("--env-file=") && isSecretPath(a.slice(11))) {
			ctx.out.add("secrets.read");
		}
	}
	CLASSIFIERS[cmd]?.(args, cwd, ctx);
	// Package runners that take a program name (`npx rimraf`, `npx -y @mainahq/cli`).
	if (RUNNERS.has(cmd)) runProgram(args, 0, cwd, ctx);
	// A JavaScript runtime running maina's entry file (`bun …/cli/dist/index.js allow`).
	if (JS_RUNTIMES.has(cmd)) {
		const pos = positional(args);
		const script = pos[0] === "run" ? pos[1] : pos[0];
		if (script !== undefined && MAINA_ENTRY.test(script)) {
			mainaClassifier(args.slice(indexOfArg(args, script) + 1), cwd, ctx);
		}
	}
}

const JS_RUNTIMES: ReadonlySet<string> = new Set([
	"bun",
	"node",
	"nodejs",
	"deno",
	"tsx",
]);

/** maina's bin, or its entry file in the package or the monorepo. */
const MAINA_ENTRY =
	/(^|\/)(maina|(@mainahq|packages)\/cli\/(dist|src)\/index\.[cm]?[jt]s)$/;

const MAINA_PACKAGE = "@mainahq/cli";

/** Runner options whose value is the next word (`npx -p <pkg> <bin>`). */
const RUNNER_OPERAND: ReadonlySet<string> = new Set(["-p", "--package"]);

/**
 * Classifies the program a runner runs: its first word from `from` on that
 * is neither an option nor an option's value, so `npx -p @mainahq/cli maina
 * allow` names `maina`, not the package. `-c`/`--call` runs a shell string
 * instead (`npx -c 'maina allow d-1'`), which is classified as shell.
 */
function runProgram(
	args: Argv,
	from: number,
	cwd: string | null,
	ctx: ShellCtx,
): void {
	for (let i = from; i < args.length; i++) {
		const word = args[i]?.text;
		if (word === null || word === undefined) continue;
		if (word === "-c" || word === "--call" || word.startsWith("--call=")) {
			const script = word.startsWith("--call=")
				? word.slice("--call=".length)
				: args[i + 1]?.text;
			if (script === null) ctx.out.add("shell.opaque");
			else if (script !== undefined)
				classifyShell(
					script,
					cwd ?? ctx.event.root,
					ctx.event,
					ctx.gate,
					ctx.out,
				);
			return;
		}
		if (RUNNER_OPERAND.has(word)) i++;
		else if (!word.startsWith("-")) {
			programClassifier(word)?.(args.slice(i + 1), cwd, ctx);
			return;
		}
	}
}

/**
 * The classifier for the program a runner names: its version stripped
 * (`rimraf@5`, `@mainahq/cli@latest`) and maina's package mapped to maina.
 */
function programClassifier(program: string): Classifier | undefined {
	const bare = program.replace(/(.)@[^/]*$/, "$1");
	return bare === MAINA_PACKAGE
		? mainaClassifier
		: CLASSIFIERS[baseCommand(bare)];
}

/** `maina policy` subcommands that only read. */
const POLICY_READS: ReadonlySet<string> = new Set([
	"show",
	"list",
	"get",
	"check",
	"validate",
	"explain",
	"path",
]);

/**
 * `maina setup` and its deprecated alias `init` write `.maina/` and the
 * host hook configs from inside the CLI, where the gate never sees the
 * write, so an agent running one is overriding its own gate (#513).
 */
const MAINA_REWRITES: ReadonlySet<string> = new Set(["setup", "init"]);

/** `maina mcp` subcommands that only read. */
const MCP_READS: ReadonlySet<string> = new Set(["list", "help"]);

interface McpOptions {
	/** A word the gate cannot read, which may be any option or `--`. */
	readonly opaque: boolean;
	readonly help: boolean;
	readonly dryRun: boolean;
	readonly clients: readonly string[];
	readonly scopes: readonly string[];
}

/**
 * The options of `maina mcp …`, read the way Commander reads them: a value
 * option takes the next word whatever it is (`--client --dry-run` sets the
 * client, not the dry run), and a bare `--` ends the options. An unreadable
 * word may be `--client=codex`, `--scope=global` or `--`, so it marks the
 * scan opaque, and a `--dry-run` or help flag after it does not count.
 */
function scanMcpOptions(words: readonly string[]): McpOptions {
	let opaque = false;
	let help = false;
	let dryRun = false;
	const clients: string[] = [];
	const scopes: string[] = [];
	for (let i = 0; i < words.length; i++) {
		const w = words[i] ?? "";
		if (w === "--") break;
		if (w === UNKNOWN_WORD) opaque = true;
		const eq = w.indexOf("=");
		const name = eq < 0 ? w : w.slice(0, eq);
		const into =
			name === "--client" ? clients : name === "--scope" ? scopes : null;
		if (into !== null) {
			if (eq >= 0) into.push(w.slice(eq + 1));
			else {
				i++;
				const value = words[i] ?? "";
				if (value === UNKNOWN_WORD) opaque = true;
				into.push(value);
			}
		} else if (w === "--dry-run") dryRun ||= !opaque;
		else if (w === "--help" || w === "-h") help ||= !opaque;
	}
	return { opaque, help, dryRun, clients, scopes };
}

/**
 * Whether `maina mcp add|remove` may write Codex's `config.toml`, a gate
 * control file, from inside the CLI (#543). Codex has only a global file,
 * so a dry run, a project-only scope or a client list without Codex stays
 * clear of it. With no `--client` the CLI auto-detects, and the gate cannot
 * know Codex is absent; an empty or unreadable word fails closed too.
 */
function mcpWritesControlFile(opts: McpOptions): boolean {
	if (opts.dryRun) return false;
	if (opts.opaque) return true;
	const { scopes, clients } = opts;
	if (scopes.length > 0 && scopes.every((s) => s.toLowerCase() === "project"))
		return false;
	if (clients.length === 0) return true;
	return clients.some((value) => {
		const list = value
			.split(",")
			.map((c) => c.trim().toLowerCase())
			.filter((c) => c !== "");
		return (
			list.length === 0 ||
			list.some((c) => c === "codex" || c.includes(UNKNOWN_WORD))
		);
	});
}

/** `maina mcp <action> …`: help and reads pass; anything else may write. */
function mcpOverridesGate(
	action: string | undefined,
	words: readonly string[],
): boolean {
	const opts = scanMcpOptions(words);
	if (opts.help || action === undefined || MCP_READS.has(action)) return false;
	return mcpWritesControlFile(opts);
}

/**
 * Whether `maina <sub> <action> …` overrides the gate: `allow`, a `policy`
 * mutation, `setup`/`init`, or `doctor --fix`, which runs `maina mcp add`
 * fixes that may write Codex's config.
 */
function mainaOverridesGate(
	sub: string | undefined,
	action: string | undefined,
	options: readonly string[],
): boolean {
	if (sub === "allow" || MAINA_REWRITES.has(sub ?? "")) return true;
	if (sub === "policy")
		return action !== undefined && !POLICY_READS.has(action);
	// An unreadable word may be `--fix`.
	return (
		sub === "doctor" &&
		(options.includes("--fix") || options.includes(UNKNOWN_WORD))
	);
}

/**
 * `maina allow` and `maina policy` mutations change what the gate lets
 * through, so an agent running one is overriding its own gate (#447), as do
 * `maina setup`/`init`, `maina mcp add|remove` and `maina doctor --fix`,
 * which write host configs from inside the CLI (#513, #543). Help is
 * harmless; a subcommand the gate cannot read asks.
 */
function mainaClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const words = args.map((a) => a.text ?? UNKNOWN_WORD);
	const [sub, action] = words.filter((w) => !w.startsWith("-"));
	if (sub === "mcp") {
		if (mcpOverridesGate(action, words)) ctx.out.add("gate.self_override");
		return;
	}
	// A flag after `--` is an operand, not an option.
	const end = words.indexOf("--");
	const options = end < 0 ? words : words.slice(0, end);
	// An unreadable word may be `--`, so a help flag after it is not help.
	const opaqueAt = options.indexOf(UNKNOWN_WORD);
	const readable = opaqueAt < 0 ? options : options.slice(0, opaqueAt);
	if (readable.includes("--help") || readable.includes("-h")) return;
	if (sub === UNKNOWN_WORD) ctx.out.add("shell.opaque");
	else if (mainaOverridesGate(sub, action, options))
		ctx.out.add("gate.self_override");
}

const literalArgs = (args: Argv): readonly string[] =>
	args.flatMap((a) => (a.text === null ? [] : [a.text]));

const positional = (args: Argv): readonly string[] =>
	literalArgs(args).filter((a) => !a.startsWith("-"));

function indexOfArg(args: Argv, text: string): number {
	return args.findIndex((a) => a.text === text);
}

function isOpaque(args: Argv): boolean {
	return args.some((a) => a.text === null);
}

/** Package runners that dispatch to another program (`npx rimraf`). */
const RUNNERS: ReadonlySet<string> = new Set([
	"npx",
	"bunx",
	"pnpx",
	"pnpm dlx",
]);

// A registry of per-command classifiers keyed by base command name.
type Classifier = (args: Argv, cwd: string | null, ctx: ShellCtx) => void;

function rmClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	flagUnresolvedTarget(args, ctx);
	const recursive = literalArgs(args).some(
		(a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive",
	);
	const targets = positional(args);
	if (recursive) ctx.out.add("fs.delete.recursive");
	for (const target of targets) {
		flagDelete(target, cwd, recursive, ctx);
	}
	if (recursive && targets.length === 0 && isOpaque(args)) {
		ctx.out.add("fs.delete.recursive");
	}
}

/**
 * A delete or write whose operand the gate cannot resolve (`rm "$X"`,
 * `tee "$T"`) might touch anything, so it asks (#455): unsure means ask.
 */
function flagUnresolvedTarget(args: Argv, ctx: ShellCtx): void {
	if (isOpaque(args)) ctx.out.add("shell.opaque");
}

function flagDelete(
	target: string,
	cwd: string | null,
	_recursive: boolean,
	ctx: ShellCtx,
): void {
	const cleaned = target.replace(/\/+\*+$/, "").replace(/\/?\*+$/, "") || ".";
	const resolved = resolvePath(cleaned, cwd, ctx.gate.home);
	// A relative path after an unknown `cd`: we cannot know what it removes,
	// so it asks (#455).
	if (resolved === null) {
		ctx.out.add("shell.opaque");
		return;
	}
	if (removesGateControl(resolved)) ctx.out.add("gate.self_override");
	const root = ctx.event.root;
	// Outside the workspace, the workspace root itself, or an ancestor of it:
	// each removes the whole tree from outside.
	if (
		isOutsideWorkspace(resolved, root) ||
		resolved === root ||
		isInside(root, resolved)
	) {
		ctx.out.add("fs.delete.outside");
	}
}

function findClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	const literals = literalArgs(args);
	const deletes = literals.includes("-delete") || hasExecRemoval(literals);
	if (deletes) ctx.out.add("fs.delete.recursive");
	// `find / …` or `find ~ …` reaches outside.
	for (const root of positional(args).slice(0, 1)) {
		const resolved = resolvePath(root, cwd, ctx.gate.home);
		if (
			deletes &&
			resolved !== null &&
			isOutsideWorkspace(resolved, ctx.event.root)
		) {
			ctx.out.add("fs.delete.outside");
		}
	}
}

function hasExecRemoval(literals: readonly string[]): boolean {
	const at = literals.findIndex(
		(a) => a === "-exec" || a === "-execdir" || a === "-ok",
	);
	if (at < 0) return false;
	return literals
		.slice(at + 1)
		.some(
			(a) =>
				baseCommand(a) === "rm" ||
				baseCommand(a) === "unlink" ||
				baseCommand(a) === "shred",
		);
}

/** Stands in for a word the gate cannot resolve; no real argument spells it. */
const UNKNOWN_WORD = "\u0000unknown";

function gitClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	// Skip `-C <dir>`, `-c k=v` and other global options to find the subcommand.
	// Unresolved words keep their position, so `git push $R main` still reads
	// `main` as the refspec rather than the remote.
	const literals = args.map((a) => a.text ?? UNKNOWN_WORD);
	let i = 0;
	let dir = cwd;
	while (i < literals.length) {
		const a = literals[i] as string;
		if (a === "-C") {
			const to = literals[i + 1];
			dir =
				to === undefined || to === UNKNOWN_WORD
					? null
					: resolvePath(to, dir, ctx.gate.home);
			i += 2;
		} else if (a === "-c" || a === "--git-dir" || a === "--work-tree") i += 2;
		else if (a.startsWith("-")) i++;
		else break;
	}
	const sub = literals[i];
	const rest = literals.slice(i + 1);
	if (
		sub !== undefined &&
		GIT_PATH_REWRITERS.has(sub) &&
		rest.some((p) => gitPathIsGateControl(p, dir, ctx))
	)
		ctx.out.add("gate.self_override");
	if (sub === UNKNOWN_WORD) ctx.out.add("shell.opaque");
	else if (sub === "push") gitPush(rest, ctx);
	else if (sub === "reset" && rest.includes("--hard"))
		ctx.out.add("git.discard");
	else if (
		sub === "clean" &&
		rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")
	) {
		ctx.out.add("git.discard");
	} else if (sub === "checkout" && checkoutDiscards(rest))
		ctx.out.add("git.discard");
	else if (sub === "restore" && restoreDiscards(rest))
		ctx.out.add("git.discard");
	else if (sub === "stash" && (rest[0] === "drop" || rest[0] === "clear"))
		ctx.out.add("git.discard");
	else if (
		sub === "branch" &&
		rest.some(
			(a) =>
				a === "-D" ||
				(a === "--delete" && rest.includes("--force")) ||
				a === "-Df",
		)
	) {
		ctx.out.add("git.discard");
	} else if (sub === "reflog" && rest[0] === "expire")
		ctx.out.add("git.discard");
	else if (sub === "gc" && rest.includes("--prune=now"))
		ctx.out.add("git.discard");
	else if (sub === "filter-branch") ctx.out.add("git.discard");
	else if (sub === "update-ref" && rest.includes("-d"))
		ctx.out.add("git.discard");
}

/**
 * Subcommands that overwrite, delete or move the paths they name: an older
 * `.claude/settings.json` checked out or restored, or a hook config removed
 * or renamed, overrides the gate (#513).
 */
const GIT_PATH_REWRITERS: ReadonlySet<string> = new Set([
	"checkout",
	"restore",
	"rm",
	"mv",
]);

/** A pathspec (`:(top)` and `:/` magic stripped) naming a control file or dir. */
function gitPathIsGateControl(
	word: string,
	cwd: string | null,
	ctx: ShellCtx,
): boolean {
	if (word.startsWith("-") || word === UNKNOWN_WORD) return false;
	const path = word.replace(/^:(\([^)]*\)|\/)?/, "");
	const resolved = resolvePath(path, cwd, ctx.gate.home) ?? path;
	return removesGateControl(resolved) || globMatchesGateControl(resolved);
}

/** Names a control dir may hold; `isGateControlFile` picks the dir's own. */
const GATE_CONTROL_NAMES = [
	"policy.json",
	"settings.json",
	"settings.local.json",
	"hooks.json",
	"config.toml",
] as const;

/**
 * A pathspec whose last segment is a glob (`.claude/*`, `.claude/settings*`)
 * that matches a control file in the control dir before it. Git globs a
 * pathspec by default, so `git checkout HEAD~3 -- '.claude/*'` restores an
 * older hook config as surely as naming it.
 */
function globMatchesGateControl(path: string): boolean {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const dir = path.slice(0, slash + 1);
	const glob = path.slice(slash + 1);
	if (!/[*?[]/.test(glob)) return false;
	const tokens = globTokens(glob.toLowerCase());
	return GATE_CONTROL_NAMES.some(
		(name) => globMatches(tokens, name) && isGateControlFile(`${dir}${name}`),
	);
}

type GlobToken =
	| Readonly<{ kind: "star" }>
	| Readonly<{ kind: "any" }>
	| Readonly<{ kind: "set"; negate: boolean; body: string }>
	| Readonly<{ kind: "char"; char: string }>;

/** `*`, `?`, `[…]`/`[!…]` and literal characters; an unclosed `[` is literal. */
function globTokens(glob: string): readonly GlobToken[] {
	const tokens: GlobToken[] = [];
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i] as string;
		const close = c === "[" ? glob.indexOf("]", i + 2) : -1;
		if (c === "*") tokens.push({ kind: "star" });
		else if (c === "?") tokens.push({ kind: "any" });
		else if (close > 0) {
			const negate = glob[i + 1] === "!" || glob[i + 1] === "^";
			tokens.push({
				kind: "set",
				negate,
				body: glob.slice(negate ? i + 2 : i + 1, close),
			});
			i = close;
		} else tokens.push({ kind: "char", char: c });
	}
	return tokens;
}

function tokenMatches(token: GlobToken, ch: string): boolean {
	switch (token.kind) {
		case "star":
			return false;
		case "any":
			return true;
		case "char":
			return token.char === ch;
		case "set":
			return setHas(token.body, ch) !== token.negate;
		default:
			return assertNever(token);
	}
}

/** Whether a bracket expression's body (`a-z`, `hc`) holds `ch`. */
function setHas(body: string, ch: string): boolean {
	for (let i = 0; i < body.length; i++) {
		const lo = body[i] as string;
		const hi = body[i + 2];
		if (body[i + 1] === "-" && hi !== undefined) {
			if (ch >= lo && ch <= hi) return true;
			i += 2;
		} else if (lo === ch) return true;
	}
	return false;
}

/**
 * Wildcard match without a RegExp, so an agent's glob cannot make the gate
 * backtrack for ever: one pass that falls back to the last `*`, O(n·m).
 */
function globMatches(tokens: readonly GlobToken[], name: string): boolean {
	let t = 0;
	let s = 0;
	let star = -1;
	let resume = 0;
	while (s < name.length) {
		const token = tokens[t];
		if (token?.kind === "star") {
			star = t++;
			resume = s;
		} else if (token !== undefined && tokenMatches(token, name[s] as string)) {
			t++;
			s++;
		} else if (star >= 0) {
			t = star + 1;
			s = ++resume;
		} else return false;
	}
	while (tokens[t]?.kind === "star") t++;
	return t === tokens.length;
}

const DEPLOY_REMOTES: ReadonlySet<string> = new Set([
	"heroku",
	"production",
	"dokku",
	"prod",
]);

function checkoutDiscards(rest: readonly string[]): boolean {
	return (
		rest.includes("-f") ||
		rest.includes("--force") ||
		rest.includes(".") ||
		rest.includes("--")
	);
}

/** `git restore` discards the working tree unless it only touches the index. */
function restoreDiscards(rest: readonly string[]): boolean {
	const staged = rest.includes("--staged") || rest.includes("-S");
	const worktree = rest.includes("--worktree") || rest.includes("-W");
	return !staged || worktree;
}

function gitPush(rest: readonly string[], ctx: ShellCtx): void {
	if (rest.includes("--help") || rest.includes("-h")) return;
	// A hard force (`--force`, `-f`, `+refspec`) is irreversible anywhere. A
	// `--force-with-lease` is only irreversible against a protected branch.
	const hardForce = rest.some(
		(a) => a === "--force" || a === "-f" || /^-[a-zA-Z]*f$/.test(a),
	);
	const leaseForce = rest.some(
		(a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="),
	);
	const isDelete = rest.includes("--delete") || rest.includes("-d");

	let repoOption = false;
	const pos: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i] as string;
		if (a === "--repo") {
			repoOption = true;
			i++;
		} else if (a.startsWith("--repo=")) repoOption = true;
		else if (a === "-o" || a === "--push-option") i++;
		else if (a.startsWith("--force-with-lease=")) continue;
		else if (!a.startsWith("-")) pos.push(a);
	}
	const remote = repoOption ? undefined : pos[0];
	const refspecs = repoOption ? pos : pos.slice(1);
	const plusForce = refspecs.some((r) => r.startsWith("+"));
	const hard = hardForce || plusForce;

	// Pushing to a deploy remote (`git push heroku main`) is a deploy.
	if (remote !== undefined && DEPLOY_REMOTES.has(remote)) ctx.out.add("deploy");

	// `--mirror` can delete remote refs; `--all` pushes every branch.
	if (rest.includes("--mirror")) {
		ctx.out.add("git.push.force");
		return;
	}
	if (rest.includes("--all")) {
		ctx.out.add(hard ? "git.push.force" : "git.push.protected");
		return;
	}

	if (refspecs.length === 0) {
		const branch = ctx.gate.currentBranch;
		const toProtected =
			branch !== undefined && ctx.protectedBranches.includes(branch);
		if (hard) ctx.out.add("git.push.force");
		else if (toProtected)
			ctx.out.add(leaseForce ? "git.push.force" : "git.push.protected");
		return;
	}

	const targets = refspecs.map((spec) => pushTarget(spec, ctx));
	// A refspec the gate cannot read may name a protected branch.
	const toProtected = targets.some(
		(t) =>
			t !== null && (t === UNKNOWN_WORD || ctx.protectedBranches.includes(t)),
	);
	const deleting = isDelete || refspecs.some((r) => r.startsWith(":"));

	if (hard) ctx.out.add("git.push.force");
	else if (deleting && toProtected) ctx.out.add("git.push.force");
	else if (leaseForce && toProtected) ctx.out.add("git.push.force");
	else if (toProtected) ctx.out.add("git.push.protected");
}

function pushTarget(spec: string, ctx: ShellCtx): string | null {
	if (spec === UNKNOWN_WORD) return UNKNOWN_WORD;
	const clean = spec.replace(/^\+/, "");
	const dstRaw = clean.includes(":")
		? clean.slice(clean.indexOf(":") + 1)
		: clean;
	const dst = dstRaw.replace(/^refs\/heads\//, "");
	if (dst === "HEAD" || dst === "") return ctx.gate.currentBranch ?? null;
	return dst;
}

const _PUBLISH_MANAGERS: ReadonlySet<string> = new Set([
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"deno",
	"jsr",
]);

function publishManagerClassifier(
	args: Argv,
	cwd: string | null,
	ctx: ShellCtx,
): void {
	const literals = literalArgs(args);
	if (literals.includes("--help") || literals.includes("-h")) return;
	const pos = positional(args);
	const publishAt = literals.indexOf("publish");
	// Everything before `publish` must be an option or an option's value, so
	// `npm --registry <url> publish` counts but `bun test publish` does not.
	if (publishAt >= 0 && onlyOptions(literals.slice(0, publishAt))) {
		ctx.out.add("package.publish");
	}
	// Other registry-mutating subcommands and `yarn npm publish`.
	if (["unpublish", "deprecate", "dist-tag"].includes(pos[0] ?? ""))
		ctx.out.add("package.publish");
	if (pos[0] === "npm" && pos[1] === "publish") ctx.out.add("package.publish");
	if (pos[0] === "token") ctx.out.add("secrets.read");
	// A package manager running another publisher (`pnpm changeset publish`).
	if (pos[0] === "changeset" && pos[1] === "publish")
		ctx.out.add("package.publish");
	if (pos[0] === "dlx" || pos[0] === "exec" || pos[0] === "x")
		runProgram(args, indexOfArg(args, pos[0]) + 1, cwd, ctx);
	// `pnpm maina allow`, `yarn maina allow`: a package manager runs a bin by name.
	if (pos[0] === "maina")
		mainaClassifier(args.slice(indexOfArg(args, "maina") + 1), cwd, ctx);
	// Run scripts: `npm run release`, `yarn release`, `pnpm run publish`.
	const runAt = literals.indexOf("run");
	const script =
		runAt >= 0
			? literals[runAt + 1]
			: /^(release|publish|deploy)/.test(literals[0] ?? "")
				? literals[0]
				: undefined;
	if (script === undefined) return;
	if (script === "deploy" || script.startsWith("deploy:"))
		ctx.out.add("deploy");
	else if (
		script === "release" ||
		script === "publish" ||
		/^(release|publish):/.test(script)
	) {
		ctx.out.add("package.publish");
	}
}

/** Every token is a flag, or the value right after a value-taking flag. */
function onlyOptions(tokens: readonly string[]): boolean {
	return tokens.every((t, i) => {
		const prev = tokens[i - 1] ?? "";
		return t.startsWith("-") || (prev.startsWith("-") && !prev.includes("="));
	});
}

function fetchClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	ctx.out.add("network.fetch");
	// Record where the fetch writes, for a later `sh <that file>`, and flag a
	// write outside the workspace.
	const record = (target: string): void => {
		ctx.downloads.add(baseCommand(target));
		const resolved = resolvePath(target, cwd, ctx.gate.home);
		if (isGateControlFile(resolved ?? target))
			ctx.out.add("gate.self_override");
		if (
			isCredentialStorePath(resolved ?? target) ||
			isSecretPath(resolved ?? target)
		) {
			ctx.out.add("secrets.write");
		} else if (isOutsideWorkspace(resolved, ctx.event.root))
			ctx.out.add("fs.write.outside");
	};
	let sawOutput = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i]?.text;
		if (a === "-o" || a === "--output" || a === "--output-document") {
			const target = args[i + 1]?.text;
			if (target != null) record(target);
			sawOutput = true;
		} else if (a != null && /^--output(-document)?=/.test(a)) {
			record(a.slice(a.indexOf("=") + 1));
			sawOutput = true;
		} else if (a === "-O") sawOutput = true;
	}
	// `wget URL` with no output flag saves to the URL's basename; only a
	// script-shaped name matters for the download-then-run check.
	if (!sawOutput) {
		const url = positional(args).find((a) => /^[a-z]+:\/\//i.test(a));
		const name = url ? baseCommand(url.split("?")[0] ?? url) : undefined;
		if (name && /\.(sh|bash|py|rb|pl|zsh)$/.test(name)) ctx.downloads.add(name);
	}
}

const CLASSIFIERS: Readonly<Record<string, Classifier>> = {
	rm: rmClassifier,
	unlink: (args, cwd, ctx) => {
		flagUnresolvedTarget(args, ctx);
		for (const t of positional(args)) flagDelete(t, cwd, false, ctx);
	},
	shred: (args, cwd, ctx) => {
		ctx.out.add("fs.delete.recursive");
		flagUnresolvedTarget(args, ctx);
		for (const t of positional(args)) flagDelete(t, cwd, true, ctx);
	},
	rimraf: (_args, _cwd, ctx) => ctx.out.add("fs.delete.recursive"),
	maina: mainaClassifier,
	find: findClassifier,
	git: gitClassifier,
	npm: publishManagerClassifier,
	pnpm: publishManagerClassifier,
	yarn: publishManagerClassifier,
	bun: publishManagerClassifier,
	deno: publishManagerClassifier,
	jsr: (_args, _cwd, ctx) => ctx.out.add("package.publish"),
	cargo: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	twine: (args, _cwd, ctx) => {
		if (positional(args)[0] === "upload") ctx.out.add("package.publish");
	},
	gem: (args, _cwd, ctx) => {
		if (positional(args)[0] === "push") ctx.out.add("package.publish");
	},
	poetry: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	uv: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	vsce: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	changeset: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	lerna: (args, _cwd, ctx) => {
		if (positional(args)[0] === "publish") ctx.out.add("package.publish");
	},
	"semantic-release": (_args, _cwd, ctx) => ctx.out.add("package.publish"),
	goreleaser: (args, _cwd, ctx) => {
		if (positional(args)[0] === "release") ctx.out.add("package.publish");
	},
	mvn: (args, _cwd, ctx) => {
		if (positional(args).includes("deploy")) ctx.out.add("package.publish");
	},
	docker: dockerClassifier,
	podman: (args, _cwd, ctx) => {
		if (positional(args)[0] === "push") ctx.out.add("package.publish");
	},
	gh: ghClassifier,
	sudo: (_args, _cwd, ctx) => ctx.out.add("privilege.escalate"),
	doas: (_args, _cwd, ctx) => ctx.out.add("privilege.escalate"),
	su: (_args, _cwd, ctx) => ctx.out.add("privilege.escalate"),
	pkexec: (_args, _cwd, ctx) => ctx.out.add("privilege.escalate"),
	dd: (args, cwd, ctx) => {
		// `dd of=$T`: an output the gate cannot resolve (#455).
		if (args.some((a) => a.text === null && a.raw.startsWith("of=")))
			ctx.out.add("shell.opaque");
		for (const a of literalArgs(args)) {
			if (!a.startsWith("of=")) continue;
			const target = a.slice(3);
			if (isBlockDevice(target)) ctx.out.add("system.destructive");
			else {
				const resolved = resolvePath(target, cwd, ctx.gate.home);
				if (isGateControlFile(resolved ?? target))
					ctx.out.add("gate.self_override");
				if (isOutsideWorkspace(resolved, ctx.event.root))
					ctx.out.add("fs.write.outside");
			}
		}
	},
	mkdir: (args, cwd, ctx) => writeTargets(positional(args), cwd, ctx),
	rsync: (args, cwd, ctx) => {
		if (literalArgs(args).includes("--delete"))
			ctx.out.add("fs.delete.recursive");
		for (const t of positional(args).slice(0, -1)) readTargets(t, cwd, ctx);
		landsOnGateControl(args, cwd, ctx, {
			tree: copiesTree(args),
			targetOption: false,
		});
	},
	kill: (args, _cwd, ctx) => {
		const p = positional(args);
		if (
			p.includes("-1") ||
			p.includes("0") ||
			literalArgs(args).includes("-1")
		) {
			ctx.out.add("system.destructive");
		}
	},
	openssl: (args, _cwd, ctx) => {
		const at = literalArgs(args).indexOf("-in");
		const file = at >= 0 ? literalArgs(args)[at + 1] : undefined;
		if (file && isSecretPath(file)) ctx.out.add("secrets.read");
	},
	security: (args, _cwd, ctx) => {
		if (positional(args)[0]?.startsWith("find-")) ctx.out.add("secrets.read");
	},
	op: (args, _cwd, ctx) => {
		if (positional(args)[0] === "read" || positional(args)[0] === "get")
			ctx.out.add("secrets.read");
	},
	vault: (args, _cwd, ctx) => {
		const p = positional(args);
		if (p.includes("get") || p.includes("read")) ctx.out.add("secrets.read");
	},
	az: (args, _cwd, ctx) => {
		const p = positional(args);
		if (p[0] === "account" && p[1] === "get-access-token")
			ctx.out.add("secrets.read");
	},
	heroku: (args, _cwd, ctx) => {
		if (positional(args)[0]?.startsWith("auth:")) ctx.out.add("secrets.read");
	},
	"ssh-keygen": (args, cwd, ctx) => {
		const at = literalArgs(args).indexOf("-f");
		const file = at >= 0 ? literalArgs(args)[at + 1] : undefined;
		if (file) {
			const resolved = resolvePath(file, cwd, ctx.gate.home);
			if (isCredentialStorePath(resolved ?? file)) ctx.out.add("secrets.write");
		}
	},
	gradlew: (args, _cwd, ctx) => {
		if (positional(args).some((a) => /^publish/.test(a)))
			ctx.out.add("package.publish");
	},
	dotnet: (args, _cwd, ctx) => {
		const p = positional(args);
		if (p[0] === "nuget" && p[1] === "push") ctx.out.add("package.publish");
	},
	wipefs: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	fdisk: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	parted: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	diskutil: (args, _cwd, ctx) => {
		if (positional(args)[0]?.startsWith("erase"))
			ctx.out.add("system.destructive");
	},
	shutdown: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	reboot: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	halt: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	poweroff: (_args, _cwd, ctx) => ctx.out.add("system.destructive"),
	crontab: (args, _cwd, ctx) => {
		if (literalArgs(args).includes("-r")) ctx.out.add("system.destructive");
	},
	chmod: (args, cwd, ctx) =>
		permissionClassifier(permissionTargets(args, true), args, cwd, ctx),
	chown: (args, cwd, ctx) =>
		permissionClassifier(permissionTargets(args, false), args, cwd, ctx),
	tee: (args, cwd, ctx) => {
		// Every operand of `tee` is a file it truncates, so any unresolved one
		// is an unresolved write (#455).
		flagUnresolvedTarget(args, ctx);
		writeTargets(positional(args), cwd, ctx);
	},
	touch: (args, cwd, ctx) => writeTargets(positional(args), cwd, ctx),
	install: (args, cwd, ctx) => {
		flagUnresolvedDestination(args, ctx);
		writeTargets(positional(args).slice(-1), cwd, ctx);
		landsOnGateControl(args, cwd, ctx, { tree: false, targetOption: true });
	},
	cp: (args, cwd, ctx) => {
		copyClassifier(args, cwd, ctx);
		landsOnGateControl(args, cwd, ctx, {
			tree: copiesTree(args),
			targetOption: true,
		});
	},
	mv: (args, cwd, ctx) => {
		copyClassifier(args, cwd, ctx);
		// A move deletes its sources.
		for (const source of positional(args).slice(0, -1)) {
			const resolved = resolvePath(source, cwd, ctx.gate.home);
			if (removesGateControl(resolved ?? source))
				ctx.out.add("gate.self_override");
		}
		landsOnGateControl(args, cwd, ctx, { tree: true, targetOption: true });
	},
	ln: (args, cwd, ctx) => {
		flagUnresolvedDestination(args, ctx);
		writeTargets(positional(args).slice(-1), cwd, ctx);
		// A link to a directory stands in for the whole tree.
		landsOnGateControl(args, cwd, ctx, { tree: true, targetOption: true });
		linksGateControl(args, cwd, ctx);
	},
	sed: sedClassifier,
	printenv: (args, _cwd, ctx) => {
		if (
			positional(args).length === 0 ||
			positional(args).some(isSecretVarName)
		) {
			ctx.out.add("secrets.read");
		}
	},
	env: (args, _cwd, ctx) => {
		if (literalArgs(args).length === 0) ctx.out.add("secrets.read");
	},
	scp: (args, cwd, ctx) => {
		for (const t of positional(args)) readTargets(t, cwd, ctx);
	},
	// Deploys.
	vercel: deployClassifier,
	netlify: deployClassifier,
	wrangler: (args, cwd, ctx) => {
		if (positional(args)[0] === "d1") {
			for (const sql of inlineSql(args)) {
				if (isDestructiveSql(sql)) ctx.out.add("db.destructive");
			}
			return;
		}
		deployClassifier(args, cwd, ctx);
	},
	kubectl: kubectlClassifier,
	helm: helmClassifier,
	terraform: iacClassifier,
	tofu: iacClassifier,
	pulumi: pulumiClassifier,
	fly: deployClassifier,
	flyctl: (args, _cwd, ctx) => {
		if (
			positional(args).includes("destroy") ||
			positional(args)[0] === "deploy"
		)
			ctx.out.add("deploy");
	},
	firebase: deployClassifier,
	gcloud: gcloudClassifier,
	aws: awsClassifier,
	serverless: deployClassifier,
	sls: deployClassifier,
	cdk: (args, _cwd, ctx) => {
		const s = positional(args)[0];
		if (s === "deploy" || s === "destroy") ctx.out.add("deploy");
	},
	sam: deployClassifier,
	eb: deployClassifier,
	kamal: deployClassifier,
	"ansible-playbook": (_args, _cwd, ctx) => ctx.out.add("deploy"),
	railway: deployClassifier,
	// Databases.
	psql: sqlToolClassifier,
	mysql: sqlToolClassifier,
	sqlite3: sqlToolClassifier,
	sqlcmd: sqlToolClassifier,
	snowsql: sqlToolClassifier,
	duckdb: sqlToolClassifier,
	"clickhouse-client": sqlToolClassifier,
	bq: sqlToolClassifier,
	dropdb: (_args, _cwd, ctx) => ctx.out.add("db.destructive"),
	"redis-cli": redisClassifier,
	mongosh: mongoClassifier,
	prisma: prismaClassifier,
	rails: railsClassifier,
	artisan: artisanClassifier,
	php: (args, cwd, ctx) => {
		if (positional(args)[0] === "artisan")
			artisanClassifier(args.slice(indexOfArg(args, "artisan") + 1), cwd, ctx);
	},
	python: pythonClassifier,
	python2: pythonClassifier,
	python3: pythonClassifier,
	supabase: (args, _cwd, ctx) => {
		const p = positional(args);
		if (p[0] === "db" && p[1] === "reset") ctx.out.add("db.destructive");
	},
	cockroach: sqlToolClassifier,
	pg_restore: (args, _cwd, ctx) => {
		if (
			literalArgs(args).includes("--clean") ||
			literalArgs(args).includes("-c")
		)
			ctx.out.add("db.destructive");
	},
	pg_dump: (args, _cwd, ctx) => productionDbConn(args, ctx),
	// Remote code / network.
	curl: fetchClassifier,
	wget: fetchClassifier,
	http: fetchClassifier,
	httpie: fetchClassifier,
	source: sourceClassifier,
	".": sourceClassifier,
};

/**
 * The files a `chmod` or `chown` changes: every operand after the mode or
 * owner (none with `--reference`). A `chmod` mode may start with `-`
 * (`chmod -r f`), so it is not mistaken for an option. An unresolved word
 * still takes its place (`chmod "$MODE" f` changes `f`); as a target it is
 * skipped, since the gate cannot read it.
 */
function permissionTargets(args: Argv, chmod: boolean): readonly string[] {
	const words = args.map((a) => a.text ?? UNKNOWN_WORD);
	let modeSeen = words.some((w) => w.startsWith("--reference"));
	const targets: string[] = [];
	for (const w of words) {
		const isMode = chmod && /^-[rwxXst]+$/.test(w);
		if (w === UNKNOWN_WORD) {
			modeSeen = true;
			continue;
		}
		if (!modeSeen && (isMode || !w.startsWith("-"))) modeSeen = true;
		else if (!w.startsWith("-")) targets.push(w);
	}
	return targets;
}

function permissionClassifier(
	targets: readonly string[],
	args: Argv,
	cwd: string | null,
	ctx: ShellCtx,
): void {
	const recursive = literalArgs(args).some(
		(a) => /^-[a-zA-Z]*R/.test(a) || a === "--recursive",
	);
	for (const t of targets) {
		const resolved = resolvePath(t, cwd, ctx.gate.home);
		// Locking a hook config or policy away from its reader disables the
		// gate as surely as deleting it (#513).
		if (removesGateControl(resolved ?? t)) ctx.out.add("gate.self_override");
		if (isSecretPath(resolved ?? t) || isCredentialStorePath(resolved ?? t)) {
			ctx.out.add("secrets.write");
			continue;
		}
		const outside =
			t === "/" ||
			(resolved !== null &&
				(resolved === "/" || isOutsideWorkspace(resolved, ctx.event.root)));
		if (!outside) continue;
		ctx.out.add(
			recursive && (t === "/" || resolved === "/")
				? "system.destructive"
				: "fs.write.outside",
		);
	}
}

/** `cp`/`mv`: the last positional is the destination, the rest are sources. */
function copyClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	flagUnresolvedDestination(args, ctx);
	const pos = positional(args);
	writeTargets(pos.slice(-1), cwd, ctx);
	for (const source of pos.slice(0, -1)) readTargets(source, cwd, ctx);
}

function writeTargets(
	targets: readonly string[],
	cwd: string | null,
	ctx: ShellCtx,
): void {
	for (const t of targets) {
		const resolved = resolvePath(t, cwd, ctx.gate.home);
		const path = resolved ?? t;
		if (isGateControlFile(path)) ctx.out.add("gate.self_override");
		if (isCredentialStorePath(path) || isSecretPath(path))
			ctx.out.add("secrets.write");
		else if (resolved !== null && isSafeDevice(resolved)) continue;
		else if (isOutsideWorkspace(resolved, ctx.event.root))
			ctx.out.add("fs.write.outside");
	}
}

function readTargets(target: string, cwd: string | null, ctx: ShellCtx): void {
	const resolved = resolvePath(target, cwd, ctx.gate.home);
	if (isSecretPath(resolved ?? target)) ctx.out.add("secrets.read");
}

function sedClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	if (
		!literalArgs(args).some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place")
	)
		return;
	// `sed -i … "$F"`: the file operands come last; an unresolved script
	// (`sed -i "s/$A/$B/" notes.txt`) is not a target.
	if (args.at(-1)?.text === null) ctx.out.add("shell.opaque");
	writeTargets(positional(args), cwd, ctx);
}

/**
 * `cp`/`mv`/`install`/`ln` write to `-t DIR` or else the last operand. When
 * the gate cannot resolve that destination the write might land anywhere,
 * so it asks (#455). An unresolved source is only a read.
 */
function flagUnresolvedDestination(args: Argv, ctx: ShellCtx): void {
	const at = args.findIndex(
		(a) => a.text === "-t" || a.text === "--target-directory",
	);
	const destination =
		at >= 0
			? args[at + 1]
			: (args.find(
					(a) => a.text === null && a.raw.startsWith("--target-directory="),
				) ?? args.at(-1));
	if (destination?.text === null) ctx.out.add("shell.opaque");
}

function dockerClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const p = positional(args);
	if (p[0] === "push") ctx.out.add("package.publish");
	if (p[0] === "stack" && p[1] === "deploy") ctx.out.add("deploy");
}

function ghClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const p = positional(args);
	if (p[0] === "release" && (p[1] === "create" || p[1] === "upload"))
		ctx.out.add("package.publish");
	if (p[0] === "pr" && p[1] === "merge") ctx.out.add("pr.merge");
	if (p[0] === "auth" && p[1] === "token") ctx.out.add("secrets.read");
	if (
		p[0] === "auth" &&
		p[1] === "status" &&
		literalArgs(args).includes("--show-token")
	)
		ctx.out.add("secrets.read");
}

function deployClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const p = positional(args);
	if (
		p.length === 0 ||
		p[0] === "deploy" ||
		p[0] === "publish" ||
		p[0] === "up" ||
		p[0] === "remove" ||
		p[0] === "destroy" ||
		literalArgs(args).includes("--prod") ||
		(p[0] === "pages" && p[1] === "deploy") ||
		(p[0] === "apps" && p[1] === "destroy")
	) {
		ctx.out.add("deploy");
	}
}

function kubectlClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const s = positional(args)[0];
	if (
		[
			"apply",
			"delete",
			"rollout",
			"scale",
			"replace",
			"patch",
			"drain",
		].includes(s ?? "")
	) {
		ctx.out.add("deploy");
	}
}

function helmClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const s = positional(args)[0];
	if (
		["upgrade", "install", "uninstall", "delete", "rollback"].includes(s ?? "")
	)
		ctx.out.add("deploy");
	if (s === "push") ctx.out.add("package.publish");
}

function iacClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const s = positional(args)[0];
	if (s === "apply" || s === "destroy") ctx.out.add("deploy");
}

function pulumiClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const s = positional(args)[0];
	if (s === "up" || s === "destroy") ctx.out.add("deploy");
}

function gcloudClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const p = positional(args);
	if (p[0] === "app" && p[1] === "deploy") ctx.out.add("deploy");
	if (p[0] === "run" && p[1] === "deploy") ctx.out.add("deploy");
	if (p[0] === "auth" && p[1] === "print-access-token")
		ctx.out.add("secrets.read");
}

function awsClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const p = positional(args);
	if (
		p[0] === "cloudformation" &&
		(p[1] === "deploy" || p[1] === "delete-stack")
	)
		ctx.out.add("deploy");
	if (p[0] === "lambda" && p[1] === "update-function-code")
		ctx.out.add("deploy");
	if (p[0] === "configure" && p[1] === "export-credentials")
		ctx.out.add("secrets.read");
}

const SQL_START =
	/^\s*(WITH|SELECT|DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|BEGIN|MERGE)\b/i;

function sqlToolClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	productionDbConn(args, ctx);
	// SQL passed via a flag, or as a positional statement (`sqlite3 db "DROP …"`,
	// `bq query "…"`).
	const statements = [
		...inlineSql(args),
		...positional(args).filter((a) => SQL_START.test(a)),
	];
	for (const sql of statements) {
		if (isDestructiveSql(sql)) ctx.out.add("db.destructive");
	}
}

/** SQL passed with `-c`/`-e`/`--command`/`--query`/`--eval`. */
function inlineSql(args: Argv): readonly string[] {
	const out: string[] = [];
	const literals = args;
	for (let i = 0; i < literals.length; i++) {
		const a = literals[i]?.text;
		if (a === undefined || a === null) continue;
		if (
			a === "-c" ||
			a === "-e" ||
			a === "--command" ||
			a === "--execute" ||
			a === "--query" ||
			a === "--eval" ||
			a === "-Q"
		) {
			const next = literals[i + 1]?.text;
			if (next != null) out.push(next);
		} else if (/^--(command|execute|query|eval)=/.test(a)) {
			out.push(a.slice(a.indexOf("=") + 1));
		} else if (/^-[ceQ]=?/.test(a) && a.length > 2) {
			out.push(a.slice(a[2] === "=" ? 3 : 2));
		}
	}
	return out;
}

const PROD_HOST = /(^|[.@/_])(prod|production)([.\-/_]|$)/i;

function productionDbConn(args: Argv, ctx: ShellCtx): void {
	for (const a of args) {
		// The value when known, and the raw spelling (a `$PROD_DATABASE_URL`
		// names production even when its value is not in scope).
		if (PROD_HOST.test(a.text ?? a.raw)) ctx.out.add("db.production");
	}
}

function redisClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	productionDbConn(args, ctx);
	if (positional(args).some((a) => /^flush(all|db)$/i.test(a)))
		ctx.out.add("db.destructive");
}

function mongoClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	productionDbConn(args, ctx);
	for (const sql of evalArgs(args)) {
		if (/\bdrop(Database)?\s*\(/i.test(sql) || /\.drop\s*\(/i.test(sql))
			ctx.out.add("db.destructive");
	}
}

function evalArgs(args: Argv): readonly string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i]?.text === "--eval") {
			const next = args[i + 1]?.text;
			if (next != null) out.push(next);
		}
	}
	return out;
}

function prismaClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const p = positional(args);
	if (p[0] === "migrate" && p[1] === "reset") ctx.out.add("db.destructive");
	if (
		p[0] === "db" &&
		p[1] === "push" &&
		literalArgs(args).includes("--force-reset")
	)
		ctx.out.add("db.destructive");
	if (p[0] === "migrate" && p[1] === "deploy") ctx.out.add("db.production");
}

function railsClassifier(args: Argv, _cwd: string | null, ctx: ShellCtx): void {
	const task = positional(args)[0] ?? "";
	if (/^db:(drop|reset|purge)/.test(task)) ctx.out.add("db.destructive");
	if (/^db:migrate/.test(task)) return;
}

function artisanClassifier(
	args: Argv,
	_cwd: string | null,
	ctx: ShellCtx,
): void {
	const task = positional(args)[0] ?? "";
	if (
		task === "migrate:fresh" ||
		task === "db:wipe" ||
		task === "migrate:reset"
	)
		ctx.out.add("db.destructive");
}

function pythonClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	const literals = literalArgs(args);
	// `python -m twine upload …` dispatches to the module.
	const mAt = literals.indexOf("-m");
	if (mAt >= 0) {
		const mod = literals[mAt + 1];
		if (mod !== undefined)
			CLASSIFIERS[baseCommand(mod)]?.(
				args.slice(indexOfArg(args, mod) + 1),
				cwd,
				ctx,
			);
	}
	// `python manage.py flush`: Django's destructive data commands.
	const managePy = positional(args).find((a) => baseCommand(a) === "manage.py");
	if (managePy !== undefined) {
		const task = positional(args)[positional(args).indexOf(managePy) + 1] ?? "";
		if (task === "flush" || task === "sqlflush" || task === "reset_db")
			ctx.out.add("db.destructive");
	}
}

function sourceClassifier(args: Argv, cwd: string | null, ctx: ShellCtx): void {
	for (const t of positional(args)) readTargets(t, cwd, ctx);
}

// ── Redirects, pipes and reads ──────────────────────────────────────────────

function redirectClasses(
	redirects: readonly Redirect[],
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): void {
	for (const r of redirects) {
		if (r.kind === "file") {
			// A substitution in the target still runs (`> >(rm -rf ~)`).
			scanWordSubstitutions(r.target, scope, ctx);
			const text = resolveWord(r.target, scope);
			if (text === null) {
				// A write to a target the gate cannot resolve (`> "$T"`) might land
				// anywhere, so it asks (#455). An unresolved read stays clear.
				if (!r.op.startsWith("<")) ctx.out.add("shell.opaque");
				continue;
			}
			const resolved = resolvePath(text, cwd, ctx.gate.home);
			const path = resolved ?? text;
			if (r.op.startsWith("<")) {
				readTargets(text, cwd, ctx);
			} else {
				if (isGateControlFile(path)) ctx.out.add("gate.self_override");
				if (isCredentialStorePath(path) || isSecretPath(path))
					ctx.out.add("secrets.write");
				else if (resolved !== null && isSafeDevice(resolved)) continue;
				else if (isBlockDevice(path)) ctx.out.add("system.destructive");
				else if (isOutsideWorkspace(resolved, ctx.event.root))
					ctx.out.add("fs.write.outside");
			}
		} else if (r.kind === "herestring") {
			// A substitution in the word still runs; the text itself is fed to
			// the command (handled by the command itself).
			scanWordSubstitutions(r.word, scope, ctx);
		} else if (r.kind === "heredoc") {
			// An expanding body runs its substitutions (`cat <<EOF` … `$(…)`).
			for (const inner of r.substs) {
				walkScript(inner, ctx.event.root, new Map(scope), ctx);
			}
			for (const source of r.backticks) {
				classifyShell(source, ctx.event.root, ctx.event, ctx.gate, ctx.out);
			}
		}
	}
}

// ── Pipelines ─────────────────────────────────────────────────────────────

type CommandView = Readonly<{
	cmd: string;
	args: Argv;
	node: Extract<ShellNode, { kind: "command" }>;
}>;

function commandView(
	node: ShellNode,
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): CommandView | null {
	if (node.kind !== "command") return null;
	const argv = resolveArgv(node.argv, scope);
	const { rest } = stripWrappers(argv, scope, ctx, cwd);
	const exe = rest[0];
	if (exe === undefined || exe.text === null) return null;
	return { cmd: baseCommand(exe.text), args: rest.slice(1), node };
}

/**
 * A pipeline moves text from stage to stage. We track that text (`carry`) so a
 * downloaded or literal payload that is finally executed or run against a
 * database is caught: `curl … | sh`, `echo '…' | base64 -d | sh`,
 * `echo 'DROP …' | psql`.
 */
function walkPipeline(
	stages: readonly ShellNode[],
	cwd: string | null,
	scope: Scope,
	ctx: ShellCtx,
): void {
	let carry: string | null | undefined;
	let fetched = false;
	for (const stage of stages) {
		const view = commandView(stage, cwd, scope, ctx);
		if (view === null) {
			carry = null;
			continue;
		}
		const { cmd } = view;
		if (FETCHERS.has(cmd)) {
			fetched = true;
			carry = null;
		} else if (
			cmd === "base64" &&
			literalArgs(view.args).some((a) => /^-.*d/.test(a) || a === "--decode")
		) {
			carry = carry == null ? null : decodeBase64(carry);
		} else if (cmd === "echo") {
			carry = echoText(view.args);
		} else if (cmd === "printf") {
			carry = joinLiteral(positionalArgs(view.args).slice(0, 1));
		} else if (cmd === "cat") {
			carry = catText(view, scope, carry);
		} else if (PASSTHROUGH.has(cmd)) {
			// gunzip, zcat, tee, gzip -d: the payload flows on unchanged enough.
		} else if (isShellConsumer(cmd)) {
			if (fetched) ctx.out.add("remote.exec");
			else if (carry != null) {
				classifyShell(
					carry,
					cwd ?? ctx.event.root,
					ctx.event,
					ctx.gate,
					ctx.out,
				);
			} else if (carry === null) {
				// Unknown text executed as a shell (`echo $PAYLOAD | sh`).
				ctx.out.add("shell.opaque");
			}
			carry = null;
		} else if (isSqlTool(cmd)) {
			if (carry != null && isDestructiveSql(carry))
				ctx.out.add("db.destructive");
			carry = null;
		} else {
			carry = null;
		}
	}
	// Each stage is also a command in its own right.
	for (const stage of stages) walkNode(stage, cwd, scope, ctx);
}

const PASSTHROUGH: ReadonlySet<string> = new Set([
	"gunzip",
	"zcat",
	"gzip",
	"tee",
	"cat",
]);

const isShellConsumer = (cmd: string): boolean =>
	isShell(cmd) || INLINE_INTERPRETERS.has(cmd) || cmd === "at";

const positionalArgs = (args: Argv): Argv =>
	args.filter((a) => a.text === null || !a.text.startsWith("-"));

/** `echo a b c` → `"a b c"`; the `-n`/`-e`/`-E` flags are dropped. */
function echoText(args: Argv): string | null {
	const words = args.filter(
		(a) => !(a.text !== null && /^-[neE]+$/.test(a.text)),
	);
	return joinLiteral(words);
}

function catText(
	view: CommandView,
	scope: Scope,
	carry: string | null | undefined,
): string | null {
	const stdin = stdinText(view.node.redirects, scope);
	if (stdin !== undefined) return stdin;
	// `cat file` reads an unknown file; bare `cat` passes stdin through.
	return positional(view.args).length > 0 ? null : (carry ?? null);
}

function decodeBase64(text: string): string | null {
	try {
		return Buffer.from(text.trim(), "base64").toString("utf8");
	} catch {
		return null;
	}
}

// ── Wrapper stripping and word resolution ───────────────────────────────────

const WRAPPERS: ReadonlySet<string> = new Set([
	"nohup",
	"exec",
	"command",
	"builtin",
	"time",
	"stdbuf",
	"nice",
	"ionice",
	"setsid",
	"coproc",
]);

/** env options that take a separate value. */
const ENV_OPERAND: ReadonlySet<string> = new Set([
	"-u",
	"--unset",
	"-C",
	"--chdir",
	"-S",
	"--split-string",
]);

function stripWrappers(
	argv: Argv,
	_scope: Scope,
	ctx: ShellCtx,
	_cwd: string | null,
): Readonly<{ rest: Argv; wrapped: boolean; bulk: boolean }> {
	let args = argv;
	let wrapped = false;
	let bulk = false;
	for (;;) {
		const head = args[0];
		if (head === undefined || head.text === null) break;
		const cmd = baseCommand(head.text);
		if (cmd === "sudo" || cmd === "doas") {
			ctx.out.add("privilege.escalate");
			args = skipSudoOptions(args.slice(1));
		} else if (cmd === "env") {
			args = skipEnvPrefix(args.slice(1));
			// Bare `env` (nothing left to run) prints the environment.
			if (args.length === 0) ctx.out.add("secrets.read");
		} else if (cmd === "xargs") {
			args = skipXargsOptions(args.slice(1));
			bulk = true;
		} else if (cmd === "timeout") {
			// `timeout [opts] DURATION CMD …`.
			args = skipLeadingOptions(args.slice(1));
			args = args.slice(1);
		} else if (cmd === "watch") {
			// `watch [opts] CMD …`; `-n`/`--interval` take a value.
			args = skipWatchOptions(args.slice(1));
		} else if (WRAPPERS.has(cmd)) {
			args = args.slice(1);
		} else break;
		wrapped = true;
	}
	return { rest: args, wrapped, bulk };
}

function skipLeadingOptions(args: Argv): Argv {
	let i = 0;
	while (i < args.length && (args[i]?.text?.startsWith("-") ?? false)) i++;
	return args.slice(i);
}

function skipWatchOptions(args: Argv): Argv {
	let i = 0;
	while (i < args.length) {
		const t = args[i]?.text;
		if (t == null) break;
		if (t === "-n" || t === "--interval" || t === "-d" || t === "--differences")
			i += 2;
		else if (t.startsWith("-")) i++;
		else break;
	}
	return args.slice(i);
}

function skipSudoOptions(args: Argv): Argv {
	let i = 0;
	while (i < args.length) {
		const t = args[i]?.text;
		if (t === "--") return args.slice(i + 1);
		if (
			t === "-u" ||
			t === "-g" ||
			t === "-p" ||
			t === "-C" ||
			t === "-h" ||
			t === "-U"
		)
			i += 2;
		else if (t?.startsWith("-")) i++;
		else break;
	}
	return args.slice(i);
}

function skipEnvPrefix(args: Argv): Argv {
	let i = 0;
	while (i < args.length) {
		const t = args[i]?.text;
		if (t === null) {
			i++;
			continue;
		}
		if (t === "--") return args.slice(i + 1);
		if (ENV_OPERAND.has(t as string)) i += 2;
		else if (
			(t as string).startsWith("-") ||
			/^[A-Za-z_][A-Za-z0-9_]*=/.test(t as string)
		)
			i++;
		else break;
	}
	return args.slice(i);
}

function skipXargsOptions(args: Argv): Argv {
	let i = 0;
	while (i < args.length) {
		const t = args[i]?.text;
		if (t == null) break;
		if (
			t === "-I" ||
			t === "-n" ||
			t === "-P" ||
			t === "-d" ||
			t === "-E" ||
			t === "-s" ||
			t === "--replace" ||
			t === "--max-args"
		)
			i += 2;
		else if (t.startsWith("-")) i++;
		else break;
	}
	return args.slice(i);
}

/** The `-c` script of a shell invocation; undefined if none, null if unreadable. */
function shellCScript(args: Argv): string | null | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i]?.text;
		if (a === undefined) continue;
		if (a === null) return undefined;
		if (/^[-+][oO]$/.test(a)) {
			i++;
		} else if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) {
			return args[i + 1]?.text ?? null;
		} else if (!a.startsWith("-") && !a.startsWith("+")) {
			return undefined;
		}
	}
	return undefined;
}

/** util-linux `script` options whose value is the next word. */
const SCRIPT_OPERAND: ReadonlySet<string> = new Set([
	"-c",
	"--command",
	"-E",
	"--echo",
	"-I",
	"--log-in",
	"-O",
	"--log-out",
	"-B",
	"--log-io",
	"-T",
	"--log-timing",
	"-m",
	"--logging-format",
	"-o",
	"--output-limit",
]);

/**
 * What `script` runs, as shell text (null where a word is unresolved): its
 * `-c`/`--command` string, which util-linux reads anywhere in the line
 * (`script log -c cmd`), and the BSD/macOS form's command after the log file
 * (`script -q /dev/null cmd args…`), re-quoted word by word.
 */
function scriptCommands(args: Argv): readonly (string | null)[] {
	const found: (string | null)[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i]?.text;
		if (a == null) continue;
		const combined = /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) ? a.indexOf("c") : -1;
		if (a === "--command" || (combined >= 0 && combined === a.length - 1)) {
			const value = args[i + 1];
			if (value !== undefined) found.push(value.text);
			i++;
		} else if (a.startsWith("--command=")) {
			found.push(a.slice("--command=".length));
		} else if (combined >= 0) {
			found.push(a.slice(combined + 1));
		}
	}
	const argv = args.slice(scriptFileIndex(args) + 1);
	if (argv.length > 0) found.push(quoteArgv(argv));
	return found;
}

/** Index of `script`'s log file operand: its first word that is not an option or an option's value. */
function scriptFileIndex(args: Argv): number {
	let i = 0;
	for (; i < args.length; i++) {
		const a = args[i]?.text;
		if (a == null) break;
		if (a === "--") return i + 1;
		// BSD `-t <seconds>`; util-linux `-t` takes no separate value.
		const bsdTime = a === "-t" && /^\d+$/.test(args[i + 1]?.text ?? "");
		if (SCRIPT_OPERAND.has(a) || /^-[a-zA-Z]*c$/.test(a) || bsdTime) i++;
		else if (!a.startsWith("-")) break;
	}
	return i;
}

/** Words as shell text that parses back to the same words; null if any is unresolved. */
function quoteArgv(args: Argv): string | null {
	const words: string[] = [];
	for (const a of args) {
		if (a.text === null) return null;
		words.push(`'${a.text.replace(/'/g, "'\\''")}'`);
	}
	return words.join(" ");
}

function nextCwd(args: Argv, cwd: string | null, ctx: ShellCtx): string | null {
	// `cd "$DIR"`: the directory is unknown, not home.
	if (isOpaque(args)) return null;
	const target = positional(args)[0];
	if (target === undefined) return ctx.gate.home ?? cwd;
	if (target === "-") return null;
	return resolvePath(target, cwd, ctx.gate.home);
}

function joinLiteral(args: Argv): string | null {
	const parts: string[] = [];
	for (const a of args) {
		if (a.text === null) return null;
		parts.push(a.text);
	}
	return parts.join(" ");
}

function baseCommand(exe: string): string {
	const noQuote = exe.replace(/^['"]|['"]$/g, "");
	const seg = noQuote.split("/").at(-1) ?? noQuote;
	return seg;
}

// ── Word → text resolution using the tracked scope ──────────────────────────

function resolveArgv(argv: readonly ShellWord[], scope: Scope): Argv {
	return argv.flatMap((word) => splitResolvedWord(word, scope));
}

/**
 * Resolves a word to text, expanding a bare `$X` we saw assigned. An
 * unquoted variable can word-split (`CMD="rm -rf ~"; $CMD`), so a resolved
 * bare parameter is split on whitespace.
 */
function splitResolvedWord(word: ShellWord, scope: Scope): Argv {
	if (word.parts.length === 1) {
		const part = word.parts[0] as WordPart;
		if (part.kind === "param" && !part.quoted) {
			const value = scope.get(part.name);
			if (value === undefined || value === null) {
				return [{ text: null, raw: word.raw }];
			}
			return value
				.split(/\s+/)
				.filter((w) => w.length > 0)
				.map((w) => ({ text: w, raw: w }));
		}
	}
	return [{ text: resolveWord(word, scope), raw: word.raw }];
}

/** The word's literal text with tracked variables filled in, or null if unknown. */
function resolveWord(word: ShellWord, scope: Scope): string | null {
	let text = "";
	for (const part of word.parts) {
		switch (part.kind) {
			case "text":
				text += part.text;
				break;
			case "param": {
				const value = scope.get(part.name);
				if (value != null) text += value;
				else if (part.fallback) {
					const fb = resolveWord(part.fallback, scope);
					if (fb === null) return null;
					text += fb;
				} else return null;
				break;
			}
			case "subst": {
				// `$(echo rm)` / `$(printf rm)` used as a word: evaluate the simple
				// case so an obfuscated command name still resolves.
				const value = substLiteral(part.script, scope);
				if (value === null) return null;
				text += value;
				break;
			}
			default:
				return null;
		}
	}
	return text;
}

/** The output of a `$(…)` that is a single literal `echo`/`printf`, else null. */
function substLiteral(script: ShellScript, scope: Scope): string | null {
	if (script.nodes.length !== 1) return null;
	const node = script.nodes[0];
	if (node?.kind !== "command") return null;
	const argv = resolveArgv(node.argv, scope);
	const exe = argv[0];
	if (exe === undefined || exe.text === null) return null;
	const cmd = baseCommand(exe.text);
	if (cmd === "echo") return echoText(argv.slice(1));
	if (cmd === "printf")
		return joinLiteral(positionalArgs(argv.slice(1)).slice(0, 1));
	return null;
}

/** Runs substitutions in a word for their side effects (`echo $(rm -rf ~)`). */
function scanWordSubstitutions(
	word: ShellWord,
	scope: Scope,
	ctx: ShellCtx,
): void {
	for (const part of word.parts) {
		if (part.kind === "subst" || part.kind === "procsubst") {
			walkScript(part.script, ctx.event.root, new Map(scope), ctx);
		} else if (part.kind === "param" && part.fallback) {
			scanWordSubstitutions(part.fallback, scope, ctx);
		} else if (part.kind === "opaque") {
			for (const inner of part.scripts) {
				walkScript(inner, ctx.event.root, new Map(scope), ctx);
			}
		}
	}
}

// ── Command extraction for rule matching ────────────────────────────────────

const WRAPPER_NAMES: ReadonlySet<string> = new Set([
	...WRAPPERS,
	"sudo",
	"doas",
	"env",
	"xargs",
	"timeout",
	"watch",
]);

/** Wrapper-free argv, with no side effects (for rule matching, not classing). */
function stripWrappersPure(argv: Argv): Argv {
	let args = argv;
	for (;;) {
		const head = args[0];
		if (head === undefined || head.text === null) break;
		const cmd = baseCommand(head.text);
		if (!WRAPPER_NAMES.has(cmd)) break;
		if (cmd === "sudo" || cmd === "doas") args = skipSudoOptions(args.slice(1));
		else if (cmd === "env") args = skipEnvPrefix(args.slice(1));
		else if (cmd === "xargs") args = skipXargsOptions(args.slice(1));
		else if (cmd === "timeout")
			args = skipLeadingOptions(args.slice(1)).slice(1);
		else if (cmd === "watch") args = skipWatchOptions(args.slice(1));
		else args = args.slice(1);
	}
	return args;
}

function collectCommands(
	command: string,
	ctx: GateContext,
	out: string[],
): void {
	const parser = ctx.shell;
	if (parser === null) return;
	const parsed = parser.parse(command);
	if (!parsed.ok) return;
	const scope: Scope = new Map();
	if (ctx.home !== undefined) scope.set("HOME", ctx.home);
	collectScript(parsed.value, scope, ctx, out);
}

function collectScript(
	script: ShellScript,
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	for (const node of script.nodes) collectNode(node, scope, ctx, out);
}

function collectNode(
	node: ShellNode,
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	switch (node.kind) {
		case "assign":
			for (const a of node.assignments) {
				if (a.value) collectWordSubsts(a.value, scope, ctx, out);
				scope.set(
					a.name,
					a.value === null ? null : resolveWord(a.value, scope),
				);
			}
			return;
		case "command":
			collectCommandNode(node, scope, ctx, out);
			return;
		case "pipeline":
			collectPipeline(node.stages, scope, ctx, out);
			return;
		case "sequence":
			for (const inner of node.nodes) collectNode(inner, scope, ctx, out);
			collectRedirects(node.redirects, scope, ctx, out);
			return;
		case "loop":
			for (const item of node.items ?? []) {
				collectWordSubsts(item, scope, ctx, out);
			}
			collectNode(node.body, scope, ctx, out);
			return;
		case "function":
			collectNode(node.body, scope, ctx, out);
			return;
		default:
			return;
	}
}

/** Piped text that ends in a shell is that shell's script: collect it too. */
function collectPipeline(
	stages: readonly ShellNode[],
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	let carry: string | null | undefined;
	for (const stage of stages) {
		const rest =
			stage.kind === "command"
				? stripWrappersPure(resolveArgv(stage.argv, scope))
				: [];
		const exe = rest[0];
		const cmd = exe?.text != null ? baseCommand(exe.text) : "";
		const args = rest.slice(1);
		if (FETCHERS.has(cmd)) carry = null;
		else if (
			cmd === "base64" &&
			literalArgs(args).some((a) => /^-.*d/.test(a) || a === "--decode")
		) {
			carry = carry == null ? null : decodeBase64(carry);
		} else if (cmd === "echo") carry = echoText(args);
		else if (cmd === "printf")
			carry = joinLiteral(positionalArgs(args).slice(0, 1));
		else if (PASSTHROUGH.has(cmd)) {
			// unchanged
		} else if (isShellConsumer(cmd)) {
			if (carry != null) collectNested(carry, scope, ctx, out);
			carry = null;
		} else carry = null;
	}
	for (const stage of stages) collectNode(stage, scope, ctx, out);
}

function collectCommandNode(
	node: Extract<ShellNode, { kind: "command" }>,
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	for (const a of node.assignments) {
		if (a.value) collectWordSubsts(a.value, scope, ctx, out);
		scope.set(a.name, a.value === null ? null : resolveWord(a.value, scope));
	}
	for (const word of node.argv) collectWordSubsts(word, scope, ctx, out);
	collectRedirects(node.redirects, scope, ctx, out);

	const rest = stripWrappersPure(resolveArgv(node.argv, scope));
	const exe = rest[0];
	if (exe === undefined) return;
	if (exe.text === null) {
		out.push(exe.raw);
		return;
	}
	const cmd = baseCommand(exe.text);
	const args = rest.slice(1);
	out.push([cmd, ...args.map((a) => a.text ?? a.raw)].join(" "));
	if (cmd === "find") out.push(...findExecCommands(args));

	// Nested shells and eval carry commands of their own.
	if (isShell(cmd)) {
		const inner = shellCScript(args);
		if (typeof inner === "string") collectNested(inner, scope, ctx, out);
		else if (inner === undefined) {
			const stdin = stdinText(node.redirects, scope);
			if (typeof stdin === "string") collectNested(stdin, scope, ctx, out);
		}
	} else if (cmd === "eval") {
		const joined = joinLiteral(args);
		if (joined !== null) collectNested(joined, scope, ctx, out);
	} else if (cmd === "script") {
		for (const inner of scriptCommands(args)) {
			if (inner !== null) collectNested(inner, scope, ctx, out);
		}
	}
}

function collectNested(
	command: string,
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	const parser = ctx.shell;
	if (parser === null) return;
	const parsed = parser.parse(command);
	if (parsed.ok) collectScript(parsed.value, new Map(scope), ctx, out);
}

function collectWordSubsts(
	word: ShellWord,
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	for (const part of word.parts) {
		if (part.kind === "subst" || part.kind === "procsubst") {
			collectScript(part.script, new Map(scope), ctx, out);
		} else if (part.kind === "param" && part.fallback) {
			collectWordSubsts(part.fallback, scope, ctx, out);
		} else if (part.kind === "opaque") {
			for (const inner of part.scripts) {
				collectScript(inner, new Map(scope), ctx, out);
			}
		}
	}
}

/** Commands run by redirects: `> >(…)`, `< <(…)`, an expanding heredoc body. */
function collectRedirects(
	redirects: readonly Redirect[],
	scope: Scope,
	ctx: GateContext,
	out: string[],
): void {
	for (const r of redirects) {
		if (r.kind === "file") collectWordSubsts(r.target, scope, ctx, out);
		else if (r.kind === "herestring")
			collectWordSubsts(r.word, scope, ctx, out);
		else if (r.kind === "heredoc") {
			for (const inner of r.substs) {
				collectScript(inner, new Map(scope), ctx, out);
			}
			for (const source of r.backticks) collectNested(source, scope, ctx, out);
		}
	}
}

/** The command a `find -exec`/`-execdir`/`-ok`/`-okdir` runs, up to `;` or `+`. */
function findExecCommands(args: Argv): readonly string[] {
	const found: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const flag = args[i]?.text;
		if (
			flag !== "-exec" &&
			flag !== "-execdir" &&
			flag !== "-ok" &&
			flag !== "-okdir"
		) {
			continue;
		}
		const words: Arg[] = [];
		let j = i + 1;
		for (; j < args.length; j++) {
			const t = args[j]?.text;
			if (t === ";" || t === "+") break;
			words.push(args[j] as Arg);
		}
		const [exe, ...rest] = stripWrappersPure(words);
		if (exe !== undefined) {
			const name = exe.text === null ? exe.raw : baseCommand(exe.text);
			found.push([name, ...rest.map((a) => a.text ?? a.raw)].join(" "));
		}
		i = j;
	}
	return found;
}
