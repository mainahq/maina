/**
 * Digest delivery (FR-RET-5): off unless configured. With no `digest`
 * section in `.maina/config.json`, or one that names no webhook and no
 * recipient, nothing is sent and no port is touched. Each configured
 * channel is tried once and reports on its own; only the card is sent.
 */

import type { NetworkPort } from "../../ports/network";
import type { ProcessPort } from "../../ports/process";
import {
	deliverEmail,
	describeEmailError,
	type EmailConfig,
	type EmailError,
} from "./email";
import {
	type DigestMessage,
	deliverWebhook,
	describeWebhookError,
	type WebhookConfig,
	type WebhookError,
} from "./webhook";

export type DigestDelivery = Readonly<{
	webhook?: WebhookConfig;
	email?: EmailConfig;
}>;

export type ChannelResult =
	| Readonly<{ channel: "webhook" | "email"; ok: true }>
	| Readonly<{ channel: "webhook"; ok: false; error: WebhookError }>
	| Readonly<{ channel: "email"; ok: false; error: EmailError }>;

export type DeliveryReport =
	| Readonly<{ kind: "off" }>
	| Readonly<{ kind: "sent"; results: readonly ChannelResult[] }>;

type DeliveryPorts = Readonly<{
	network: NetworkPort;
	process: ProcessPort;
	/** Working directory for `sendmail`. */
	root: string;
}>;

/** Sends `message` to every configured channel; `off` when there is none. */
export async function deliverDigest(
	message: DigestMessage,
	delivery: DigestDelivery | undefined,
	ports: DeliveryPorts,
): Promise<DeliveryReport> {
	const webhook = delivery?.webhook;
	const email =
		delivery?.email !== undefined && delivery.email.to.length > 0
			? delivery.email
			: undefined;
	if (webhook === undefined && email === undefined) return { kind: "off" };
	const results: ChannelResult[] = [];
	if (webhook !== undefined) {
		const sent = await deliverWebhook(message, webhook, ports.network);
		results.push(
			sent.ok
				? { channel: "webhook", ok: true }
				: { channel: "webhook", ok: false, error: sent.error },
		);
	}
	if (email !== undefined) {
		const sent = await deliverEmail(message, email, ports);
		results.push(
			sent.ok
				? { channel: "email", ok: true }
				: { channel: "email", ok: false, error: sent.error },
		);
	}
	return { kind: "sent", results };
}

/** A failed channel's error in words (never the webhook URL). */
export function describeChannelError(
	result: Extract<ChannelResult, { ok: false }>,
): string {
	return result.channel === "webhook"
		? describeWebhookError(result.error)
		: describeEmailError(result.error);
}
