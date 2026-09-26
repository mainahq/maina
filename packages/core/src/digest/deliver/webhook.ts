/**
 * Digest delivery to a webhook: one JSON POST, `{ "text": <card> }`, the
 * shape Slack, Mattermost and most chat incoming webhooks take. Only the
 * card is sent. The URL is treated as a secret (chat webhook URLs carry
 * their token), so no error repeats it.
 */

import type { Result } from "../../db/index";
import type { NetworkPort, NetworkRequest } from "../../ports/network";

export type WebhookConfig = Readonly<{ url: string }>;

/** What a delivery sends: the week and its shareable card. */
export type DigestMessage = Readonly<{ week: string; card: string }>;

export type WebhookError =
	| Readonly<{ kind: "insecure_url" }>
	| Readonly<{ kind: "http"; status: number }>
	| Readonly<{ kind: "timeout"; timeoutMs: number }>
	| Readonly<{ kind: "unreachable" }>;

/** An https URL of printable ASCII: no spaces, controls or look-alikes. */
export const HTTPS_URL = /^https:\/\/[\x21-\x7e]{1,2048}$/;

const TIMEOUT_MS = 10_000;

/** The POST for `message`; refused unless the URL is https. */
export function buildWebhookRequest(
	message: DigestMessage,
	config: WebhookConfig,
): Result<NetworkRequest, WebhookError> {
	if (!HTTPS_URL.test(config.url)) {
		return { ok: false, error: { kind: "insecure_url" } };
	}
	return {
		ok: true,
		value: {
			url: config.url,
			body: JSON.stringify({ text: message.card }),
			headers: { "content-type": "application/json" },
			timeoutMs: TIMEOUT_MS,
		},
	};
}

/** Posts the card. Never rejects. */
export async function deliverWebhook(
	message: DigestMessage,
	config: WebhookConfig,
	network: NetworkPort,
): Promise<Result<void, WebhookError>> {
	const request = buildWebhookRequest(message, config);
	if (!request.ok) return request;
	const sent = await network.post(request.value);
	if (sent.ok) return { ok: true, value: undefined };
	const { error } = sent;
	switch (error.kind) {
		case "http":
			return { ok: false, error: { kind: "http", status: error.status } };
		case "timeout":
			return { ok: false, error: { kind: "timeout", timeoutMs: TIMEOUT_MS } };
		case "network":
			return { ok: false, error: { kind: "unreachable" } };
		default: {
			const unreachable: never = error;
			return unreachable;
		}
	}
}

/** A webhook failure in words, without the URL. */
export function describeWebhookError(error: WebhookError): string {
	switch (error.kind) {
		case "insecure_url":
			return "the webhook URL must be an https:// URL";
		case "http":
			return `webhook answered HTTP ${error.status}`;
		case "timeout":
			return `webhook did not answer within ${error.timeoutMs / 1000} s`;
		case "unreachable":
			return "webhook unreachable";
		default: {
			const unreachable: never = error;
			return unreachable;
		}
	}
}
