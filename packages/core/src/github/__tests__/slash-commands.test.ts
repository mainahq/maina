import { describe, expect, test } from "bun:test";
import { isAuthorized, parseSlashCommand } from "../slash-commands";

// ── parseSlashCommand ───────────────────────────────────────────────────

describe("parseSlashCommand", () => {
	test("parses /maina retry", () => {
		const cmd = parseSlashCommand("/maina retry");
		expect(cmd).not.toBeNull();
		expect(cmd?.command).toBe("retry");
		expect(cmd?.args).toBe("");
	});

	test("parses /maina explain with args", () => {
		const cmd = parseSlashCommand("/maina explain check-3");
		expect(cmd).not.toBeNull();
		expect(cmd?.command).toBe("explain");
		expect(cmd?.args).toBe("check-3");
	});

	test("parses /maina approve", () => {
		const cmd = parseSlashCommand("/maina approve");
		expect(cmd?.command).toBe("approve");
	});

	test("returns null for non-matching text", () => {
		expect(parseSlashCommand("just a regular comment")).toBeNull();
	});

	test("returns null for /maina with no subcommand", () => {
		expect(parseSlashCommand("/maina")).toBeNull();
	});

	test("returns null for unknown commands", () => {
		expect(parseSlashCommand("/maina deploy")).toBeNull();
		expect(parseSlashCommand("/maina run-tests")).toBeNull();
	});

	test("handles extra whitespace", () => {
		const cmd = parseSlashCommand("  /maina   retry  ");
		expect(cmd?.command).toBe("retry");
	});

	test("is case insensitive", () => {
		const cmd = parseSlashCommand("/maina RETRY");
		expect(cmd?.command).toBe("retry");
	});

	test("extracts from multi-line comment", () => {
		const text = "Great PR!\n\n/maina approve\n\nLooks good to me.";
		const cmd = parseSlashCommand(text);
		expect(cmd?.command).toBe("approve");
	});

	test("returns raw matched text", () => {
		const cmd = parseSlashCommand("/maina explain check-3");
		expect(cmd?.raw).toBe("/maina explain check-3");
	});
});

// ── isAuthorized ────────────────────────────────────────────────────────

describe("isAuthorized", () => {
	test("allows PR author", () => {
		expect(
			isAuthorized({
				login: "dev",
				isPrAuthor: true,
				hasWritePermission: false,
			}),
		).toBe(true);
	});

	test("allows write-permission users", () => {
		expect(
			isAuthorized({
				login: "maintainer",
				isPrAuthor: false,
				hasWritePermission: true,
			}),
		).toBe(true);
	});

	test("denies random users", () => {
		expect(
			isAuthorized({
				login: "stranger",
				isPrAuthor: false,
				hasWritePermission: false,
			}),
		).toBe(false);
	});
});
