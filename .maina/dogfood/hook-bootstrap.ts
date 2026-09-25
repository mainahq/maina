#!/usr/bin/env bun
/**
 * Maina dogfood bootstrap hook — a rules-only Claude Code `PreToolUse` hook
 * for the Maina repo only (#286, FR-DOG-1/2).
 *
 * Wired from the repo's own `.claude/settings.json`. It checks one tool call
 * against a fixed deny list and otherwise stays silent so the normal Claude
 * Code permission flow applies:
 *
 *   destructive-shell   rm -r of /, ~, the repo or anything outside it; sudo;
 *                       mkfs; dd to a device; fork bombs
 *   write-outside-repo  Write/Edit/redirect/tee/cp/mv outside the repo
 *                       (temp dirs and ~/.claude/projects are allowed)
 *   secrets             reading .env / keys / credential files, dumping tokens,
 *                       writing token-shaped strings or private keys
 *   publish             npm/bun publish, changeset publish, release scripts,
 *                       gh release create
 *   protected-push      git push to master, main or v1/main (incl. deletes,
 *                       --all/--mirror, bare push while on a protected branch)
 *
 * Fail closed: any crash resolves to `ask`. The settings.json command also
 * falls back to `ask` if this script cannot start at all.
 *
 * Override: launch Claude Code with MAINA_DOGFOOD_OVERRIDE=1 and denies become
 * `ask` (you still confirm each one); the log records `override: true`.
 *
 * Every decision is appended to `.maina/dogfood/log.jsonl` (gitignored) as
 * `{ ts, tool, action, verdict, reason, override? }`, a subset of the Phase 3
 * decision schema, and summarised weekly by `bun run dogfood:report`.
 *
 * Deliberately small scaffolding: Phase 4 replaces it.
 */

import { basename, isAbsolute, normalize, resolve } from "node:path";

export type Verdict = "allow" | "ask" | "deny";

export interface HookInput {
	readonly tool_name?: string;
	readonly tool_input?: Readonly<Record<string, unknown>>;
	readonly cwd?: string;
}

export interface HookContext {
	readonly repoRoot: string;
	readonly home: string;
	/** Directories where writes are always fine (OS temp dirs). */
	readonly tmpDirs: readonly string[];
	readonly currentBranch?: string;
	readonly override: boolean;
	readonly now: () => string;
}

export interface Decision {
	readonly verdict: Verdict;
	readonly reason: string;
}

export interface LogRecord {
	readonly ts: string;
	readonly tool: string;
	readonly action: string;
	readonly verdict: Verdict;
	readonly reason: string;
	readonly override?: true;
}

export interface HookOutput {
	readonly stdout: string;
	readonly record: LogRecord;
}

const PROTECTED_BRANCHES: ReadonlySet<string> = new Set([
	"master",
	"main",
	"v1/main",
]);

const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"Write",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
]);

const SAFE_DEVICES: ReadonlySet<string> = new Set([
	"/dev/null",
	"/dev/stdout",
	"/dev/stderr",
	"/dev/tty",
]);

const SECRET_CONTENT: readonly RegExp[] = [
	/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
	/\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bnpm_[A-Za-z0-9]{36}\b/,
	/\bsk-(?:ant|or)-[A-Za-z0-9_-]{20,}/,
];

const SECRET_VAR = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)/i;

const ALLOW: Decision = { verdict: "allow", reason: "no rule matched" };
const deny = (rule: string, detail: string): Decision => ({
	verdict: "deny",
	reason: `${rule}: ${detail}`,
});

// ── Paths ────────────────────────────────────────────────────────────────

/** Literal shell spellings of the home directory (not JS templates). */
const HOME_WORDS: readonly string[] = ["~", "$HOME", "$" + "{HOME}"];

function expandHome(p: string, home: string): string {
	if (HOME_WORDS.includes(p)) return home;
	for (const prefix of HOME_WORDS.map((w) => `${w}/`)) {
		if (p.startsWith(prefix)) return `${home}/${p.slice(prefix.length)}`;
	}
	return p;
}

function resolveFrom(p: string, cwd: string, home: string): string {
	const expanded = expandHome(p, home);
	return isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
}

function isInside(p: string, dir: string): boolean {
	const d = dir.endsWith("/") ? dir.slice(0, -1) : dir;
	return p === d || p.startsWith(`${d}/`);
}

function isWritable(p: string, ctx: HookContext): boolean {
	return (
		SAFE_DEVICES.has(p) ||
		isInside(p, ctx.repoRoot) ||
		ctx.tmpDirs.some((t) => isInside(p, t)) ||
		isInside(p, `${ctx.home}/.claude/projects`)
	);
}

