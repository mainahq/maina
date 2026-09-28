/**
 * What a device sends over Link, per data class (#589, FR-PRIV-1,
 * FR-PRIV-3), read from the vendored `privacy.json`, which the cloud
 * generates from the same protocol source as the schemas. Nothing here
 * lists a field by hand: `maina cloud privacy` prints this file.
 */

import privacy from "./protocol/v1/privacy.json" with { type: "json" };
import type { DataClass } from "./protocol/wire";

type PrivacyField = Readonly<{
	field: string;
	kind: string;
	required: boolean;
}>;

type FieldsByName = Readonly<Record<string, readonly PrivacyField[]>>;

type Salt = Readonly<{ description: string; fields: readonly string[] }>;

type PrivacyReport = Readonly<{
	dataClass: DataClass;
	/** What the class means, from `privacy.json` `dataClasses`. */
	description: string;
	/** Every field of every protocol message the device sends. */
	messages: FieldsByName;
	/** Every field of every event type the device uplinks. */
	events: FieldsByName;
	/** Which fields are salted hashes, and where each salt lives. */
	salts: Readonly<Record<string, Salt>>;
}>;

const CLASSES = privacy.classes as unknown as Readonly<
	Record<DataClass, Readonly<{ messages: FieldsByName; events: FieldsByName }>>
>;
const DESCRIPTIONS = privacy.dataClasses as Readonly<Record<DataClass, string>>;

const DATA_CLASSES = Object.keys(DESCRIPTIONS) as readonly DataClass[];

export function parseDataClass(value: string): DataClass | null {
	return (DATA_CLASSES as readonly string[]).includes(value)
		? (value as DataClass)
		: null;
}

export function privacyReport(dataClass: DataClass): PrivacyReport {
	return {
		dataClass,
		description: DESCRIPTIONS[dataClass],
		messages: CLASSES[dataClass].messages,
		events: CLASSES[dataClass].events,
		salts: privacy.salts,
	};
}

function table(
	group: "message" | "event",
	byName: FieldsByName,
): readonly string[] {
	const lines: string[] = [];
	for (const [name, fields] of Object.entries(byName)) {
		lines.push(`  ${group} ${name}`);
		const width = Math.max(...fields.map((f) => f.field.length));
		const kindWidth = Math.max(...fields.map((f) => f.kind.length));
		for (const f of fields) {
			lines.push(
				`    ${f.field.padEnd(width)}  ${f.kind.padEnd(kindWidth)}  ${f.required ? "required" : "optional"}`,
			);
		}
	}
	return lines;
}

/** The report as text: one heading per message or event, one line per field. */
export function renderPrivacy(report: PrivacyReport): string {
	const salts = Object.entries(report.salts).map(
		([name, salt]) => `  ${name} salt: ${salt.description}`,
	);
	return `${[
		`Data class: ${report.dataClass}. ${report.description}`,
		"",
		"Protocol messages this device sends:",
		...table("message", report.messages),
		"",
		"Events this device uplinks:",
		...table("event", report.events),
		"",
		"Salted hashes:",
		...salts,
	].join("\n")}\n`;
}
