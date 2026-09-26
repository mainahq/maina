/**
 * The plugin archives (v1 task 9.7): a deterministic ustar + gzip writer, so
 * a plugin package keeps its executable launcher and the same files always
 * produce the same bytes (and so the same signature).
 */

import { describe, expect, test } from "bun:test";
import { tarGz, untarGz } from "../tar";

const FILES = [
	{
		path: "launcher/launch.sh",
		content: "#!/bin/sh\necho hi\n",
		executable: true,
	},
	{ path: "plugin.json", content: '{"version":"2.0.0"}\n', executable: false },
	{
		path: `skills/${"deep/".repeat(25)}SKILL.md`,
		content: "# long path\n",
		executable: false,
	},
] as const;

describe("tarGz", () => {
	test("round-trips paths, contents and the executable bit", () => {
		const packed = tarGz(FILES);
		expect(packed.ok).toBe(true);
		if (!packed.ok) return;
		const entries = untarGz(packed.value);
		expect(entries.ok).toBe(true);
		if (!entries.ok) return;
		expect(
			entries.value.map((e) => ({
				path: e.path,
				content: new TextDecoder().decode(e.content),
				executable: e.executable,
			})),
		).toEqual(FILES.map((f) => ({ ...f })));
	});

	test("is deterministic", () => {
		const a = tarGz(FILES);
		const b = tarGz([...FILES]);
		expect(a).toEqual(b);
	});

	test("is readable by the system tar", async () => {
		const packed = tarGz(FILES);
		if (!packed.ok) throw new Error(packed.error.kind);
		const proc = Bun.spawn(["tar", "-tzvf", "-"], {
			stdin: packed.value,
			stdout: "pipe",
			stderr: "pipe",
		});
		const listing = await new Response(proc.stdout).text();
		expect(await proc.exited).toBe(0);
		expect(listing).toMatch(/-rwxr-xr-x.*launcher\/launch\.sh/);
		expect(listing).toContain("SKILL.md");
	});

	test("refuses a path too long for ustar", () => {
		const packed = tarGz([
			{ path: "x".repeat(300), content: "", executable: false },
		]);
		expect(packed).toEqual({
			ok: false,
			error: { kind: "path_too_long", path: "x".repeat(300) },
		});
	});

	test("untarGz refuses bytes that are not a gzip tar", () => {
		expect(untarGz(new TextEncoder().encode("nope")).ok).toBe(false);
	});
});
