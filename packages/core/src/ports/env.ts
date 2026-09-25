/** Read-only environment lookup; replaces direct `process.env` access. */
export type EnvPort = Readonly<{
	get: (name: string) => string | undefined;
}>;

/**
 * An `EnvPort` over a plain variable map. Lookups go to the map on every
 * call, so an edge that passes its live process environment keeps seeing
 * later changes. Core never builds one from `process.env` itself.
 */
export function envFromRecord(
	vars: Readonly<Record<string, string | undefined>>,
): EnvPort {
	return {
		get: (name) => (Object.hasOwn(vars, name) ? vars[name] : undefined),
	};
}
