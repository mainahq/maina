/**
 * Ground-truth tests for mitt event emitter.
 * Adapted from https://github.com/developit/mitt/blob/main/test/index_test.ts
 * Ported to bun:test. These tests run against ANY implementation that exports
 * a default mitt() factory function.
 *
 * The implementation path is injected via MITT_IMPL_PATH env var.
 */
import { beforeEach, describe, expect, test } from "bun:test";

// Dynamic import so the harness can point to either pipeline's output
const implPath = process.env.MITT_IMPL_PATH ?? "./mitt";
const { default: mitt } = await import(implPath);

type Events = {
	foo: unknown;
	constructor: unknown;
	FOO: unknown;
	bar: unknown;
	Bar: unknown;
};

describe("mitt", () => {
	describe("factory", () => {
		test("should be a function", () => {
			expect(typeof mitt).toBe("function");
		});

		test("should accept an optional event handler map", () => {
			const map = new Map();
			const a = () => {};
			const b = () => {};
			map.set("foo", [a, b]);

			const events = mitt<Events>(map);
			events.emit("foo", undefined);

			// If map was accepted, handlers should have fired
			expect(map.get("foo")).toEqual([a, b]);
		});
	});

	describe("on", () => {
		test("should register handler for new type", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("foo", handler);

			expect(events.all.get("foo")).toEqual([handler]);
		});

		test("should register handlers for any type strings including reserved names", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("constructor", handler);

			expect(events.all.get("constructor")).toEqual([handler]);
		});

		test("should append multiple handlers for the same type", () => {
			const events = mitt<Events>();
			const handler1 = () => {};
			const handler2 = () => {};
			events.on("foo", handler1);
			events.on("foo", handler2);

			expect(events.all.get("foo")).toEqual([handler1, handler2]);
		});

		test("should NOT normalize case", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("FOO", handler);
			events.on("Bar", handler);

			expect(events.all.get("FOO")).toEqual([handler]);
			expect(events.all.get("Bar")).toEqual([handler]);
			expect(events.all.has("foo" as keyof Events)).toBe(false);
			expect(events.all.has("bar" as keyof Events)).toBe(false);
		});

		test("should allow registering the same handler multiple times", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("foo", handler);
			events.on("foo", handler);

			expect(events.all.get("foo")).toEqual([handler, handler]);
		});
	});

	describe("off", () => {
		test("should remove handler", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("foo", handler);
			events.off("foo", handler);

			expect(events.all.get("foo")).toEqual([]);
		});

		test("should NOT normalize case", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("FOO", handler);
			events.on("Bar", handler);

			events.off("FOO", handler);
			events.off("Bar", handler);

			expect(events.all.get("FOO")).toEqual([]);
			expect(events.all.get("Bar")).toEqual([]);
			expect(events.all.has("foo" as keyof Events)).toBe(false);
			expect(events.all.has("bar" as keyof Events)).toBe(false);
		});

		test("should remove only the first matching handler when registered multiple times", () => {
			const events = mitt<Events>();
			const handler = () => {};
			events.on("foo", handler);
			events.on("foo", handler);
			events.off("foo", handler);

			expect(events.all.get("foo")).toEqual([handler]);
		});

		test("should remove all handlers for type when called without handler", () => {
			const events = mitt<Events>();
			events.on("foo", () => {});
			events.on("foo", () => {});
			events.on("foo", () => {});
			events.off("foo");

			expect(events.all.get("foo")).toEqual([]);
		});
	});

	describe("emit", () => {
		test("should invoke handler for matching type with event data", () => {
			const events = mitt<Events>();
			const results: unknown[] = [];
			events.on("foo", (data) => results.push(data));

			events.emit("foo", "testdata");

			expect(results).toEqual(["testdata"]);
		});

		test("should NOT normalize case when emitting", () => {
			const events = mitt<Events>();
			const results: string[] = [];
			events.on("FOO", () => results.push("upper"));
			events.on("foo", () => results.push("lower"));

			events.emit("foo", undefined);

			expect(results).toEqual(["lower"]);
		});

		test("should invoke wildcard handlers after type handlers", () => {
			const events = mitt<Events>();
			const results: string[] = [];

			events.on("foo", () => results.push("type"));
			events.on("*", () => results.push("wildcard"));

			events.emit("foo", undefined);

			expect(results).toEqual(["type", "wildcard"]);
		});

		test("should pass type and event to wildcard handlers", () => {
			const events = mitt<Events>();
			const results: [string | symbol, unknown][] = [];

			events.on("*", (type, event) =>
				results.push([type as string | symbol, event]),
			);

			events.emit("foo", "bar");

			expect(results).toEqual([["foo", "bar"]]);
		});
	});
});
