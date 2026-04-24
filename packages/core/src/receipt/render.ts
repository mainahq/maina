/**
 * Static HTML renderer for receipts. Zero runtime JS by design — suitable
 * for GitHub Pages hosting from `.maina/receipts/{hash}/index.html`.
 *
 * Copy discipline (C2): "passed N of M checks", never "0 findings".
 */

import type { Check, Receipt } from "./types";

export function renderReceiptHtml(receipt: Receipt): string {
	const passedCount = receipt.checks.filter(
		(c) => c.status === "passed",
	).length;
	const total = receipt.checks.length;
	const statusLabel = escapeHtml(summarizeStatus(receipt, passedCount, total));
	const retryBadge = renderRetryBadge(receipt.retries);
	const shortHash = escapeHtml(receipt.hash.slice(0, 12));
	const additions = numStr(receipt.diff.additions);
	const deletions = numStr(receipt.diff.deletions);
	const files = numStr(receipt.diff.files);
	const retries = numStr(receipt.retries);
	const passedStr = numStr(passedCount);
	const totalStr = numStr(total);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${shortHash} — ${escapeHtml(receipt.prTitle)}</title>
<meta name="description" content="Maina proof-of-correctness receipt for ${escapeHtml(receipt.repo)}.">
<style>
:root { color-scheme: light dark; }
body { font: 15px/1.55 system-ui, -apple-system, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1.25rem; }
h1 { font-size: 1.4rem; margin: 0 0 0.35rem 0; }
h2 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem 0; }
.meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; opacity: 0.7; }
.status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-weight: 600; font-size: 0.85rem; margin-right: 0.5rem; }
.status-passed { background: oklch(0.92 0.1 145); color: oklch(0.25 0.15 145); }
.status-failed { background: oklch(0.92 0.1 25); color: oklch(0.25 0.15 25); }
.status-partial { background: oklch(0.92 0.08 90); color: oklch(0.3 0.15 90); }
.retry-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.78rem; background: oklch(0.9 0.05 50); color: oklch(0.3 0.15 50); }
.check { margin: 0.5rem 0; padding: 0.5rem 0.8rem; border-left: 3px solid oklch(0.85 0.02 260); background: rgba(127,127,127,0.05); border-radius: 4px; }
.check-passed { border-color: oklch(0.65 0.15 145); }
.check-failed { border-color: oklch(0.65 0.15 25); }
.check-skipped { border-color: oklch(0.75 0.02 260); opacity: 0.75; }
.check-name { font-weight: 600; }
.check-tool { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; opacity: 0.65; margin-left: 0.5rem; }
.finding { margin: 0.35rem 0 0.35rem 1rem; font-size: 0.88rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.severity { text-transform: uppercase; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.04em; padding: 0 0.35rem; border-radius: 3px; margin-right: 0.4rem; }
.severity-error { background: oklch(0.92 0.1 25); color: oklch(0.3 0.15 25); }
.severity-warning { background: oklch(0.92 0.08 90); color: oklch(0.3 0.15 90); }
.severity-info { background: oklch(0.9 0.03 260); color: oklch(0.35 0.04 260); }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0 1rem 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
.kv dt { opacity: 0.7; }
.hash { word-break: break-all; }
.walkthrough { padding: 0.8rem 1rem; background: rgba(127,127,127,0.06); border-radius: 4px; margin: 1rem 0; font-size: 0.96rem; }
footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid rgba(127,127,127,0.2); font-size: 0.82rem; opacity: 0.7; }
a { color: oklch(0.55 0.2 250); }
@media (prefers-color-scheme: dark) {
  a { color: oklch(0.75 0.15 250); }
}
</style>
</head>
<body>
<h1>${escapeHtml(receipt.prTitle)}</h1>
<p class="meta">${escapeHtml(receipt.repo)} · ${escapeHtml(receipt.timestamp)}</p>

<p>
  <span class="status status-${receiptStatusClass(receipt.status)}">${statusLabel}</span>
  ${retryBadge}
</p>

