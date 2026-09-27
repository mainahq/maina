/**
 * The bash parser (FR-GATE-2): tree-sitter-bash turned into a small, plain
 * syntax tree the classifier walks. These tests pin the shapes the
 * classifier relies on: how words are quoted and spliced, what a pipeline,
 * a redirect and a substitution look like, and that a syntax error is data.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import type {
	ShellNode,
	ShellParser,
	ShellScript,
	ShellWord,
} from "../parsers/shell";
import { literalText } from "../parsers/shell";
import { shellParser } from "./helpers";

let parser: ShellParser;
beforeAll(async () => {
	parser = await shellParser();
});

function parse(source: string): ShellScript {
	const parsed = parser.parse(source);
	expect(parsed.ok).toBe(true);
	if (!parsed.ok) return { nodes: [], errors: [] };
	return parsed.value;
}

function onlyCommand(source: string): Extract<ShellNode, { kind: "command" }> {
	const script = parse(source);
	expect(script.nodes).toHaveLength(1);
	const node = script.nodes[0];
	expect(node?.kind).toBe("command");
	return node as Extract<ShellNode, { kind: "command" }>;
}

const texts = (words: readonly ShellWord[]): readonly (string | null)[] =>
	words.map(literalText);

describe("words", () => {
	test("quote removal and escapes give the word bash would run", () => {
		expect(texts(onlyCommand("r''m -rf \"/\"").argv)).toEqual([
			"rm",
			"-rf",
			"/",
		]);
		expect(texts(onlyCommand("\\rm x").argv)).toEqual(["rm", "x"]);
		expect(texts(onlyCommand("r\\m x").argv)).toEqual(["rm", "x"]);
		expect(texts(onlyCommand('echo "a \\"b\\" \\$c"').argv)).toEqual([
			"echo",
			'a "b" $c',
		]);
	});

	test("ANSI-C strings are decoded", () => {
		expect(texts(onlyCommand("$'\\x72\\x6d' -rf /").argv)).toEqual([
			"rm",
			"-rf",
			"/",
		]);
		expect(texts(onlyCommand("echo $'a\\tb\\n'").argv)).toEqual([
			"echo",
			"a\tb\n",
		]);
	});

	test("expansions are kept as parameter parts, not text", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion, not a JS template.
		const cmd = onlyCommand('$X -rf "${HOME:-/}"');
		expect(literalText(cmd.argv[0] as ShellWord)).toBeNull();
		expect(cmd.argv[0]?.parts).toEqual([
			{ kind: "param", name: "X", quoted: false, fallback: null },
		]);
		const home = cmd.argv[2]?.parts[0];
		expect(home?.kind).toBe("param");
		if (home?.kind === "param") {
			expect(home.name).toBe("HOME");
			expect(home.quoted).toBe(true);
			expect(home.fallback && literalText(home.fallback)).toBe("/");
		}
	});

	test("command substitution nests a parsed script", () => {
		const cmd = onlyCommand("echo $(rm -rf ~) `ls`");
		const [sub, tick] = [cmd.argv[1]?.parts[0], cmd.argv[2]?.parts[0]];
		expect(sub?.kind).toBe("subst");
		expect(tick?.kind).toBe("subst");
		if (sub?.kind === "subst") {
			const inner = sub.script.nodes[0];
			expect(inner?.kind).toBe("command");
			if (inner?.kind === "command") {
				expect(texts(inner.argv)).toEqual(["rm", "-rf", "~"]);
			}
		}
	});

	test("process substitution nests a parsed script", () => {
		const cmd = onlyCommand("cat <(curl -s https://x.example)");
		const part = cmd.argv[1]?.parts[0];
		expect(part?.kind).toBe("procsubst");
	});
});

describe("statements", () => {
	test("assignments, lists and pipelines keep source order", () => {
		const script = parse("X=rm; $X -rf / && echo hi | sh");
		expect(script.nodes.map((n) => n.kind)).toEqual([
			"assign",
			"command",
			"pipeline",
		]);
		const pipe = script.nodes[2];
		if (pipe?.kind === "pipeline") {
			expect(pipe.stages.map((s) => s.kind)).toEqual(["command", "command"]);
		}
	});

	test("declaration commands become assignments with their keyword", () => {
		const [node] = parse("export A=1 B=two").nodes;
		expect(node?.kind).toBe("assign");
		if (node?.kind === "assign") {
			expect(node.keyword).toBe("export");
			expect(node.assignments.map((a) => a.name)).toEqual(["A", "B"]);
		}
	});

	test("prefix assignments stay on their command", () => {
		const cmd = onlyCommand("FOO=bar bun test");
		expect(cmd.assignments.map((a) => a.name)).toEqual(["FOO"]);
		expect(texts(cmd.argv)).toEqual(["bun", "test"]);
	});

	test("groups, subshells, conditionals and loops expose their bodies", () => {
		const script = parse(
			"(rm -rf a); { rm -rf b; }; if true; then rm -rf c; fi; for f in x y; do rm $f; done",
		);
		expect(script.nodes.map((n) => n.kind)).toEqual([
			"sequence",
			"sequence",
			"sequence",
			"loop",
		]);
		const loop = script.nodes[3];
		if (loop?.kind === "loop") {
			expect(loop.variable).toBe("f");
			expect(loop.items && texts(loop.items)).toEqual(["x", "y"]);
		}
	});

	test("function definitions keep their name and body", () => {
		const [fn] = parse(":(){ :|:& };:").nodes;
		expect(fn?.kind).toBe("function");
		if (fn?.kind === "function") expect(fn.name).toBe(":");
	});
});

describe("redirects", () => {
	test("file redirects carry the operator, descriptor and target", () => {
		const cmd = onlyCommand("rm -rf x 2>/dev/null > out.txt");
		expect(cmd.redirects).toEqual([
			expect.objectContaining({ kind: "file", op: ">", fd: 2 }),
			expect.objectContaining({ kind: "file", op: ">", fd: null }),
		]);
		const [, out] = cmd.redirects;
		if (out?.kind === "file") expect(literalText(out.target)).toBe("out.txt");
	});

	test("descriptor duplication is not a file write", () => {
		const cmd = onlyCommand("ls 2>&1");
		expect(cmd.redirects[0]?.kind).toBe("dup");
	});

	test("heredoc and herestring bodies are captured", () => {
		const heredoc = onlyCommand("psql <<'SQL'\nDROP TABLE x;\nSQL");
		expect(heredoc.redirects[0]).toEqual({
			kind: "heredoc",
			body: "DROP TABLE x;\n",
			expands: false,
			substs: [],
			backticks: [],
		});
		const herestring = onlyCommand("sh <<< 'rm -rf /'");
		const r = herestring.redirects[0];
		expect(r?.kind).toBe("herestring");
		if (r?.kind === "herestring") expect(literalText(r.word)).toBe("rm -rf /");
	});
});

describe("redirects anywhere in a command (#619)", () => {
	// Bash lets a redirect sit anywhere among a command's words; the words
	// after it are still arguments. tree-sitter-bash files them as extra
	// destinations of the redirect (or arguments of a heredoc), so each one
	// must come back as argv, in source order.
	test("every word after a mid-command redirect is argv", () => {
		for (const [source, argv] of [
			["rm < /dev/null -rf ~", ["rm", "-rf", "~"]],
			[
				"git < /dev/null push --force origin main",
				["git", "push", "--force", "origin", "main"],
			],
			["rm 2>&1 -rf ~", ["rm", "-rf", "~"]],
			["rm 2>/dev/null -rf ~", ["rm", "-rf", "~"]],
			["rm &>/dev/null -rf ~", ["rm", "-rf", "~"]],
			["rm >>log -rf ~", ["rm", "-rf", "~"]],
			["rm >out -rf ~ 2>/dev/null /x", ["rm", "-rf", "~", "/x"]],
			["rm 3<in 4>out -rf ~", ["rm", "-rf", "~"]],
			["rm <<< x -rf ~ > out /y", ["rm", "-rf", "~", "/y"]],
			["< /dev/null rm -rf ~", ["rm", "-rf", "~"]],
			["rm -rf 2>/dev/null ~", ["rm", "-rf", "~"]],
		] as const) {
			const cmd = onlyCommand(source);
			expect(texts(cmd.argv), source).toEqual([...argv]);
		}
	});

	test("the redirect keeps only its own target", () => {
		const cmd = onlyCommand("rm < /dev/null -rf ~");
		expect(cmd.redirects).toHaveLength(1);
		const [r] = cmd.redirects;
		expect(r).toEqual(expect.objectContaining({ kind: "file", op: "<" }));
		if (r?.kind === "file") expect(literalText(r.target)).toBe("/dev/null");
		const dup = onlyCommand("rm 2>&1 -rf ~").redirects;
		expect(dup).toEqual([{ kind: "dup", op: ">&", fd: 2, target: "1" }]);
	});

	test("a process substitution target still leaves the words after it", () => {
		const cmd = onlyCommand("rm < <(echo) -rf ~");
		expect(texts(cmd.argv)).toEqual(["rm", "-rf", "~"]);
		const [r] = cmd.redirects;
		expect(r?.kind === "file" && r.target.parts[0]?.kind).toBe("procsubst");
	});

	test("closing a descriptor (`<&-`) takes no target word", () => {
		const cmd = onlyCommand("rm <&- -rf");
		expect(texts(cmd.argv)).toEqual(["rm", "-rf"]);
		expect(cmd.redirects).toEqual([
			{ kind: "dup", op: "<&-", fd: null, target: "-" },
		]);
		// tree-sitter-bash gives up after one word here; the rest is a syntax
		// error, which the gate asks about, and the words it kept stay argv.
		for (const source of ["rm <&- -rf x", "rm >&- -rf x y", "rm 2>&- -rf x"]) {
			const script = parse(source);
			expect(script.errors.length, source).toBeGreaterThan(0);
			const [first] = script.nodes;
			expect(first?.kind === "command" && texts(first.argv), source).toEqual([
				"rm",
				"-rf",
			]);
		}
	});

	test("heredoc arguments on the start line are argv", () => {
		const cmd = onlyCommand("rm <<EOF -rf ~\nhi\nEOF");
		expect(texts(cmd.argv)).toEqual(["rm", "-rf", "~"]);
		expect(cmd.redirects[0]?.kind).toBe("heredoc");
		const nested = onlyCommand("rm <<EOF 2>/dev/null -rf ~\nhi\nEOF");
		expect(texts(nested.argv)).toEqual(["rm", "-rf", "~"]);
		expect(nested.redirects.map((r) => r.kind)).toEqual(["heredoc", "file"]);
	});

	test("a pipe after heredoc arguments starts the next stage", () => {
		const script = parse("cat <<EOF -x | sh\nrm -rf /\nEOF");
		const [node] = script.nodes;
		const pipeline =
			node?.kind === "sequence" ? node.nodes[0] : (node as ShellNode);
		expect(pipeline?.kind).toBe("pipeline");
		if (pipeline?.kind !== "pipeline") return;
		const [head, next] = pipeline.stages;
		expect(head?.kind === "command" && texts(head.argv)).toEqual(["cat", "-x"]);
		expect(next?.kind === "command" && texts(next.argv)).toEqual(["sh"]);
		expect(head?.kind === "command" && head.redirects[0]?.kind).toBe("heredoc");
	});

	test("a digit glued to a redirect is its descriptor, not an argument", () => {
		const glued = onlyCommand("ssh prod-1 0</dev/null");
		expect(texts(glued.argv)).toEqual(["ssh", "prod-1"]);
		expect(glued.redirects).toEqual([
			expect.objectContaining({ kind: "file", op: "<", fd: 0 }),
		]);
		const first = onlyCommand("ssh 0</dev/null prod-1");
		expect(texts(first.argv)).toEqual(["ssh", "prod-1"]);
		expect(first.redirects[0]).toEqual(
			expect.objectContaining({ kind: "file", fd: 0 }),
		);
		// A space between them makes the digit an argument, as in bash.
		expect(texts(onlyCommand("echo 5 > x").argv)).toEqual(["echo", "5"]);
		expect(texts(onlyCommand("ssh prod-1 0 < /dev/null").argv)).toEqual([
			"ssh",
			"prod-1",
			"0",
		]);
		// `&>` and `&>>` take no descriptor in bash: `echo 5&>x` prints `5`
		// into x, so the digit stays an argument.
		for (const source of ["echo 5&>/dev/null", "echo 5&>>log"]) {
			expect(texts(onlyCommand(source).argv), source).toEqual(["echo", "5"]);
		}
	});

	test("words after a redirect on a compound statement are not dropped", () => {
		// Bash rejects `{ …; } > out foo`; the gate must not read it as clean.
		const script = parse("{ echo; } > out rm -rf /");
		const [node] = script.nodes;
		expect(node?.kind).toBe("sequence");
		if (node?.kind !== "sequence") return;
		expect(node.nodes.some((n) => n.kind === "unknown")).toBe(true);
	});
});

describe("errors are data", () => {
	test("a syntax error still parses what it can and lists the error", () => {
		const script = parse("echo ok; if then fi (");
		expect(script.errors.length).toBeGreaterThan(0);
	});

	test("brace-expansion command words are expanded", () => {
		const script = parse("{rm,-rf,/}");
		const node = script.nodes[0];
		expect(node?.kind).toBe("command");
		if (node?.kind === "command") {
			expect(texts(node.argv)).toEqual(["rm", "-rf", "/"]);
		}
	});

	test("garbage and very long input never throw", () => {
		for (const source of [
			"",
			")))(((",
			"'unterminated",
			"$(",
			"a".repeat(100_000),
			"echo $'\\UFFFFFFFF' $'\\U110000'",
		]) {
			expect(parser.parse(source).ok).toBe(true);
		}
	});
});
