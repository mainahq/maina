import { describe, expect, test } from "bun:test";
import { contextCommand } from "../commands/context";

describe("context command", () => {
	test("contextCommand() returns a Command instance", () => {
		const cmd = contextCommand();
		expect(cmd).toBeDefined();
		expect(cmd.name()).toBe("context");
	});

	test("context command has 'add' subcommand", () => {
		const cmd = contextCommand();
		const subcommands = cmd.commands.map((c) => c.name());
		expect(subcommands).toContain("add");
	});

	test("context command has 'show' subcommand", () => {
		const cmd = contextCommand();
		const subcommands = cmd.commands.map((c) => c.name());
		expect(subcommands).toContain("show");
	});

	test("context command has --scope option", () => {
		const cmd = contextCommand();
		const options = cmd.options.map((o) => o.long);
		expect(options).toContain("--scope");
	});

	test("context command has --show option", () => {
		const cmd = contextCommand();
		const options = cmd.options.map((o) => o.long);
		expect(options).toContain("--show");
	});

	test("context command has --mode option", () => {
		const cmd = contextCommand();
		const options = cmd.options.map((o) => o.long);
		expect(options).toContain("--mode");
	});

	test("context command description is set", () => {
		const cmd = contextCommand();
		expect(cmd.description()).toBeTruthy();
	});

	test("add subcommand has description", () => {
		const cmd = contextCommand();
		const addCmd = cmd.commands.find((c) => c.name() === "add");
		expect(addCmd?.description()).toBeTruthy();
	});

	test("show subcommand has description", () => {
		const cmd = contextCommand();
		const showCmd = cmd.commands.find((c) => c.name() === "show");
		expect(showCmd?.description()).toBeTruthy();
	});
});
