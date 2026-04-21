/**
 * E2E fixture — minimal TypeScript entrypoint that `maina setup` can
 * detect as a TypeScript project via `package.json` + `*.ts` files.
 */
export function add(a: number, b: number): number {
	return a + b;
}

export interface Greeting {
	message: string;
}

export const DEFAULT_GREETING: Greeting = { message: "hello" };
