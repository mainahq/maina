/**
 * The repo brain (FR-FAC-5): one shared per-repo memory of build quirks and
 * recurring findings, kept in `.maina/brain.json`. Every write passes
 * `gateBrainWrite` first, so an unattended run can read it but never
 * change it. I/O goes through the injected ports.
 */

import { join } from "node:path";
import { z } from "zod";
import { hashArtifact } from "../artifacts/ref";
import type { Result } from "../db/index";
import type { ClockPort } from "../ports/clock";
import type { FsPort } from "../ports/fs";
import {
	type BrainGateInput,
	type BrainGateVerdict,
	gateBrainWrite,
} from "./gate";

const BRAIN_KINDS = ["quirk", "finding"] as const;
export type BrainKind = (typeof BRAIN_KINDS)[number];

const BrainEntrySchema = z.strictObject({
	id: z.string(),
	kind: z.enum(BRAIN_KINDS),
	text: z.string(),
	runId: z.string(),
	approvedBy: z.enum(["human", "decide"]),
	createdAt: z.string(),
});

export type BrainEntry = Readonly<z.infer<typeof BrainEntrySchema>>;

const BrainFileSchema = z.strictObject({
	version: z.literal(1),
	entries: z.array(BrainEntrySchema),
});

export type BrainDraft = Readonly<{ kind: BrainKind; text: string }>;

export type BrainWriteContext = BrainGateInput & Readonly<{ runId: string }>;

export type BrainError =
	| Readonly<{
			kind: "denied";
			gate: Exclude<BrainGateVerdict, { verdict: "allow" }>;
	  }>
	| Readonly<{ kind: "invalid_entry"; message: string }>
	| Readonly<{ kind: "corrupt"; path: string; message: string }>
	| Readonly<{ kind: "io"; path: string; message: string }>;

export function brainPath(root: string): string {
	return join(root, ".maina", "brain.json");
}

function parseBrain(
	path: string,
	text: string,
): Result<readonly BrainEntry[], BrainError> {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		return {
			ok: false,
			error: {
				kind: "corrupt",
				path,
				message: e instanceof Error ? e.message : String(e),
			},
		};
	}
	const parsed = BrainFileSchema.safeParse(json);
	return parsed.success
		? { ok: true, value: parsed.data.entries }
		: {
				ok: false,
				error: { kind: "corrupt", path, message: parsed.error.message },
			};
}

/** Every entry, oldest first. A repo without a brain has an empty one. */
export async function readBrain(
	fs: FsPort,
	root: string,
): Promise<Result<readonly BrainEntry[], BrainError>> {
	const path = brainPath(root);
	const read = await fs.readFile(path);
	if (!read.ok) {
		return read.error.kind === "not_found"
			? { ok: true, value: [] }
			: { ok: false, error: { kind: "io", path, message: read.error.message } };
	}
	return parseBrain(path, read.value);
}

/**
 * Adds `draft` to the brain when the gate allows it. The same kind and text
 * is stored once: writing it again returns the entry already there.
 */
export async function writeBrain(
	ports: Readonly<{ fs: FsPort; clock: ClockPort }>,
	root: string,
	draft: BrainDraft,
	context: BrainWriteContext,
): Promise<Result<BrainEntry, BrainError>> {
	const gate = gateBrainWrite(context);
	if (gate.verdict !== "allow")
		return { ok: false, error: { kind: "denied", gate } };
	const text = draft.text.trim();
	if (text === "") {
		return {
			ok: false,
			error: { kind: "invalid_entry", message: "text is blank" },
		};
	}
	const existing = await readBrain(ports.fs, root);
	if (!existing.ok) return existing;
	const id = hashArtifact(`${draft.kind}\n${text}`).slice(
		"sha256:".length,
		"sha256:".length + 16,
	);
	const already = existing.value.find((entry) => entry.id === id);
	if (already !== undefined) return { ok: true, value: already };

	const entry: BrainEntry = {
		id,
		kind: draft.kind,
		text,
		runId: context.runId,
		approvedBy: gate.by,
		createdAt: new Date(ports.clock.now()).toISOString(),
	};
	const path = brainPath(root);
	const file = { version: 1, entries: [...existing.value, entry] };
	const written = await ports.fs.writeFile(
		path,
		`${JSON.stringify(file, null, "\t")}\n`,
	);
	if (!written.ok) {
		const message =
			written.error.kind === "io" ? written.error.message : "write failed";
		return { ok: false, error: { kind: "io", path, message } };
	}
	return { ok: true, value: entry };
}
