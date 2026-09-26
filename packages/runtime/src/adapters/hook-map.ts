/**
 * Which native hooks a host registers for each lifecycle point maina hooks
 * (#340). Each host adapter defines its map once, next to the events it
 * answers; the adapter's own hooks config and the generated host plugins
 * (`packages/plugins`) are both built from it. Pure data.
 */

/** A lifecycle point maina hooks, in host-neutral terms. */
export type LifecycleEvent =
	/** A session starts: maina adds its context. */
	| "session.start"
	/** Before a tool runs: the gate decides allow, ask or deny. */
	| "tool.before"
	/** The host is about to prompt for a permission: the gate decides. */
	| "permission.request"
	/** After a file edit: the code graph observes it. */
	| "file.edited"
	/** The agent stops: maina verifies the session's changes. */
	| "session.stop";

/** One native hook registration: a documented event of the host. */
export type NativeHook = Readonly<{
	event: string;
	/** The host's tool matcher, where the host filters by tool. */
	matcher?: string;
}>;

/** A host's native hooks per lifecycle point; none where it has no such hook. */
export type HostHookMap = Readonly<
	Record<LifecycleEvent, readonly NativeHook[]>
>;

/** Every native event in a map, in map order. */
export const nativeEvents = (map: HostHookMap): readonly string[] =>
	Object.values(map).flatMap((hooks) => hooks.map((hook) => hook.event));
