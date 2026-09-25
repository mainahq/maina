/**
 * Concurrent syncs against one store (#423). Two syncs that overlap each
 * plan from the store as it stood when they started; the one that commits
 * last must not overwrite the other's newer work with a stale plan. The
 * store's result must match running the syncs one after the other, which
 * for the final disk state is a full rebuild into a fresh database.
 */

import { describe, expect, test } from "bun:test";
import { parseFile } from "../../parse/index";
import { indexRepo, updateFiles } from "../index";
import { hashOf } from "../sync";
import type { ParseFn } from "../types";
import { createRepo, dumpTables, ROOT, snapshot, unwrap } from "./helpers";

const version = (n: number) =>
	`export function value(): number {\n\treturn ${n};\n}\n`;

const USE = `import { value } from "./value";

export function twice(): number {
	return value() * 2;
}
`;

/** A parser that holds each call until the test releases it. */
function gatedParse() {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const parse: ParseFn = async (path, content, lang) => {
		entered.resolve();
		await release.promise;
		return parseFile(path, content, lang);
	};
	return { parse, entered: entered.promise, release: release.resolve };
}

/** Every graph table as a full rebuild of `files` would leave it. */
async function rebuilt(files: Readonly<Record<string, string>>) {
	const fresh = createRepo(files);
	unwrap(await indexRepo(fresh.ports, ROOT));
	return dumpTables(fresh.db);
}

describe("concurrent updateFiles", () => {
	test("a sync that planned from a stale snapshot does not overwrite a newer commit", async () => {
		const repo = createRepo({ "src/value.ts": version(0), "src/use.ts": USE });
		unwrap(await indexRepo(repo.ports, ROOT));

		// A reads version 1, then stalls in the parser.
		await repo.write("src/value.ts", version(1));
		const gate = gatedParse();
		const first = updateFiles(repo.ports, ROOT, ["src/value.ts"], {
			parse: gate.parse,
		});
		await gate.entered;

		// B reads version 2 and commits while A is still planning.
		await repo.write("src/value.ts", version(2));
		unwrap(await updateFiles(repo.ports, ROOT, ["src/value.ts"]));

		gate.release();
		unwrap(await first);

		const stored = snapshot(repo.db).files.find(
			(f) => f.path === "src/value.ts",
		);
		expect(stored?.hash).toBe(hashOf(version(2)));
		expect(dumpTables(repo.db)).toEqual(
			await rebuilt({ "src/value.ts": version(2), "src/use.ts": USE }),
		);
	});

	test("overlapping syncs of different files both land", async () => {
		const repo = createRepo({ "src/value.ts": version(0), "src/use.ts": USE });
		unwrap(await indexRepo(repo.ports, ROOT));

		await repo.write("src/value.ts", version(1));
		const gate = gatedParse();
		const first = updateFiles(repo.ports, ROOT, ["src/value.ts"], {
			parse: gate.parse,
		});
		await gate.entered;

		const other = `${USE}\nexport const four = twice() * 2;\n`;
		await repo.write("src/use.ts", other);
		unwrap(await updateFiles(repo.ports, ROOT, ["src/use.ts"]));

		gate.release();
		unwrap(await first);

		expect(dumpTables(repo.db)).toEqual(
			await rebuilt({ "src/value.ts": version(1), "src/use.ts": other }),
		);
	});

	test("a sync that keeps losing the race gives up with a conflict instead of looping", async () => {
		const repo = createRepo({ "src/value.ts": version(0), "src/use.ts": USE });
		unwrap(await indexRepo(repo.ports, ROOT));

		// Every time A parses, another writer commits a new version first.
		let commits = 0;
		const racing: ParseFn = async (path, content, lang) => {
			commits++;
			await repo.write("src/value.ts", version(100 + commits));
			unwrap(await updateFiles(repo.ports, ROOT, ["src/value.ts"]));
			return parseFile(path, content, lang);
		};
		await repo.write("src/use.ts", `${USE}\n// edited\n`);
		const result = await updateFiles(repo.ports, ROOT, ["src/use.ts"], {
			parse: racing,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("conflict");
		expect(commits).toBeGreaterThan(1);
		// The other writer's commits are intact.
		expect(
			snapshot(repo.db).files.find((f) => f.path === "src/value.ts")?.hash,
		).toBe(hashOf(version(100 + commits)));
	});
});
