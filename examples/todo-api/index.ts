import { err } from "./src/response";
import {
	handleCreateTodo,
	handleDeleteTodo,
	handleGetTodo,
	handleListTodos,
	handleUpdateTodo,
} from "./src/routes";

const port = Number(process.env.PORT) || 3000;

const server = Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		// GET /todos
		if (path === "/todos" && req.method === "GET") {
			return handleListTodos();
		}

		// POST /todos
		if (path === "/todos" && req.method === "POST") {
			return handleCreateTodo(req);
		}

		// /todos/:id routes
		const match = path.match(/^\/todos\/([^/]+)$/);
		if (match) {
			const id = match[1];
			if (req.method === "GET") return handleGetTodo(id);
			if (req.method === "PATCH") return handleUpdateTodo(id, req);
			if (req.method === "DELETE") return handleDeleteTodo(id);
		}

		return err("not found", 404);
	},
});

export { server };