function isSecretPath(raw: string): boolean {
	const p = raw.replace(/^['"]|['"]$/g, "");
	const name = basename(p);
	if (/^\.env(\..+)?$/.test(name)) {
		return !/\.(example|sample|template|defaults)$/.test(name);
	}
	return (
		/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) ||
		/\.(pem|p12|pfx)$/.test(name) ||
		name === ".netrc" ||
		name === ".pgpass" ||
		/(^|\/)\.ssh(\/|$)/.test(p) ||
		/(^|\/)\.aws\/credentials$/.test(p) ||
		/(^|\/)\.config\/gh\/hosts\.yml$/.test(p) ||
		/(^|\/)\.docker\/config\.json$/.test(p)
	);
}

// ── Shell parsing (deliberately naive) ───────────────────────────────────

function splitSegments(command: string): readonly string[] {
	return command
		.split(/&&|\|\||[;|\n]|(?<![>&])&(?![>&])/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function tokenize(segment: string): readonly string[] {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const m of segment.matchAll(re)) {
		tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return tokens;
}

const WRAPPERS: ReadonlySet<string> = new Set([
	"time",
	"nohup",
	"exec",
	"command",
	"builtin",
]);

/** Drop leading `VAR=x` assignments and trivial wrappers. */
function stripPrefix(tokens: readonly string[]): readonly string[] {
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i] ?? "";
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(t)) i++;
		else if (t === "env" && i + 1 < tokens.length) i++;
		else break;
	}
	return tokens.slice(i);
}

