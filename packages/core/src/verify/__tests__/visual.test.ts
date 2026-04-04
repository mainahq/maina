import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectWebProject, loadVisualConfig } from "../visual";

describe("detectWebProject", () => {
	const testDir = join(import.meta.dir, "__fixtures__/visual-detect");

	function setup(pkg: Record<string, unknown>) {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "package.json"), JSON.stringify(pkg));
	}

	function cleanup() {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	}

	it("should detect Next.js project", () => {
		setup({ scripts: { dev: "next dev" } });
		expect(detectWebProject(testDir)).toBe(true);
		cleanup();
	});

	it("should detect Astro project", () => {
		setup({ scripts: { dev: "astro dev" } });
		expect(detectWebProject(testDir)).toBe(true);
		cleanup();
	});

	it("should detect Vite project", () => {
		setup({ scripts: { dev: "vite" } });
		expect(detectWebProject(testDir)).toBe(true);
		cleanup();
	});

	it("should detect webpack-dev-server", () => {
		setup({ scripts: { start: "webpack serve" } });
		expect(detectWebProject(testDir)).toBe(true);
		cleanup();
	});

	it("should return false for non-web project", () => {
		setup({ scripts: { start: "node server.js" } });
		expect(detectWebProject(testDir)).toBe(false);
		cleanup();
	});

	it("should return false when no package.json", () => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(testDir, { recursive: true });
		expect(detectWebProject(testDir)).toBe(false);
		cleanup();
	});

	it("should detect from devDependencies", () => {
		setup({ devDependencies: { vite: "^5.0.0" } });
		expect(detectWebProject(testDir)).toBe(true);
		cleanup();
	});
});

describe("loadVisualConfig", () => {
	const testDir = join(import.meta.dir, "__fixtures__/visual-config");

	function cleanup() {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	}

	it("should return defaults when no config exists", () => {
		cleanup();
		mkdirSync(testDir, { recursive: true });
		const config = loadVisualConfig(testDir);
		expect(config.threshold).toBe(0.001);
		expect(config.viewport.width).toBe(1280);
		expect(config.viewport.height).toBe(720);
		expect(config.urls).toEqual([]);
		cleanup();
	});

	it("should load from preferences.json", () => {
		cleanup();
		mkdirSync(testDir, { recursive: true });
		writeFileSync(
			join(testDir, "preferences.json"),
			JSON.stringify({
				visual: {
					urls: ["http://localhost:3000"],
					threshold: 0.005,
					viewport: { width: 1920, height: 1080 },
				},
			}),
		);
		const config = loadVisualConfig(testDir);
		expect(config.urls).toEqual(["http://localhost:3000"]);
		expect(config.threshold).toBe(0.005);
		expect(config.viewport.width).toBe(1920);
		cleanup();
	});
});

describe("captureScreenshot", () => {
	it("should return skipped when playwright is not available", async () => {
		const { captureScreenshot } = await import("../visual");
		const result = await captureScreenshot(
			"http://localhost:9999",
			"/tmp/test-screenshot.png",
			{ available: false },
		);
		expect(result.captured).toBe(false);
		expect(result.skipped).toBe(true);
	});
});

describe("compareImages", () => {
	it("should return 0 diff for identical images", async () => {
		const { compareImages } = await import("../visual");
		// Create two identical 2x2 white RGBA buffers
		const img = Buffer.alloc(2 * 2 * 4, 255);
		const result = compareImages(img, img, 2, 2);
		expect(result.diffPixels).toBe(0);
		expect(result.diffPercentage).toBe(0);
	});

	it("should detect difference between different images", async () => {
		const { compareImages } = await import("../visual");
		// 2x2 white image
		const white = Buffer.alloc(2 * 2 * 4, 255);
		// 2x2 black image
		const black = Buffer.alloc(2 * 2 * 4, 0);
		// Set alpha to 255 for black image
		for (let i = 3; i < black.length; i += 4) {
			black[i] = 255;
		}
		const result = compareImages(white, black, 2, 2);
		expect(result.diffPixels).toBeGreaterThan(0);
		expect(result.diffPercentage).toBeGreaterThan(0);
	});
});
