/**
 * One ACP session, client side (FR-HAR-1): initialize → session/new →
 * session/prompt → stop, over the SDK's ndjson transport.
 *
 * The client advertises no file-system or terminal capability, so the
 * agent does its own I/O and reports it; every report and permission
 * request is normalised (`./events`) and handed to `emit`. Permission
 * requests go to the policy, whose verdict picks the answer; a policy that
 * fails denies. Aborting `signal` sends `session/cancel` and answers any
 * later permission request `cancelled`; the caller stops the process.
 */

import {
	type ActiveSession,
	client,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionResponse,
	type StopReason,
} from "@agentclientprotocol/sdk";
import type { Result, Verdict } from "@mainahq/core";
import {
	chooseOption,
	type HarnessError,
	type HarnessEvent,
	INITIAL_STATE,
	isVerdict,
	type NormaliseContext,
	type NormaliseState,
	normalisePermission,
	normaliseUpdate,
	type PermissionRequest,
} from "./events";

/** Judges a permission request. `ask` rejects: a run has nobody to ask. */
export type PermissionPolicy = (
	request: PermissionRequest,
) => Verdict | Promise<Verdict>;

type SessionDeps = Readonly<{
	agent: string;
	task: string;
	root: string;
	policy: PermissionPolicy;
	emit: (event: HarnessEvent) => void;
	/** Aborted when the run is cancelled or over budget. */
	signal: AbortSignal;
}>;

type SessionIo = Readonly<{
	input: WritableStream<Uint8Array>;
	output: ReadableStream<Uint8Array>;
}>;

type Settled<T> = Result<T, unknown>;

/** A promise as a Result: the SDK rejects, the harness never throws. */
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
	promise.then(
		(value) => ({ ok: true, value }),
		(error: unknown) => ({ ok: false, error }),
	);

const reason = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The policy's verdict; a policy that throws, rejects or answers junk denies. */
async function judge(
	policy: PermissionPolicy,
	request: PermissionRequest,
): Promise<Verdict> {
	const verdict = await settle(Promise.resolve().then(() => policy(request)));
	// Anything but a known verdict (an untyped policy, a bad cast) denies.
	return verdict.ok && isVerdict(verdict.value) ? verdict.value : "deny";
}

/** Runs one prompt turn to its stop reason, or the error that ended it. */
export async function runSession(
	io: SessionIo,
	deps: SessionDeps,
): Promise<Result<StopReason, HarnessError>> {
	const { signal, emit } = deps;
	let state: NormaliseState = INITIAL_STATE;
	let ctx: NormaliseContext | undefined;

	const app = client({ name: "maina-harness" }).onRequest(
		"session/request_permission",
		async ({ params }): Promise<RequestPermissionResponse> => {
			if (ctx === undefined || signal.aborted) {
				return { outcome: { outcome: "cancelled" } };
			}
			const normalised = normalisePermission(state, params, ctx);
			state = normalised.state;
			const verdict = await judge(deps.policy, normalised.request);
			const optionId = signal.aborted
				? undefined
				: chooseOption(params.options, verdict);
			emit({
				type: "permission",
				request: normalised.request,
				verdict,
				...(optionId === undefined ? {} : { optionId }),
			});
			return optionId === undefined
				? { outcome: { outcome: "cancelled" } }
				: { outcome: { outcome: "selected", optionId } };
		},
	);
	const connection = app.connect(ndJsonStream(io.input, io.output));
	const agent = connection.agent;
	const exited = (error: unknown): HarnessError => ({
		code: "agent_exited",
		message: `agent "${deps.agent}" stopped answering: ${reason(error)}`,
	});

	let session: ActiveSession | undefined;
	let cancel: (() => void) | undefined;
	try {
		const init = await settle(
			agent.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
					terminal: false,
				},
				clientInfo: { name: "maina-harness", version: "0.0.0" },
			}),
		);
		if (!init.ok) {
			return {
				ok: false,
				error: {
					code: "handshake_failed",
					message: `agent "${deps.agent}" failed to initialize: ${reason(init.error)}`,
				},
			};
		}
		if (init.value.protocolVersion !== PROTOCOL_VERSION) {
			return {
				ok: false,
				error: {
					code: "protocol_mismatch",
					message: `agent "${deps.agent}" speaks ACP protocol v${init.value.protocolVersion}; the maina harness supports v${PROTOCOL_VERSION}`,
				},
			};
		}
		if (signal.aborted) return { ok: true, value: "cancelled" };

		const started = await settle(agent.buildSession(deps.root).start());
		if (!started.ok) {
			return {
				ok: false,
				error: {
					code: "handshake_failed",
					message: `agent "${deps.agent}" failed to start a session: ${reason(started.error)}`,
				},
			};
		}
		const active = started.value;
		session = active;
		ctx = {
			host: `acp:${deps.agent}`,
			sessionId: active.sessionId,
			root: deps.root,
		};
		emit({
			type: "session",
			sessionId: active.sessionId,
			agent: deps.agent,
			protocolVersion: init.value.protocolVersion,
		});
		if (signal.aborted) return { ok: true, value: "cancelled" };

		// The turn's outcome, and any rejection, also arrives through
		// `nextUpdate`, so this copy of it is dropped.
		void active.prompt(deps.task).catch(() => undefined);
		cancel = (): void => {
			void agent
				.notify("session/cancel", { sessionId: active.sessionId })
				// A closed connection: the run is ending anyway.
				.catch(() => undefined);
		};
		signal.addEventListener("abort", cancel, { once: true });

		for (;;) {
			const message = await settle(active.nextUpdate());
			if (!message.ok) return { ok: false, error: exited(message.error) };
			if (message.value.kind === "stop") {
				return { ok: true, value: message.value.stopReason };
			}
			const next = normaliseUpdate(state, message.value.update, ctx);
			state = next.state;
			for (const event of next.events) emit(event);
		}
	} finally {
		if (cancel !== undefined) signal.removeEventListener("abort", cancel);
		session?.dispose();
		connection.close();
	}
}
