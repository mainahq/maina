import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import { closeDb, getDb } from "./db";

const TEST_DB = "./test-todos.db";
const PORT = 9876;
const BASE = `http://localhost:${PORT}`;

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	// Clean slate
	try {
		await unlink(TEST_DB);
	} catch {}

	// Init DB with test path
	process.env.PORT = String(PORT);
	getDb(TEST_DB);

	// Import server (uses the DB we just initialized)
	const mod = await import("../index");
	server = mod.server;
});

afterAll(() => {
	server?.stop();
	closeDb();
	unlink(TEST_DB).catch(() => {});
});

describe("Todo API", () => {
	describe("GET /todos", () => {
		it("returns empty array initially", async () => {
			const res = await fetch(`${BASE}/todos`);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.data).toEqual([]);
			expect(json.error).toBeNull();
		});
	});

	describe("POST /todos", () => {
		it("creates a todo", async () => {
			const res = await fetch(`${BASE}/todos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Buy milk" }),
			});
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.data.title).toBe("Buy milk");
			expect(json.data.completed).toBe(false);
			expect(json.data.id).toBeDefined();
		});

		it("rejects empty title", async () => {
			const res = await fetch(`${BASE}/todos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "" }),
			});
			const json = await res.json();

			expect(res.status).toBe(400);
			expect(json.error).toBe("title is required");
		});

		it("rejects missing title", async () => {
			const res = await fetch(`${BASE}/todos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect((await res.json()).error).toBe("title is required");
		});

		it("rejects invalid JSON", async () => {
			const res = await fetch(`${BASE}/todos`, {
				method: "POST",
				body: "not json",
			});

			expect(res.status).toBe(400);
			expect((await res.json()).error).toBe("invalid JSON body");
		});
	});

	describe("GET /todos/:id", () => {
		it("returns a specific todo", async () => {
			const res = await fetch(`${BASE}/todos/1`);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.data.title).toBe("Buy milk");
		});

		it("returns 404 for missing todo", async () => {
			const res = await fetch(`${BASE}/todos/9999`);

			expect(res.status).toBe(404);
			expect((await res.json()).error).toBe("todo not found");
		});

		it("returns 400 for invalid id", async () => {
			const res = await fetch(`${BASE}/todos/abc`);

			expect(res.status).toBe(400);
			expect((await res.json()).error).toBe("invalid id");
		});
	});

	describe("PATCH /todos/:id", () => {
		it("updates title", async () => {
			const res = await fetch(`${BASE}/todos/1`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Buy oat milk" }),
			});
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.data.title).toBe("Buy oat milk");
		});

		it("updates completed status", async () => {
			const res = await fetch(`${BASE}/todos/1`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ completed: true }),
			});
			const json = await res.json();

			expect(json.data.completed).toBe(true);
		});

		it("returns 404 for missing todo", async () => {
			const res = await fetch(`${BASE}/todos/9999`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "nope" }),
			});

			expect(res.status).toBe(404);
		});

		it("rejects empty title", async () => {
			const res = await fetch(`${BASE}/todos/1`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "   " }),
			});

			expect(res.status).toBe(400);
			expect((await res.json()).error).toBe("title is required");
		});
	});

	describe("DELETE /todos/:id", () => {
		it("deletes a todo", async () => {
			const res = await fetch(`${BASE}/todos/1`, { method: "DELETE" });

			expect(res.status).toBe(204);
		});

		it("returns 404 for already-deleted todo", async () => {
			const res = await fetch(`${BASE}/todos/1`, { method: "DELETE" });

			expect(res.status).toBe(404);
		});
	});

	describe("Full CRUD lifecycle", () => {
		it("create → read → update → delete", async () => {
			// Create
			const created = await (
				await fetch(`${BASE}/todos`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: "Lifecycle test" }),
				})
			).json();
			const id = created.data.id;

			// Read
			const read = await (await fetch(`${BASE}/todos/${id}`)).json();
			expect(read.data.title).toBe("Lifecycle test");

			// Update
			const updated = await (
				await fetch(`${BASE}/todos/${id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ completed: true }),
				})
			).json();
			expect(updated.data.completed).toBe(true);

			// Delete
			const deleted = await fetch(`${BASE}/todos/${id}`, { method: "DELETE" });
			expect(deleted.status).toBe(204);

			// Verify gone
			const gone = await fetch(`${BASE}/todos/${id}`);
			expect(gone.status).toBe(404);
		});
	});

	describe("Response envelope", () => {
		it("success has { data, error: null }", async () => {
			const json = await (await fetch(`${BASE}/todos`)).json();
			expect(json).toHaveProperty("data");
			expect(json).toHaveProperty("error");
			expect(json.error).toBeNull();
		});

		it("error has { data: null, error, meta.status }", async () => {
			const json = await (await fetch(`${BASE}/todos/abc`)).json();
			expect(json.data).toBeNull();
			expect(json.error).toBeDefined();
			expect(json.meta.status).toBeDefined();
		});
	});

	describe("404 for unknown routes", () => {
		it("returns 404 for unknown path", async () => {
			const res = await fetch(`${BASE}/unknown`);
			expect(res.status).toBe(404);
		});
	});
});
