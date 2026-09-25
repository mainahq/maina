/** Read-only environment lookup; replaces direct `process.env` access. */
export type EnvPort = Readonly<{
	get: (name: string) => string | undefined;
}>;
