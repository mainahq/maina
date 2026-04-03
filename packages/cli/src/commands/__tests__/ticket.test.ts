import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

let mockClackTextResponses: string[] = [];
let mockClackTextCallIndex = 0;

// ── Mocks ────────────────────────────────────────────────────────────────────

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({
		start: () => {},
		stop: () => {},
	}),
	text: async () => {
		const response = mockClackTextResponses[mockClackTextCallIndex] ?? "";
		mockClackTextCallIndex++;
		return response;
	},
	confirm: async () => true,
	isCancel: (v: unknown) => typeof v === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { ticketAction } = await import("../ticket");
type TicketDepsType = import("../ticket").TicketDeps;

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockClackTextResponses = [];
	mockClackTextCallIndex = 0;
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("ticketAction", () => {
	test("creates ticket with --title and --body flags (non-interactive)", async () => {
		let createTicketCalled = false;
		let capturedTitle = "";
		let capturedBody = "";

		const mockDeps: TicketDepsType = {
			createTicket: async (options) => {
				createTicketCalled = true;
				capturedTitle = options.title;
				capturedBody = options.body;
				return {
					ok: true,
					value: { url: "https://github.com/owner/repo/issues/1", number: 1 },
				};
			},
			detectModules: (_mainaDir, _title, _body) => [],
		};

		const result = await ticketAction(
			{
				title: "Fix bug in context engine",
				body: "The budget calculation is wrong",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.url).toBe("https://github.com/owner/repo/issues/1");
		expect(createTicketCalled).toBe(true);
		expect(capturedTitle).toBe("Fix bug in context engine");
		expect(capturedBody).toBe("The budget calculation is wrong");
	});

	test("prompts for title and body in interactive mode", async () => {
		mockClackTextResponses = ["Interactive title", "Interactive body"];

		const mockDeps: TicketDepsType = {
			createTicket: async (_options) => ({
				ok: true,
				value: { url: "https://github.com/owner/repo/issues/5", number: 5 },
			}),
			detectModules: () => [],
		};

		const result = await ticketAction({ cwd: tmpDir }, mockDeps);

		expect(result.created).toBe(true);
		expect(result.url).toBe("https://github.com/owner/repo/issues/5");
	});

	test("merges auto-detected labels with --label flags", async () => {
		let capturedLabels: string[] | undefined;

		const mockDeps: TicketDepsType = {
			createTicket: async (options) => {
				capturedLabels = options.labels;
				return {
					ok: true,
					value: { url: "https://github.com/owner/repo/issues/10", number: 10 },
				};
			},
			detectModules: (_mainaDir, _title, _body) => ["context", "verify"],
		};

		const result = await ticketAction(
			{
				title: "Fix context engine",
				body: "Budget issue",
				label: ["bug", "priority"],
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.created).toBe(true);
		// Should have both user-provided and auto-detected labels
		expect(capturedLabels).toContain("bug");
		expect(capturedLabels).toContain("priority");
		expect(capturedLabels).toContain("context");
		expect(capturedLabels).toContain("verify");
	});

	test("deduplicates labels when --label overlaps with auto-detected", async () => {
		let capturedLabels: string[] | undefined;

		const mockDeps: TicketDepsType = {
			createTicket: async (options) => {
				capturedLabels = options.labels;
				return {
					ok: true,
					value: { url: "https://github.com/owner/repo/issues/11", number: 11 },
				};
			},
			detectModules: () => ["context"],
		};

		await ticketAction(
			{
				title: "Fix context",
				body: "Body",
				label: ["context", "bug"],
				cwd: tmpDir,
			},
			mockDeps,
		);

		// "context" should appear only once
		const contextCount =
			capturedLabels?.filter((l) => l === "context").length ?? 0;
		expect(contextCount).toBe(1);
	});

	test("returns helpful error when gh is not installed", async () => {
		const mockDeps: TicketDepsType = {
			createTicket: async () => ({
				ok: false,
				error: "gh CLI not found. Install from https://cli.github.com",
			}),
			detectModules: () => [],
		};

		const result = await ticketAction(
			{
				title: "Test",
				body: "Body",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("gh");
	});

	test("returns created:false when createTicket fails", async () => {
		const mockDeps: TicketDepsType = {
			createTicket: async () => ({
				ok: false,
				error: "Authentication required",
			}),
			detectModules: () => [],
		};

		const result = await ticketAction(
			{
				title: "Test",
				body: "Body",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.created).toBe(false);
		expect(result.reason).toBe("Authentication required");
	});

	test("works with no labels at all", async () => {
		let capturedLabels: string[] | undefined;

		const mockDeps: TicketDepsType = {
			createTicket: async (options) => {
				capturedLabels = options.labels;
				return {
					ok: true,
					value: { url: "https://github.com/owner/repo/issues/20", number: 20 },
				};
			},
			detectModules: () => [],
		};

		const result = await ticketAction(
			{
				title: "Simple issue",
				body: "No labels needed",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.created).toBe(true);
		// Labels should be empty or undefined when no auto-detected and no --label
		expect(capturedLabels?.length ?? 0).toBe(0);
	});
});
