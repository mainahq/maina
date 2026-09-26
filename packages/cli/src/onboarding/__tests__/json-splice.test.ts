/**
 * Layout-preserving edits of one top-level key in a JSON object: every byte
 * outside that key's member stays as it was, whatever the file's layout.
 */

import { describe, expect, test } from "bun:test";
import { removeTopLevelKey, setTopLevelKey } from "../json-splice";

const VALUE = { type: "command", command: "maina cli statusline", padding: 0 };

/** Hand-written layouts a re-serialise would rewrite. */
const LAYOUTS = [
	'{\n  "permissions": { "allow": ["Bash(ls)"] },\n  "model": "opus"\n}\n',
	'{"model":"opus"}',
	'{\n  "a": 1.0,\n  "b": "\\u00e9"\n}\n',
	'{\n\t"model" : "opus" ,\n\t"env": {"A": "1"}\n}',
	'  {\r\n    "model": "opus"\r\n  }\r\n',
	'{\n  "text": "a } b { \\" ,",\n  "n": [1, [2, {"x": "}"}]]\n}\n',
];

describe("setTopLevelKey", () => {
	test("adds the key and keeps every other byte", () => {
		for (const text of LAYOUTS) {
			const set = setTopLevelKey(text, "statusLine", VALUE);
			expect(set).not.toBeNull();
			if (set === null) continue;
			const parsed = JSON.parse(set);
			expect(parsed.statusLine).toEqual(VALUE);
			const { statusLine: _added, ...rest } = parsed;
			expect(rest).toEqual(JSON.parse(text));
			expect(removeTopLevelKey(set, "statusLine")).toBe(text);
		}
	});

	test("follows the file's indentation", () => {
		const set = setTopLevelKey('{\n\t"model": "opus"\n}\n', "statusLine", {
			a: 1,
		});
		expect(set).toBe(
			'{\n\t"model": "opus",\n\t"statusLine": {\n\t\t"a": 1\n\t}\n}\n',
		);
	});

	test("a minified file stays minified", () => {
		expect(setTopLevelKey('{"model":"opus"}', "statusLine", { a: 1 })).toBe(
			'{"model":"opus","statusLine":{"a":1}}',
		);
	});

	test("replaces only an existing key's value", () => {
		const text =
			'{\n  "statusLine": {"type": "command", "command": "old"},\n  "x": [1,2]\n}\n';
		expect(setTopLevelKey(text, "statusLine", { a: 1 })).toBe(
			'{\n  "statusLine": {\n    "a": 1\n  },\n  "x": [1,2]\n}\n',
		);
	});

	test("matches a key spelled with escapes", () => {
		const text = '{"status\\u004cine": 1, "x": 2}';
		expect(setTopLevelKey(text, "statusLine", 3)).toBe(
			'{"status\\u004cine": 3, "x": 2}',
		);
	});

	test("defers to the caller when it cannot splice", () => {
		for (const text of ["", "{}", "{ }", "[]", "not json", '{"a":1,"a":2}']) {
			expect(setTopLevelKey(text, "a", 1)).toBeNull();
		}
	});
});

describe("removeTopLevelKey", () => {
	test("removes a first, middle or last member cleanly", () => {
		const cases: readonly (readonly [string, string])[] = [
			['{\n  "k": 1,\n  "a": 2\n}\n', '{\n  "a": 2\n}\n'],
			[
				'{\n  "a": 1,\n  "k": {"x": [1]},\n  "b": 2\n}\n',
				'{\n  "a": 1,\n  "b": 2\n}\n',
			],
			['{"a":1,"k":2}', '{"a":1}'],
		];
		for (const [text, expected] of cases) {
			expect(removeTopLevelKey(text, "k")).toBe(expected);
		}
	});

	test("defers to the caller for a missing, duplicate or only key", () => {
		for (const text of ['{"a":1}', '{"k":1}', '{"k":1,"k":2}', "", "nope"]) {
			expect(removeTopLevelKey(text, "k")).toBeNull();
		}
	});
});
