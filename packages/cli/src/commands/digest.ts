/**
 * `maina digest [--week yyyy-ww] [--send] [--card-labels] [--json]`
 * (FR-RET-5, #350): what the gate did this week, from the repository's
 * decision log (`.maina/decisions.db`), as a markdown report plus a short
 * card that is safe to share (numbers and Maina's own labels, no code,
 * paths or repository names).
 *
 * Delivery is off unless configured: only `--send` delivers, and only to
 * the channels the `digest` section of `.maina/config.json` names (an
 * https webhook, or recipients for the local `sendmail`). Only the card
 * leaves the machine.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildDigest,
	type DeliveryReport,
	type DigestDelivery,
	type DigestEvent,
	type DigestSubject,
	decisionLogEvents,
	deliverDigest,
	describeChannelError,
	findGateSubject,
	isoWeek,
	isWeekKey,
	loadConfig,
	type NetworkPort,
	type ProcessPort,
	type Result,
	readLogSlice,
	renderDigest,
	renderDigestCard,
	systemProcess,
	type WeekBounds,
	weekBounds,
} from "@mainahq/core";
import { Command } from "commander";
import { openDecisionDb } from "../decision-store";
import { EXIT_CONFIG_ERROR, EXIT_PASSED, EXIT_TOOL_FAILURE } from "../json";
import { fetchNetwork, nodeFs } from "../ports";
import { recordRetention } from "../retention";

type DigestOptions = Readonly<{
	week?: string;
	send?: boolean;
	json?: boolean;
	/** Also put tool names and deny rules on the card. */
	cardLabels?: boolean;
}>;

export type DigestDeps = Readonly<{
	root: string;
	now: () => number;
	/** The gate events inside `bounds`. */
	readEvents: (bounds: WeekBounds) => Result<readonly DigestEvent[], string>;
	/** The `digest` section of the config; undefined when there is none. */
	loadDelivery: () => Promise<Result<DigestDelivery | undefined, string>>;
	network: NetworkPort;
	process: ProcessPort;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	/**
	 * Notes a digest printed for a human in the local retention history
	 * (FR-RET-7). Never rejects; absent: nothing is noted.
	 */
	seen?: () => Promise<void>;
}>;

const META = { schemaVersion: "v1" } as const;

const OFF_HINT =
	"Delivery is off: add a `digest` section (webhook or email) to .maina/config.json to send the card.\n";

function failed(report: DeliveryReport | null): boolean {
	return report?.kind === "sent" && report.results.some((r) => !r.ok);
}

/** Runs `maina digest`; resolves to the exit code. Never rejects. */
export async function runDigest(
	options: DigestOptions,
	deps: DigestDeps,
): Promise<number> {
	const fail = (code: string, message: string, exit: number): number => {
		if (options.json) {
			deps.stdout(
				`${JSON.stringify({ data: null, error: { code, message }, meta: META }, null, 2)}\n`,
			);
		} else {
			deps.stderr(`maina digest: ${message}\n`);
		}
		return exit;
	};

	const week = options.week ?? isoWeek(deps.now());
	if (!isWeekKey(week)) {
		return fail(
			"invalid_week",
			`invalid week "${week}"; expected yyyy-ww (e.g. ${isoWeek(deps.now())})`,
			EXIT_CONFIG_ERROR,
		);
	}
	const events = deps.readEvents(weekBounds(week));
	if (!events.ok) {
		return fail(
			"decision_log",
			`cannot read the decision log: ${events.error}`,
			EXIT_TOOL_FAILURE,
		);
	}
	const digest = buildDigest(events.value, week);
	const card = renderDigestCard(digest, {
		includeLabels: options.cardLabels === true,
	});

	let delivery: DeliveryReport | null = null;
	if (options.send) {
		const loaded = await deps.loadDelivery();
		if (!loaded.ok) return fail("config", loaded.error, EXIT_CONFIG_ERROR);
		delivery = await deliverDigest({ week, card }, loaded.value, deps);
	}
	const exit = failed(delivery) ? EXIT_TOOL_FAILURE : EXIT_PASSED;

	if (options.json) {
		deps.stdout(
			`${JSON.stringify({ data: { week, digest, card, delivery }, error: null, meta: META }, null, 2)}\n`,
		);
		return exit;
	}
	await deps.seen?.();
	deps.stdout(
		`${renderDigest(digest)}\n---\n\nShareable card${options.cardLabels ? " (with tool names and rules)" : " (no code, paths or repo names)"}:\n\n${card}\n`,
	);
	if (delivery?.kind === "off") deps.stdout(`\n${OFF_HINT}`);
	if (delivery?.kind === "sent") {
		for (const r of delivery.results) {
			if (r.ok) deps.stdout(`\nSent to ${r.channel}.\n`);
			else
				deps.stderr(`maina digest: ${r.channel}: ${describeChannelError(r)}\n`);
		}
	}
	return exit;
}

function describeLogError(error: object): string {
	const kind = "kind" in error ? String(error.kind) : "error";
	return "message" in error ? `${kind}: ${String(error.message)}` : kind;
}

/**
 * The gate events of `mainaDir`'s decision log inside `bounds`. A
 * repository without a log has an empty week; none is created.
 */
export function readDecisionEvents(
	mainaDir: string,
	bounds: WeekBounds,
): Result<readonly DigestEvent[], string> {
	if (!existsSync(join(mainaDir, "decisions.db"))) {
		return { ok: true, value: [] };
	}
	const store = openDecisionDb(mainaDir);
	if (!store.ok) return store;
	const { db, close } = store.value;
	try {
		const slice = readLogSlice(
			{ db },
			{ type: "action.risk", since: bounds.since, until: bounds.until },
		);
		if (!slice.ok) return { ok: false, error: describeLogError(slice.error) };
		const subjects = new Map<string, DigestSubject>();
		for (const { id } of slice.value.decisions) {
			const found = findGateSubject(db, id);
			// A missing or unreadable subject leaves that event "unknown".
			if (found.ok && found.value !== undefined) subjects.set(id, found.value);
		}
		return { ok: true, value: decisionLogEvents(slice.value, subjects) };
	} finally {
		close();
	}
}

export function digestCommand(): Command {
	return new Command("digest")
		.description(
			"Weekly gate digest from the decision log, with a card that is safe to share",
		)
		.option("--week <yyyy-ww>", "ISO week to digest (default: this week)")
		.option(
			"--send",
			"deliver the card to the channels in .maina/config.json `digest` (off unless configured)",
		)
		.option(
			"--card-labels",
			"also put tool names and deny rules on the card (they can name files or repos)",
		)
		.option("--json", "emit a { data, error, meta } envelope")
		.action(async (opts: DigestOptions) => {
			const root = process.cwd();
			process.exitCode = await runDigest(opts, {
				root,
				now: () => Date.now(),
				readEvents: (bounds) =>
					readDecisionEvents(join(root, ".maina"), bounds),
				loadDelivery: async () => {
					const config = await loadConfig({ fs: nodeFs }, root);
					return config.ok
						? { ok: true, value: config.value.digest }
						: {
								ok: false,
								error: config.error
									.map(
										(e) =>
											`${e.file}${e.path ? ` ${e.path}` : ""}: ${e.message}`,
									)
									.join("; "),
							};
				},
				network: fetchNetwork,
				process: systemProcess,
				stdout: (text) => process.stdout.write(text),
				stderr: (text) => process.stderr.write(text),
				seen: () =>
					recordRetention({
						kind: "surface",
						ts: Date.now(),
						surface: "digest",
					}),
			});
		});
}
