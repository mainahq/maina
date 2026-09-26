/**
 * Test fixture: a scripted ACP agent. The orchestrator tests spawn it as a
 * real child process and drive it over stdio, so every run goes through the
 * same SDK transport a real agent (Claude Code, Codex, Gemini CLI) would use.
 *
 * Usage: bun fake-acp-agent.ts '<script json>'
 *
 * The script says what the agent does on each call:
 *
 *   protocolVersion   the version `initialize` answers (default: the SDK's)
 *   steps             played in order on `session/prompt`:
 *                       { update }       a `session/update` notification
 *                       { permission }   a `session/request_permission`;
 *                                        the answer is echoed back as an
 *                                        agent message `permission:<optionId>`
 *                                        (or `permission:cancelled`)
 *                       { hang: true }   wait for `session/cancel`
 *                       { exit: code }   die mid-turn without answering
 *   ignoreCancel      a hanging agent that never answers `session/cancel`,
 *                     so only killing it ends the run
 *   stopReason        what `session/prompt` answers (default `end_turn`)
 */

import {
	agent,
	ndJsonStream,
	type PermissionOption,
	PROTOCOL_VERSION,
	type SessionUpdate,
	type StopReason,
	type ToolCallUpdate,
} from "@agentclientprotocol/sdk";

export type FakeStep =
	| Readonly<{ update: SessionUpdate }>
	| Readonly<{
			permission: Readonly<{
				toolCall: ToolCallUpdate;
				options: readonly PermissionOption[];
			}>;
	  }>
	| Readonly<{ hang: true }>
	| Readonly<{ exit: number }>;

export type FakeScript = Readonly<{
	protocolVersion?: number;
	steps?: readonly FakeStep[];
	ignoreCancel?: boolean;
	stopReason?: StopReason;
}>;

const script: FakeScript = JSON.parse(process.argv[2] ?? "{}");

let cancel: (() => void) | undefined;
const cancelled = (): Promise<void> =>
	new Promise((resolve) => {
		cancel = resolve;
	});

const stdout = Bun.stdout.writer();
const stream = ndJsonStream(
	new WritableStream<Uint8Array>({
		async write(chunk) {
			stdout.write(chunk);
			await stdout.flush();
		},
	}),
	Bun.stdin.stream(),
);

agent({ name: "fake-acp-agent" })
	.onRequest("initialize", () => ({
		protocolVersion: script.protocolVersion ?? PROTOCOL_VERSION,
		agentCapabilities: { loadSession: false },
	}))
	.onRequest("session/new", () => ({ sessionId: "fake-session" }))
	.onNotification("session/cancel", () => {
		if (script.ignoreCancel !== true) cancel?.();
	})
	.onRequest("session/prompt", async ({ params, client }) => {
		const { sessionId } = params;
		for (const step of script.steps ?? []) {
			if ("update" in step) {
				await client.notify("session/update", {
					sessionId,
					update: step.update,
				});
			} else if ("permission" in step) {
				const answer = await client.request("session/request_permission", {
					sessionId,
					toolCall: step.permission.toolCall,
					options: [...step.permission.options],
				});
				const picked =
					answer.outcome.outcome === "selected"
						? answer.outcome.optionId
						: "cancelled";
				await client.notify("session/update", {
					sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: `permission:${picked}` },
					},
				});
			} else if ("hang" in step) {
				await cancelled();
				return { stopReason: "cancelled" as const };
			} else {
				process.exit(step.exit);
			}
		}
		return { stopReason: script.stopReason ?? "end_turn" };
	})
	.connect(stream);
