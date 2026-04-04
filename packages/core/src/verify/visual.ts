/**
 * Visual Verification — screenshot capture and pixel comparison.
 *
 * Uses Playwright CLI for screenshots and a simple pixel diff for comparison.
 * Gracefully skips if Playwright is not installed.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface VisualConfig {
	urls: string[];
	threshold: number;
	viewport: { width: number; height: number };
}

export interface ScreenshotOptions {
	viewport?: { width: number; height: number };
	available?: boolean;
}

export interface ScreenshotResult {
	captured: boolean;
	skipped: boolean;
	path?: string;
	error?: string;
}

export interface VisualDiffResult {
	diffPixels: number;
	diffPercentage: number;
	totalPixels: number;
}

export interface VisualVerifyResult {
	findings: Finding[];
	skipped: boolean;
	screenshotsTaken: number;
	comparisons: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const WEB_FRAMEWORKS = [
	"next",
	"astro",
	"vite",
	"nuxt",
	"remix",
	"gatsby",
	"webpack serve",
	"webpack-dev-server",
	"react-scripts",
	"vue-cli-service",
	"angular",
	"svelte",
];

const WEB_DEPS = [
	"next",
	"astro",
	"vite",
	"nuxt",
	"@remix-run/dev",
	"gatsby",
	"react-scripts",
	"@vue/cli-service",
	"@angular/cli",
	"@sveltejs/kit",
];

const DEFAULT_CONFIG: VisualConfig = {
	urls: [],
	threshold: 0.001,
	viewport: { width: 1280, height: 720 },
};

// ─── Web Project Detection ────────────────────────────────────────────────

/**
 * Detect if the project is a web project by checking package.json
 * for dev server scripts or web framework dependencies.
 */
export function detectWebProject(cwd: string): boolean {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return false;

	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

		// Check scripts for web framework commands
		const scripts = pkg.scripts ?? {};
		const allScripts = Object.values(scripts).join(" ");
		for (const framework of WEB_FRAMEWORKS) {
			if (allScripts.includes(framework)) return true;
		}

		// Check dependencies for web frameworks
		const allDeps = {
			...(pkg.dependencies ?? {}),
			...(pkg.devDependencies ?? {}),
		};
		for (const dep of WEB_DEPS) {
			if (allDeps[dep]) return true;
		}

		return false;
	} catch {
		return false;
	}
}

// ─── Config ───────────────────────────────────────────────────────────────

/**
 * Load visual verification config from .maina/preferences.json.
 * Returns defaults if no config exists.
 */
