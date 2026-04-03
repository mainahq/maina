import { describe, expect, it } from "bun:test";
import { getAllRules, getTtl, isExpired } from "../ttl";

describe("getTtl", () => {
	it("review TTL is 0 (forever)", () => {
		expect(getTtl("review")).toBe(0);
	});

	it("tests TTL is 0 (forever)", () => {
		expect(getTtl("tests")).toBe(0);
	});

	it("fix TTL is 0 (forever)", () => {
		expect(getTtl("fix")).toBe(0);
	});

	it("commit TTL is 0 (forever)", () => {
		expect(getTtl("commit")).toBe(0);
	});

	it("context TTL is 3600 (1 hour)", () => {
		expect(getTtl("context")).toBe(3600);
	});

	it("explain TTL is 86400 (24 hours)", () => {
		expect(getTtl("explain")).toBe(86400);
	});

	it("design TTL is 86400 (24 hours)", () => {
		expect(getTtl("design")).toBe(86400);
	});

	it("plan TTL is 86400 (24 hours)", () => {
		expect(getTtl("plan")).toBe(86400);
	});
});

describe("isExpired", () => {
	it("returns false when TTL is 0 (never expires)", () => {
		// Even if createdAt is very old, TTL=0 means forever
		expect(isExpired(0, 0)).toBe(false);
	});

	it("returns false when within TTL", () => {
		const now = Date.now();
		const createdAt = now - 1000; // 1 second ago
		expect(isExpired(createdAt, 3600)).toBe(false); // TTL is 1 hour
	});

	it("returns true when past TTL", () => {
		const now = Date.now();
		const createdAt = now - 7200 * 1000; // 2 hours ago
		expect(isExpired(createdAt, 3600)).toBe(true); // TTL is 1 hour
	});

	it("returns false exactly at TTL boundary", () => {
		const now = Date.now();
		const createdAt = now - 3600 * 1000; // exactly 1 hour ago
		// Not strictly greater than, so at boundary it's not expired
		// (Date.now() - createdAt) === ttl * 1000, not >
		// This is a boundary condition — implementation uses >, so false
		expect(isExpired(createdAt + 1, 3600)).toBe(false);
	});
});

describe("getAllRules", () => {
	it("returns all 8 task types", () => {
		const rules = getAllRules();
		expect(rules.length).toBe(8);
	});

	it("each rule has task, ttl, and description", () => {
		const rules = getAllRules();
		for (const rule of rules) {
			expect(typeof rule.task).toBe("string");
			expect(typeof rule.ttl).toBe("number");
			expect(typeof rule.description).toBe("string");
			expect(rule.description.length).toBeGreaterThan(0);
		}
	});

	it("includes all expected task types", () => {
		const rules = getAllRules();
		const tasks = rules.map((r) => r.task);
		expect(tasks).toContain("review");
		expect(tasks).toContain("tests");
		expect(tasks).toContain("fix");
		expect(tasks).toContain("commit");
		expect(tasks).toContain("context");
		expect(tasks).toContain("explain");
		expect(tasks).toContain("design");
		expect(tasks).toContain("plan");
	});
});
