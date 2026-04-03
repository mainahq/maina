import { getDb } from "./db";

export interface Todo {
	id: number;
	title: string;
	completed: boolean;
	created_at: string;
}

interface TodoRow {
	id: number;
	title: string;
	completed: number;
	created_at: string;
}

function toTodo(row: TodoRow): Todo {
	return { ...row, completed: row.completed === 1 };
}

export function listTodos(): Todo[] {
	const rows = getDb()
		.query("SELECT * FROM todos ORDER BY id")
		.all() as TodoRow[];
	return rows.map(toTodo);
}

export function getTodo(id: number): Todo | null {
	const row = getDb()
		.query("SELECT * FROM todos WHERE id = ?")
		.get(id) as TodoRow | null;
	return row ? toTodo(row) : null;
}

export function createTodo(title: string): Todo {
	const result = getDb()
		.query("INSERT INTO todos (title) VALUES (?) RETURNING *")
		.get(title) as TodoRow;
	return toTodo(result);
}

export function updateTodo(
	id: number,
	fields: { title?: string; completed?: boolean },
): Todo | null {
	const existing = getTodo(id);
	if (!existing) return null;

	const title = fields.title ?? existing.title;
	const completed =
		fields.completed !== undefined
			? fields.completed
				? 1
				: 0
			: existing.completed
				? 1
				: 0;

	const row = getDb()
		.query("UPDATE todos SET title = ?, completed = ? WHERE id = ? RETURNING *")
		.get(title, completed, id) as TodoRow;
	return toTodo(row);
}

export function deleteTodo(id: number): boolean {
	const existing = getTodo(id);
	if (!existing) return false;
	getDb().run("DELETE FROM todos WHERE id = ?", [id]);
	return true;
}