<p class="walkthrough">${escapeHtml(receipt.walkthrough)}</p>

<h2>Receipt identity</h2>
<dl class="kv">
  <dt>hash</dt><dd class="hash">${escapeHtml(receipt.hash)}</dd>
  <dt>agent</dt><dd>${escapeHtml(receipt.agent.id)} · ${escapeHtml(receipt.agent.modelVersion)}</dd>
  <dt>constitution</dt><dd class="hash">${escapeHtml(receipt.promptVersion.constitutionHash.slice(0, 12))}…</dd>
  <dt>prompts</dt><dd class="hash">${escapeHtml(receipt.promptVersion.promptsHash.slice(0, 12))}…</dd>
  <dt>diff</dt><dd>+${additions} / −${deletions} across ${files} file(s)</dd>
  <dt>retries</dt><dd>${retries}</dd>
</dl>

<h2>Checks (${passedStr} of ${totalStr} passed)</h2>
${receipt.checks.map(renderCheck).join("\n")}

<footer>
Verified with Maina. Receipt format: v1 (<a href="https://schemas.mainahq.com/v1.json">schemas.mainahq.com/v1.json</a>).
Verify this receipt offline with <code>maina verify-receipt ./receipt.json</code>.
</footer>
</body>
</html>`;
}

function renderCheck(check: Check): string {
	const findings = check.findings
		.map(
			(f) =>
				`  <div class="finding"><span class="severity severity-${severityClass(f.severity)}">${escapeHtml(f.severity)}</span>${escapeHtml(f.file)}${f.line !== undefined ? `:${numStr(f.line)}` : ""} — ${escapeHtml(f.message)}</div>`,
		)
		.join("\n");
	return `<div class="check check-${checkStatusClass(check.status)}">
  <span class="check-name">${escapeHtml(check.name)}</span>
  <span class="check-tool">${escapeHtml(check.tool)} · ${escapeHtml(check.status)}</span>
${findings}
</div>`;
}

/** CSS class allow-list — receipts shouldn't normally contain unknown tokens, but
 * an attacker who manages to feed a tampered receipt into this renderer can't
 * use status fields to inject HTML attributes. */
function receiptStatusClass(s: string): "passed" | "failed" | "partial" {
	return s === "passed" || s === "failed" || s === "partial"
		? (s as "passed" | "failed" | "partial")
		: "failed";
}

function checkStatusClass(s: string): "passed" | "failed" | "skipped" {
	return s === "passed" || s === "failed" || s === "skipped"
		? (s as "passed" | "failed" | "skipped")
		: "failed";
}

function severityClass(s: string): "info" | "warning" | "error" {
	return s === "info" || s === "warning" || s === "error"
		? (s as "info" | "warning" | "error")
		: "error";
}

function summarizeStatus(
	receipt: Receipt,
	passed: number,
	total: number,
): string {
	if (receipt.status === "passed") {
		return total === 0
			? "verified — no checks ran"
			: `passed ${passed} of ${total} checks`;
	}
	if (receipt.status === "partial") {
		if (receipt.retries >= 3) {
			return `partial — retry cap reached (${receipt.retries} retries)`;
		}
		return total === 0
			? "partial — no checks rendered, see logs"
			: `partial — ${passed} of ${total} checks held`;
	}
	// failed
	return total === 0
		? "failed — no checks rendered, see logs"
		: `failed — ${passed} of ${total} checks held`;
}

function renderRetryBadge(retries: number): string {
	if (retries === 0) return "";
	const n = numStr(retries);
	const label =
		retries >= 3
			? `retried ${n} times · capped`
			: `retried ${n} time${retries === 1 ? "" : "s"}`;
	return `<span class="retry-badge">${escapeHtml(label)}</span>`;
}

/** Numbers can in theory arrive as strings if a tampered JSON skips schema
 * validation. Coerce + escape so the renderer never trusts the JS type alone. */
function numStr(n: number): string {
	if (typeof n !== "number" || !Number.isFinite(n)) return "0";
	return escapeHtml(String(Math.trunc(n)));
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
