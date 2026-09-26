/**
 * Digest delivery by email through the machine's own `sendmail -t -i`
 * (Postfix, msmtp and friends all provide one), so Maina holds no mail
 * credentials. Core builds the whole message; the process port pipes it.
 * Only the card is sent. Addresses are checked before they reach a header,
 * so a configured value cannot add headers or recipients.
 */

import type { Result } from "../../db/index";
import type { ProcessPort } from "../../ports/process";
import type { DigestMessage } from "./webhook";

export type EmailConfig = Readonly<{
	to: readonly string[];
	/** Sender address; `sendmail` picks the local user when absent. */
	from?: string;
}>;

export type EmailError =
	| Readonly<{ kind: "invalid_address"; address: string }>
	| Readonly<{ kind: "no_recipients" }>
	| Readonly<{ kind: "spawn_failed"; message: string }>
	| Readonly<{ kind: "timeout"; timeoutMs: number }>
	| Readonly<{ kind: "exit"; exitCode: number; detail: string }>;

/**
 * One bare ASCII address: RFC 5322 `atext` and dots before the `@`, a
 * hostname (letters, digits, dots, hyphens; punycode for IDNs) after it.
 * Nothing that could end a header line or add a recipient gets through:
 * no whitespace, control characters, brackets, commas or quotes.
 */
export const EMAIL_ADDRESS =
	/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9.-]+$/;

const SENDMAIL = ["sendmail", "-t", "-i"] as const;
const TIMEOUT_MS = 15_000;

/** The RFC 5322 message for `message`, or why it cannot be built. */
export function buildDigestEmail(
	message: DigestMessage,
	config: EmailConfig,
): Result<string, EmailError> {
	const bad = [
		...config.to,
		...(config.from === undefined ? [] : [config.from]),
	].find((a) => !EMAIL_ADDRESS.test(a));
	if (bad !== undefined) {
		return { ok: false, error: { kind: "invalid_address", address: bad } };
	}
	if (config.to.length === 0) {
		return { ok: false, error: { kind: "no_recipients" } };
	}
	return {
		ok: true,
		value: [
			`To: ${config.to.join(", ")}`,
			...(config.from === undefined ? [] : [`From: ${config.from}`]),
			`Subject: Maina weekly digest ${message.week}`,
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=utf-8",
			"Content-Transfer-Encoding: 8bit",
			"",
			message.card,
			"",
		].join("\n"),
	};
}

/** Pipes the message to `sendmail`. Never rejects. */
export async function deliverEmail(
	message: DigestMessage,
	config: EmailConfig,
	ports: Readonly<{ process: ProcessPort; root: string }>,
): Promise<Result<void, EmailError>> {
	const mail = buildDigestEmail(message, config);
	if (!mail.ok) return mail;
	const run = await ports.process.spawn(SENDMAIL, {
		cwd: ports.root,
		stdin: mail.value,
		timeoutMs: TIMEOUT_MS,
	});
	if (!run.ok) {
		return {
			ok: false,
			error:
				run.error.kind === "timeout"
					? { kind: "timeout", timeoutMs: TIMEOUT_MS }
					: { kind: "spawn_failed", message: run.error.message },
		};
	}
	const { exitCode, stderr } = run.value;
	if (exitCode === 0) return { ok: true, value: undefined };
	const detail = stderr.split("\n", 1)[0]?.trim() ?? "";
	return { ok: false, error: { kind: "exit", exitCode, detail } };
}

/** An email failure in words. */
export function describeEmailError(error: EmailError): string {
	switch (error.kind) {
		case "invalid_address":
			return `not a plain email address: ${JSON.stringify(error.address)}`;
		case "no_recipients":
			return "no recipients";
		case "spawn_failed":
			return `cannot run sendmail: ${error.message}`;
		case "timeout":
			return `sendmail did not finish within ${error.timeoutMs / 1000} s`;
		case "exit":
			return `sendmail exited ${error.exitCode}${error.detail === "" ? "" : `: ${error.detail}`}`;
		default: {
			const unreachable: never = error;
			return unreachable;
		}
	}
}
