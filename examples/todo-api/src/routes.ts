import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from "./repo";
import { err, noContent, ok } from "./response";

function parseId(raw: string): number | null {
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
}

async function parseBody(
	req: Request,
): Promise<Record<string, unknown> | null> {
	try {
		return (await req.json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function handleListTodos(): Response {
	return ok(listTodos());
}

export async function handleCreateTodo(req: Request): Promise<Response> {
	const body = await parseBody(req);
	if (!body) return err("invalid JSON body", 400);

	const title = typeof body.title === "string" ? body.title.trim() : "";
	if (!title) return err("title is required", 400);

	return ok(createTodo(title));
}

export function handleGetTodo(id: string): Response {
	const parsed = parseId(id);
	if (parsed === null) return err("invalid id", 400);

	const todo = getTodo(parsed);
	if (!todo) return err("todo not found", 404);

	return ok(todo);
}

export async function handleUpdateTodo(
	id: string,
	req: Request,
): Promise<Response> {
	const parsed = parseId(id);
	if (parsed === null) return err("invalid id", 400);

	const body = await parseBody(req);
	if (!body) return err("invalid JSON body", 400);

	const fields: { title?: string; completed?: boolean } = {};

	if ("title" in body) {
		const title = typeof body.title === "string" ? body.title.trim() : "";
		if (!title) return err("title is required", 400);
		fields.title = title;
	}

	if ("completed" in body) {
		if (typeof body.completed !== "boolean")
			return err("completed must be a boolean", 400);
		fields.completed = body.completed;
	}

	const todo = updateTodo(parsed, fields);
	if (!todo) return err("todo not found", 404);

	return ok(todo);
}

export function handleDeleteTodo(id: string): Response {
	const parsed = parseId(id);
	if (parsed === null) return err("invalid id", 400);

	const deleted = deleteTodo(parsed);
	if (!deleted) return err("todo not found", 404);

	return noContent();
}
