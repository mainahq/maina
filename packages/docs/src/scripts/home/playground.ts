/**
 * Try-the-gate wiring (#360): presets, the try-your-own lookup and the
 * ledger tape. Every verdict shown is a row the build computed with the
 * real engine; this file only puts rows on screen.
 */

import type { CorpusRow, GateRow, Verdict } from "../../data/landing-proofs";
import { lookupCommand } from "./gate";
import { motionAllowed, track } from "./ui";

type Copy = Readonly<{
	rules: Readonly<{ noRule: string }>;
	model: Readonly<{ skipped: string; answered: string }>;
	why: Readonly<Record<Verdict, string>>;
	own: Readonly<{ loading: string; notFound: string }>;
}>;

type GateData = Readonly<{
	presets: readonly GateRow[];
	ledger: readonly GateRow[];
	backend: string;
	corpusUrl: string;
	copy: Copy;
}>;

/** What a step shows: a full row, or a corpus row, or nothing found. */
type Shown =
	| Readonly<{ kind: "row"; row: GateRow }>
	| Readonly<{ kind: "corpus"; row: CorpusRow; command: string }>
	| Readonly<{ kind: "none"; command: string }>;

const VERDICTS: readonly Verdict[] = ["allow", "ask", "deny"];
const TAPE_MAX = 12;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function byId<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function clock(): string {
	const d = new Date();
	return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function initPlayground(): void {
	const dataEl = byId("gate-data");
	if (!dataEl?.textContent) return;
	const data = JSON.parse(dataEl.textContent) as GateData;
	const { copy } = data;

	// ── Ledger tape ──────────────────────────────────────────────────────
	const tape = byId("tape");
	const tapeCount = byId("tape-count");
	let count = 0;
	const printLine = (
		agent: string,
		label: string,
		verdict: Verdict,
		meta: string,
		animate: boolean,
	) => {
		if (!tape) return;
		const line = document.createElement("div");
		line.className = animate ? "tline new" : "tline";
		const c = document.createElement("span");
		c.className = "c";
		c.textContent = `${agent} › ${label}`;
		const v = document.createElement("span");
		v.className = "v";
		v.textContent = verdict.toUpperCase();
		v.style.color = `var(--color-${verdict}-dk)`;
		const m = document.createElement("span");
		m.className = "m tnum";
		m.textContent = `${clock()} · ${meta}`;
		line.append(c, v, m);
		tape.appendChild(line);
		while (tape.children.length > TAPE_MAX) tape.firstElementChild?.remove();
		count++;
		if (tapeCount) {
			tapeCount.textContent = `${count} decision${count === 1 ? "" : "s"}`;
		}
	};
	const rowMeta = (row: GateRow): string =>
		`${row.backend} · ${row.classes.filter((k) => k !== "shell.exec").join(", ") || "no class"} · ${row.id}`;
	for (const row of data.ledger.slice(0, 7)) {
		printLine(row.agent, row.label, row.verdict, rowMeta(row), false);
	}
	let tapeVisible = false;
	let next = 7;
	if (tape) {
		new IntersectionObserver((entries) => {
			for (const e of entries) tapeVisible = e.isIntersecting;
		}).observe(tape);
	}
	window.setInterval(() => {
		if (!tapeVisible || document.hidden || !motionAllowed()) return;
		const row = data.ledger[next++ % data.ledger.length];
		if (row) printLine(row.agent, row.label, row.verdict, rowMeta(row), true);
	}, 2600);

	// ── Pipeline ─────────────────────────────────────────────────────────
	const o1 = byId("o1");
	const o2 = byId("o2");
	const o3 = byId("o3");
	const verdictEl = byId("verdict");
	const steps = ["s1", "s2", "s3"].map((id) => byId(id));

	const setBars = (dist: readonly { answer: Verdict; p: number }[] | null) => {
		for (const answer of VERDICTS) {
			const p = dist?.find((d) => d.answer === answer)?.p;
			const bar = byId(`b-${answer}`);
			const label = byId(`p-${answer}`);
			if (bar)
				bar.style.width = p === undefined ? "0%" : `${Math.round(p * 100)}%`;
			if (label) label.textContent = p === undefined ? "–" : p.toFixed(2);
		}
	};

	const fill = (shown: Shown) => {
		if (!o1 || !o2 || !o3 || !verdictEl) return;
		if (shown.kind === "none") {
			o1.textContent = copy.own.notFound;
			o2.textContent = "–";
			setBars(null);
			verdictEl.className = "stamp big-stamp v-none";
			verdictEl.textContent = "?";
			o3.textContent = shown.command;
			return;
		}
		const verdict = shown.kind === "row" ? shown.row.verdict : shown.row.v;
		const classes = shown.kind === "row" ? shown.row.classes : shown.row.k;
		const reason = shown.kind === "row" ? shown.row.reason : shown.row.r;
		const ruled = !reason.startsWith("no rule matched");
		o1.textContent = ruled
			? `${reason} · ${classes.join(", ")}`
			: copy.rules.noRule;
		o2.textContent = ruled
			? copy.model.skipped
			: `${copy.model.answered}${data.backend}`;
		// A corpus row carries no distribution; the rules backend is certain,
		// so under it the verdict is the whole distribution.
		setBars(
			shown.kind === "row"
				? shown.row.distribution
				: data.backend === "rules"
					? VERDICTS.map((answer) => ({
							answer,
							p: answer === verdict ? 1 : 0,
						}))
					: null,
		);
		verdictEl.className = `stamp big-stamp v-${verdict}`;
		verdictEl.textContent = cap(verdict);
		o3.textContent = copy.why[verdict];
	};

	const show = (shown: Shown, pressedId: string | null) => {
		for (const b of document.querySelectorAll<HTMLButtonElement>(
			".act[data-id]",
		)) {
			b.setAttribute("aria-pressed", String(b.dataset.id === pressedId));
		}
		const animate = motionAllowed();
		if (!animate) {
			fill(shown);
		} else {
			for (const s of steps) s?.classList.add("dim");
			window.setTimeout(() => steps[0]?.classList.remove("dim"), 60);
			window.setTimeout(() => steps[1]?.classList.remove("dim"), 360);
			window.setTimeout(() => {
				steps[2]?.classList.remove("dim");
				verdictEl?.classList.remove("pop");
				fill(shown);
				// Restart the stamp animation.
				void verdictEl?.offsetWidth;
				verdictEl?.classList.add("pop");
			}, 700);
		}
		if (shown.kind === "row") {
			printLine(
				shown.row.agent,
				shown.row.label,
				shown.row.verdict,
				rowMeta(shown.row),
				animate,
			);
		} else if (shown.kind === "corpus") {
			const meta = `${data.backend} · ${shown.row.k.filter((k) => k !== "shell.exec").join(", ") || "no class"} · corpus`;
			printLine("you", shown.command, shown.row.v, meta, animate);
		}
	};

	for (const b of document.querySelectorAll<HTMLButtonElement>(
		".act[data-id]",
	)) {
		b.addEventListener("click", () => {
			const row = data.presets.find((p) => p.id === b.dataset.id);
			if (!row) return;
			track("gate_try", { id: row.id });
			show({ kind: "row", row }, row.id);
		});
	}

	// ── Try your own ─────────────────────────────────────────────────────
	let corpus: Promise<readonly CorpusRow[]> | null = null;
	const loadCorpus = (): Promise<readonly CorpusRow[]> => {
		corpus ??= fetch(data.corpusUrl)
			.then((r) => (r.ok ? (r.json() as Promise<readonly CorpusRow[]>) : []))
			.catch(() => []);
		return corpus;
	};
	const input = byId<HTMLInputElement>("own-cmd");
	input?.addEventListener("focus", () => void loadCorpus(), { once: true });
	byId<HTMLFormElement>("own")?.addEventListener("submit", (ev) => {
		ev.preventDefault();
		const command = input?.value.trim() ?? "";
		if (!command) {
			input?.focus();
			return;
		}
		track("gate_own");
		if (o1) o1.textContent = copy.own.loading;
		void loadCorpus().then((rows) => {
			const row = lookupCommand(rows, command);
			show(
				row ? { kind: "corpus", row, command } : { kind: "none", command },
				null,
			);
		});
	});
}