function redirectTargets(command: string): readonly string[] {
	const out: string[] = [];
	const re = /(?:\d|&)?>>?(?!&)\s*("[^"]*"|'[^']*'|[^\s;&|()<>]+)/g;
	for (const m of command.matchAll(re)) {
		if (m[1]) out.push(m[1].replace(/^['"]|['"]$/g, ""));
	}
	return out;
}

const positional = (args: readonly string[]): readonly string[] =>
	args.filter((a) => !a.startsWith("-"));

// ── Rules ────────────────────────────────────────────────────────────────

function checkRm(
	args: readonly string[],
	cwd: string,
	ctx: HookContext,
): Decision | undefined {
	const recursive = args.some(
		(a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive",
	);
	for (const target of positional(args)) {
		if (/[$`]/.test(expandHome(target, ctx.home))) {
			return recursive
				? { verdict: "ask", reason: `destructive-shell: rm -r of ${target}` }
				: undefined;
		}
		const p = resolveFrom(target.replace(/\/?\*$/, "") || ".", cwd, ctx.home);
		if (recursive && (p === "/" || p === ctx.home)) {
			return deny("destructive-shell", `recursive rm of ${target}`);
		}
		if (recursive && isInside(ctx.repoRoot, p)) {
			return deny("destructive-shell", `recursive rm of the repo (${target})`);
		}
		if (!isWritable(p, ctx)) {
			return deny("write-outside-repo", `rm ${target}`);
		}
	}
	return undefined;
}

function checkGitPush(
	args: readonly string[],
	ctx: HookContext,
): Decision | undefined {
	const pushAt = args.indexOf("push");
	if (pushAt < 0) return undefined;
	const rest = args.slice(pushAt + 1);
	if (rest.includes("--all") || rest.includes("--mirror")) {
		return deny("protected-push", "git push --all/--mirror");
	}
	const isDelete = rest.includes("--delete") || rest.includes("-d");
	const pos: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i] ?? "";
		if (a === "-o" || a === "--push-option" || a === "--repo") i++;
		else if (!a.startsWith("-")) pos.push(a);
	}
	const refspecs = pos.slice(1);
	if (refspecs.length === 0) {
		return ctx.currentBranch && PROTECTED_BRANCHES.has(ctx.currentBranch)
			? deny("protected-push", `git push while on ${ctx.currentBranch}`)
			: undefined;
	}
	for (const spec of refspecs) {
		const clean = spec.replace(/^\+/, "");
		const dstRaw = clean.includes(":")
			? clean.slice(clean.indexOf(":") + 1)
			: clean;
		const dst0 = dstRaw.replace(/^refs\/heads\//, "");
		const dst = dst0 === "HEAD" ? (ctx.currentBranch ?? "HEAD") : dst0;
		if (PROTECTED_BRANCHES.has(dst)) {
			return deny(
				"protected-push",
				`${isDelete || clean.startsWith(":") ? "delete of" : "push to"} ${dst}`,
			);
		}
	}
	return undefined;
}

function checkSegment(
	tokens0: readonly string[],
	cwd: string,
	ctx: HookContext,
): Decision | undefined {
	const tokens = stripPrefix(tokens0);
	const [cmd = "", ...args] = tokens;
	const sub = args[0] ?? "";

	// Nested shells: evaluate the inner script too.
	if (/^(ba|z)?sh$/.test(cmd) && args[0] === "-c" && args[1]) {
		return evaluateShell(args[1], cwd, ctx);
	}
	if (cmd === "sudo" || cmd === "doas") {
		return deny("destructive-shell", `privilege escalation (${cmd})`);
	}
	if (/^mkfs(\.|$)/.test(cmd)) return deny("destructive-shell", cmd);
	if (cmd === "dd" && args.some((a) => a.startsWith("of=/dev/"))) {
		return deny("destructive-shell", "dd to a device");
	}
	if (cmd === "rm") {
		const r = checkRm(args, cwd, ctx);
		if (r) return r;
	}
	if (
		(cmd === "chmod" || cmd === "chown") &&
		args.some((a) => /^-[a-zA-Z]*R/.test(a))
	) {
		const outside = positional(args)
			.slice(1)
			.find((t) => !isWritable(resolveFrom(t, cwd, ctx.home), ctx));
		if (outside) return deny("destructive-shell", `${cmd} -R ${outside}`);
	}

	// Writes outside the repo.
	const writeTargets =
		cmd === "tee" || cmd === "touch"
			? positional(args)
			: cmd === "cp" || cmd === "mv"
				? positional(args).slice(-1)
				: [];
	for (const t of writeTargets) {
		if (!isWritable(resolveFrom(t, cwd, ctx.home), ctx)) {
			return deny("write-outside-repo", `${cmd} ${t}`);
		}
	}

	// Secrets.
	const secretArg = args.find(
		(a) => isSecretPath(a) || isSecretPath(a.split("=").slice(1).join("=")),
	);
	if (secretArg) return deny("secrets", `${cmd} ${secretArg}`);
	if (cmd === "gh" && sub === "auth" && args[1] === "token") {
		return deny("secrets", "gh auth token");
	}
	if (
		(cmd === "printenv" &&
			(args.length === 0 || args.some((a) => SECRET_VAR.test(a)))) ||
		(cmd === "env" && args.length === 0)
	) {
		return deny("secrets", `${cmd} dumps secrets`);
	}
	if (
		(cmd === "echo" || cmd === "printf") &&
		args.some((a) => /\$\{?[A-Za-z_]*/.test(a) && SECRET_VAR.test(a))
	) {
		return deny("secrets", `${cmd} of a secret variable`);
	}

	// Publishing.
	if (["npm", "pnpm", "yarn", "bun"].includes(cmd) && sub === "publish") {
		return deny("publish", `${cmd} publish`);
	}
	if (
		(cmd === "changeset" && sub === "publish") ||
		((cmd === "bunx" || cmd === "npx") &&
			sub === "changeset" &&
			args[1] === "publish")
	) {
		return deny("publish", "changeset publish");
	}
	if (
		["npm", "pnpm", "yarn", "bun"].includes(cmd) &&
		((sub === "run" && args[1] === "release") ||
			(cmd === "yarn" && sub === "release"))
	) {
		return deny("publish", `${cmd} run release`);
	}
	if (
		cmd === "gh" &&
		sub === "release" &&
		(args[1] === "create" || args[1] === "upload")
	) {
		return deny("publish", `gh release ${args[1]}`);
	}
	if (cmd === "git") {
		const r = checkGitPush(args, ctx);
		if (r) return r;
	}
	return undefined;
}

function evaluateShell(
	command: string,
	cwd: string,
	ctx: HookContext,
): Decision | undefined {
	if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command)) {
		return deny("destructive-shell", "fork bomb");
	}
	for (const target of redirectTargets(command)) {
		if (isSecretPath(target)) return deny("secrets", `redirect to ${target}`);
		if (!isWritable(resolveFrom(target, cwd, ctx.home), ctx)) {
			return deny("write-outside-repo", `redirect to ${target}`);
		}
	}
	// Remove redirections before tokenising so `> file` is not an argument.
	const stripped = command.replace(
		/(?:\d|&)?>>?(?:&\d+|\s*(?:"[^"]*"|'[^']*'|[^\s;&|()<>]+))/g,
		" ",
	);
	for (const segment of splitSegments(stripped)) {
		const d = checkSegment(tokenize(segment), cwd, ctx);
		if (d) return d;
	}
	return undefined;
}

function contentOf(input: Readonly<Record<string, unknown>>): string {
	const parts: string[] = [];
	for (const key of ["content", "new_string", "new_source"]) {
		const v = input[key];
		if (typeof v === "string") parts.push(v);
	}
	const edits = input.edits;
	if (Array.isArray(edits)) {
		for (const e of edits) {
			const v = (e as Record<string, unknown> | null)?.new_string;
			if (typeof v === "string") parts.push(v);
		}
	}
	return parts.join("\n");
}

/** Pure decision for one tool call. `allow` means "no rule matched". */
export function evaluate(input: HookInput, ctx: HookContext): Decision {
	const tool = input.tool_name ?? "";
	const ti = input.tool_input ?? {};
	const cwd = input.cwd ?? ctx.repoRoot;

	if (tool === "Bash") {
		const command = typeof ti.command === "string" ? ti.command : "";
		return evaluateShell(command, cwd, ctx) ?? ALLOW;
	}

	const pathField = [ti.file_path, ti.notebook_path, ti.path].find(
		(v): v is string => typeof v === "string" && v.length > 0,
	);
	if (pathField && isSecretPath(pathField)) {
		return deny("secrets", `${tool} ${pathField}`);
	}
	if (WRITE_TOOLS.has(tool)) {
		if (pathField && !isWritable(resolveFrom(pathField, cwd, ctx.home), ctx)) {
			return deny("write-outside-repo", pathField);
		}
		const content = contentOf(ti);
		if (SECRET_CONTENT.some((re) => re.test(content))) {
			return deny("secrets", `${tool} writes a token-shaped secret`);
		}
	}
	return ALLOW;
}

function actionOf(input: HookInput): string {
	const ti = input.tool_input ?? {};
	const raw =
		typeof ti.command === "string"
			? ti.command
			: typeof ti.file_path === "string"
				? ti.file_path
				: typeof ti.notebook_path === "string"
					? ti.notebook_path
					: JSON.stringify(ti);
	return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
}

function hookJson(verdict: "ask" | "deny", reason: string): string {
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: verdict,
			permissionDecisionReason: `maina dogfood guard: ${reason}`,
		},
	});
}

function parseInput(raw: string): HookInput | undefined {
	const v: unknown = JSON.parse(raw);
	return typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as HookInput)
		: undefined;
}

/**
 * Run the hook over raw stdin. Never throws: parse errors and evaluator
 * crashes resolve to `ask` (fail closed).
 */
export function runHook(
	raw: string,
	ctx: HookContext,
	evaluateFn: (input: HookInput, ctx: HookContext) => Decision = evaluate,
): HookOutput {
	let input: HookInput = {};
	let decision: Decision;
	try {
		const parsed = parseInput(raw);
		if (parsed) {
			input = parsed;
			decision = evaluateFn(input, ctx);
		} else {
			decision = {
				verdict: "ask",
				reason: "hook crash: input is not an object",
			};
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		decision = { verdict: "ask", reason: `hook crash: ${msg}` };
	}

	const overridden = decision.verdict === "deny" && ctx.override;
	const final: Decision = overridden
		? { verdict: "ask", reason: `[override] ${decision.reason}` }
		: decision;

	let action = "";
	try {
		action = actionOf(input);
	} catch {
		action = "";
	}
	const record: LogRecord = {
		ts: ctx.now(),
		tool: input.tool_name ?? "unknown",
		action,
		verdict: final.verdict,
		reason: final.reason,
		...(overridden ? { override: true as const } : {}),
	};
	const stdout =
		final.verdict === "allow" ? "" : hookJson(final.verdict, final.reason);
	return { stdout, record };
}

// ── Imperative shell ─────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { appendFileSync, mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	const { homedir, tmpdir } = await import("node:os");
	const raw = await Bun.stdin.text();
	const repoRoot = resolve(import.meta.dir, "../..");

	let currentBranch: string | undefined;
	if (/\bgit\b[\s\S]*\bpush\b/.test(raw)) {
		const cwdMatch = raw.match(/"cwd"\s*:\s*"([^"]+)"/);
		const r = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: cwdMatch?.[1] ?? repoRoot,
			stdout: "pipe",
			stderr: "ignore",
		});
		if (r.exitCode === 0) currentBranch = r.stdout.toString().trim();
	}

	const out = runHook(raw, {
		repoRoot,
		home: homedir(),
		tmpDirs: [
			"/tmp",
			"/private/tmp",
			"/var/folders",
			"/private/var/folders",
			tmpdir(),
		],
		currentBranch,
		override: process.env.MAINA_DOGFOOD_OVERRIDE === "1",
		now: () => new Date().toISOString(),
	});

	try {
		const logPath =
			process.env.MAINA_DOGFOOD_LOG ??
			resolve(repoRoot, ".maina/dogfood/log.jsonl");
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(logPath, `${JSON.stringify(out.record)}\n`);
	} catch {
		// Logging is best-effort; it never changes the decision.
	}
	if (out.stdout) process.stdout.write(`${out.stdout}\n`);
}

if (import.meta.main) {
	try {
		await main();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stdout.write(`${hookJson("ask", `hook crash: ${msg}`)}\n`);
	}
}