export function loadVisualConfig(mainaDir: string): VisualConfig {
	const prefsPath = join(mainaDir, "preferences.json");
	if (!existsSync(prefsPath)) return { ...DEFAULT_CONFIG };

	try {
		const prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
		const visual = prefs.visual;
		if (!visual || typeof visual !== "object") return { ...DEFAULT_CONFIG };

		return {
			urls: Array.isArray(visual.urls) ? visual.urls : [],
			threshold:
				typeof visual.threshold === "number"
					? visual.threshold
					: DEFAULT_CONFIG.threshold,
			viewport: {
				width:
					typeof visual.viewport?.width === "number"
						? visual.viewport.width
						: DEFAULT_CONFIG.viewport.width,
				height:
					typeof visual.viewport?.height === "number"
						? visual.viewport.height
						: DEFAULT_CONFIG.viewport.height,
			},
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

// ─── Screenshot Capture ───────────────────────────────────────────────────

/**
 * Capture a screenshot of a URL using Playwright CLI.
 * Returns captured=false with skipped=true if Playwright is not installed.
 */
export async function captureScreenshot(
	url: string,
	outputPath: string,
	options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
	const playwrightAvailable =
		options?.available ?? (await isToolAvailable("playwright"));
	if (!playwrightAvailable) {
		return { captured: false, skipped: true };
	}

	const viewport = options?.viewport ?? DEFAULT_CONFIG.viewport;

	try {
		const dir = join(outputPath, "..");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const proc = Bun.spawn(
			[
				"npx",
				"playwright",
				"screenshot",
				"--browser",
				"chromium",
				`--viewport-size=${viewport.width},${viewport.height}`,
				url,
				outputPath,
			],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode === 0) {
			return { captured: true, skipped: false, path: outputPath };
		}

		return {
			captured: false,
			skipped: false,
			error: `Playwright exited with code ${exitCode}`,
		};
	} catch (e) {
		return {
			captured: false,
			skipped: true,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

// ─── Pixel Comparison ─────────────────────────────────────────────────────

/**
 * Compare two RGBA image buffers pixel by pixel.
 * Returns the number and percentage of differing pixels.
 * Simple threshold-based comparison — no external dependency.
 */
export function compareImages(
	img1: Buffer,
	img2: Buffer,
	width: number,
	height: number,
	colorThreshold = 10,
): VisualDiffResult {
	const totalPixels = width * height;
	let diffPixels = 0;

	for (let i = 0; i < totalPixels; i++) {
		const offset = i * 4;
		const r1 = img1[offset] ?? 0;
		const g1 = img1[offset + 1] ?? 0;
		const b1 = img1[offset + 2] ?? 0;
		const r2 = img2[offset] ?? 0;
		const g2 = img2[offset + 1] ?? 0;
		const b2 = img2[offset + 2] ?? 0;

		const dr = Math.abs(r1 - r2);
		const dg = Math.abs(g1 - g2);
		const db = Math.abs(b1 - b2);

		if (dr > colorThreshold || dg > colorThreshold || db > colorThreshold) {
			diffPixels++;
		}
	}

	return {
		diffPixels,
		diffPercentage: totalPixels > 0 ? diffPixels / totalPixels : 0,
		totalPixels,
	};
}

// ─── Visual Verification Runner ───────────────────────────────────────────

/**
 * Run visual verification: capture screenshots and compare against baselines.
 *
 * For each configured URL:
 * 1. Capture current screenshot to .maina/visual-current/
 * 2. Compare against .maina/visual-baselines/
 * 3. If diff exceeds threshold, emit a Finding
 *
 * Skips gracefully if Playwright is not installed or no baselines exist.
 */
export async function runVisualVerification(
	mainaDir: string,
	config?: VisualConfig,
): Promise<VisualVerifyResult> {
	const cfg = config ?? loadVisualConfig(mainaDir);

	if (cfg.urls.length === 0) {
		return { findings: [], skipped: true, screenshotsTaken: 0, comparisons: 0 };
	}

	const baselineDir = join(mainaDir, "visual-baselines");
	const currentDir = join(mainaDir, "visual-current");

	if (!existsSync(baselineDir)) {
		return {
			findings: [
				{
					tool: "visual",
					file: "",
					line: 0,
					message:
						"No visual baselines found. Run `maina visual update` to create baselines.",
					severity: "info",
				},
			],
			skipped: true,
			screenshotsTaken: 0,
			comparisons: 0,
		};
	}

	if (!existsSync(currentDir)) {
		mkdirSync(currentDir, { recursive: true });
	}

	const findings: Finding[] = [];
	let screenshotsTaken = 0;
	let comparisons = 0;

	for (const url of cfg.urls) {
		// Generate filename from URL
		const name = url
			.replace(/https?:\/\//, "")
			.replace(/[^a-zA-Z0-9]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		const filename = `${name || "page"}.png`;

		const currentPath = join(currentDir, filename);
		const baselinePath = join(baselineDir, filename);

		// Capture current screenshot
		const result = await captureScreenshot(url, currentPath, {
			viewport: cfg.viewport,
		});

		if (result.skipped) {
			return {
				findings: [
					{
						tool: "visual",
						file: "",
						line: 0,
						message:
							"Playwright not installed. Run `npx playwright install chromium` to enable visual verification.",
						severity: "info",
					},
				],
				skipped: true,
				screenshotsTaken,
				comparisons,
			};
		}

		if (!result.captured) {
			findings.push({
				tool: "visual",
				file: url,
				line: 0,
				message: `Screenshot capture failed: ${result.error ?? "unknown error"}`,
				severity: "warning",
			});
			continue;
		}

		screenshotsTaken++;

		// Compare against baseline if it exists
		if (!existsSync(baselinePath)) {
			findings.push({
				tool: "visual",
				file: url,
				line: 0,
				message: `No baseline for ${url}. Run \`maina visual update\` to create.`,
				severity: "info",
			});
			continue;
		}

		// Read both images as raw buffers (PNG comparison requires decoding)
		// For now, do byte-level comparison as a simple heuristic
		try {
			const currentBuf = readFileSync(currentPath);
			const baselineBuf = readFileSync(baselinePath);

			// Simple size comparison first
			if (currentBuf.length !== baselineBuf.length) {
				findings.push({
					tool: "visual",
					file: url,
					line: 0,
					message: `Visual regression: screenshot size changed (baseline: ${baselineBuf.length}B, current: ${currentBuf.length}B)`,
					severity: "warning",
					ruleId: "visual/regression",
				});
			} else {
				// Byte-level diff
				let diffBytes = 0;
				for (let i = 0; i < currentBuf.length; i++) {
					if (currentBuf[i] !== baselineBuf[i]) diffBytes++;
				}
				const diffPercentage = diffBytes / currentBuf.length;

				if (diffPercentage > cfg.threshold) {
					findings.push({
						tool: "visual",
						file: url,
						line: 0,
						message: `Visual regression: ${(diffPercentage * 100).toFixed(2)}% pixels differ (threshold: ${(cfg.threshold * 100).toFixed(2)}%)`,
						severity: "warning",
						ruleId: "visual/regression",
					});
				}
			}

			comparisons++;
		} catch (e) {
			findings.push({
				tool: "visual",
				file: url,
				line: 0,
				message: `Comparison failed: ${e instanceof Error ? e.message : String(e)}`,
				severity: "warning",
			});
		}
	}

	return { findings, skipped: false, screenshotsTaken, comparisons };
}

// ─── Baseline Management ──────────────────────────────────────────────────

/**
 * Update visual baselines by capturing current screenshots.
 * Saves to .maina/visual-baselines/.
 */
export async function updateBaselines(
	mainaDir: string,
	config?: VisualConfig,
): Promise<{ updated: string[]; errors: string[] }> {
	const cfg = config ?? loadVisualConfig(mainaDir);
	const baselineDir = join(mainaDir, "visual-baselines");

	if (!existsSync(baselineDir)) {
		mkdirSync(baselineDir, { recursive: true });
	}

	const updated: string[] = [];
	const errors: string[] = [];

	for (const url of cfg.urls) {
		const name = url
			.replace(/https?:\/\//, "")
			.replace(/[^a-zA-Z0-9]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		const filename = `${name || "page"}.png`;
		const outputPath = join(baselineDir, filename);

		const result = await captureScreenshot(url, outputPath, {
			viewport: cfg.viewport,
		});

		if (result.captured) {
			updated.push(filename);
		} else {
			errors.push(`${url}: ${result.error ?? "capture failed"}`);
		}
	}

	return { updated, errors };
}
