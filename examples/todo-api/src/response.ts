export interface ApiResponse<T = unknown> {
	data: T | null;
	error: string | null;
	meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): Response {
	const body: ApiResponse<T> = { data, error: null, ...(meta && { meta }) };
	return Response.json(body);
}

export function err(error: string, status: number): Response {
	const body: ApiResponse = { data: null, error, meta: { status } };
	return Response.json(body, { status });
}

export function noContent(): Response {
	return new Response(null, { status: 204 });
}
