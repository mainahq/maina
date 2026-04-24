import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { verifyReceipt } from "@mainahq/core";
import { Command } from "commander";
import {
	EXIT_CONFIG_ERROR,
	EXIT_FINDINGS,
	EXIT_PASSED,
	outputJson,
} from "../json";

export interface VerifyReceiptOptions {
	json?: boolean;
	cwd?: string;
}

export interface VerifyReceiptResult {
	ok: boolean;
	code?: string;
	message?: string;
	passedCount?: number;
	totalCount?: number;
	status?: string;
}

export function verifyReceiptAction(
	path: string,
	options: VerifyReceiptOptions = {},
): VerifyReceiptResult {
	const cwd = options.cwd ?? process.cwd();
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);

	let raw: unknown;
	try {
		const text = readFileSync(absolute, "utf-8");
		raw = JSON.parse(text);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			code: "io",
			message: `Failed to read or parse ${absolute}: ${message}`,
		};
	}

	const result = verifyReceipt(raw);
	if (!result.ok) {
		return { ok: false, code: result.code, message: result.message };
	}
	const passed = result.data.checks.filter((c) => c.status === "passed").length;
	return {
		ok: true,
		passedCount: passed,
		totalCount: result.data.checks.length,
		status: result.data.status,
	};
}

export function verifyReceiptCommand(): Command {
	return new Command("verify-receipt")
		.description(
			"Verify a Maina receipt JSON file against the v1 schema + canonical hash",
		)
		.argument("<path>", "path to a receipt JSON file")
		.option("--json", "emit structured JSON envelope instead of human output")
		.action((path: string, opts: VerifyReceiptOptions) => {
			const result = verifyReceiptAction(path, opts);
			const exitCode = result.ok
				? EXIT_PASSED
				: result.code === "io"
					? EXIT_CONFIG_ERROR
					: EXIT_FINDINGS;

			if (opts.json) {
				outputJson(formatJsonEnvelope(result), exitCode);
				return;
			}
			if (result.ok) {
				process.stdout.write(
					`Receipt verified — passed ${result.passedCount} of ${result.totalCount} checks (${result.status}).\n`,
				);
			} else {
				process.stderr.write(
					`Receipt verification failed [${result.code}]: ${result.message}\n`,
				);
			}
			process.exitCode = exitCode;
		});
}

function formatJsonEnvelope(result: VerifyReceiptResult): unknown {
	if (result.ok) {
		return {
			data: {
				verified: true,
				passed: result.passedCount,
				total: result.totalCount,
				status: result.status,
			},
			error: null,
			meta: { schemaVersion: "v1" },
		};
	}
	return {
		data: null,
		error: { code: result.code, message: result.message },
		meta: { schemaVersion: "v1" },
	};
}
