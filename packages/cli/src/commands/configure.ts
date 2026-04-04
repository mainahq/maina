import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { appendWorkflowStep, detectLanguages, detectTools } from "@maina/core";
import { Command } from "commander";

// ── Install hints (same as init.ts) ─────────────────────────────────────

const INSTALL_HINTS: Record<string, string> = {
	biome: "bun add -d @biomejs/biome",
	semgrep: "brew install semgrep",
	trivy: "brew install trivy",
	secretlint:
		"bun add -d @secretlint/secretlint-rule-preset-recommend secretlint",
	sonarqube: "brew install sonar-scanner",
	stryker: "bun add -d @stryker-mutator/core",
	"diff-cover": "pipx install diff-cover",
	ruff: "brew install ruff",
	"golangci-lint": "brew install golangci-lint",
	"cargo-clippy": "rustup component add clippy",
	"cargo-audit": "cargo install cargo-audit",
	playwright: "npx playwright install chromium",
};

// ── Core Action ─────────────────────────────────────────────────────────

export interface ConfigureActionOptions {
	cwd?: string;
	noInteractive?: boolean;
}

export async function configureAction(
	options: ConfigureActionOptions,
): Promise<void> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const constitutionPath = join(mainaDir, "constitution.md");

	// ── Step 1: Detect stack ────────────────────────────────────────────
	log.step("Detecting project...");

	const languages = detectLanguages(cwd);
	const tools = await detectTools();
	const available = tools.filter((t) => t.available);
	const missing = tools.filter((t) => !t.available);

	log.info(
		`Languages detected: ${languages.length > 0 ? languages.join(", ") : "none (defaulting to TypeScript)"}`,
	);
	log.info(
		`Tools available: ${available.length}/${tools.length} (${available.map((t) => t.name).join(", ")})`,
	);

	if (missing.length > 0) {
		log.warning(`Missing tools: ${missing.map((t) => t.name).join(", ")}`);
		for (const t of missing) {
			const hint = INSTALL_HINTS[t.name];
			if (hint) log.message(`  ${t.name}: ${hint}`);
		}
	}

	// ── Step 2: Show and update constitution ────────────────────────────
	if (!existsSync(constitutionPath)) {
		log.warning("No constitution found. Run `maina init` first.");
		return;
	}

	const currentConstitution = readFileSync(constitutionPath, "utf-8");
	log.step("Current Constitution:");
	log.message(currentConstitution);

	if (options.noInteractive) {
		outro("Done (non-interactive mode).");
		return;
	}

	// ── Step 3: Interactive updates ─────────────────────────────────────
	const section = await select({
		message: "What would you like to update?",
		options: [
			{ value: "architecture", label: "Architecture constraints" },
			{ value: "conventions", label: "Project conventions" },
			{ value: "verification", label: "Verification rules" },
			{ value: "visual", label: "Visual verification URLs" },
			{ value: "done", label: "Done — save and exit" },
		],
	});

	if (isCancel(section) || section === "done") {
		return;
	}

	if (section === "architecture") {
		const arch = await text({
			message:
				"Describe your architecture constraints (one per line, prefix with -):",
			placeholder:
				"- All DB access through repository layer\n- API responses: { data, error, meta } envelope",
			initialValue: extractSection(currentConstitution, "Architecture"),
		});

		if (!isCancel(arch) && typeof arch === "string") {
			const updated = replaceSection(currentConstitution, "Architecture", arch);
			writeFileSync(constitutionPath, updated);
			log.success("Architecture section updated.");
		}
	}

	if (section === "conventions") {
		const conv = await text({
			message: "Describe your conventions (one per line, prefix with -):",
			placeholder:
				"- Conventional commits\n- TDD: write tests before implementation",
			initialValue: extractSection(currentConstitution, "Conventions"),
		});

		if (!isCancel(conv) && typeof conv === "string") {
			const updated = replaceSection(currentConstitution, "Conventions", conv);
			writeFileSync(constitutionPath, updated);
			log.success("Conventions section updated.");
		}
	}

	if (section === "verification") {
		const ver = await text({
			message:
				"Describe your verification rules (one per line, prefix with -):",
			placeholder:
				"- All commits pass: lint + typecheck + test\n- Diff-only: only report findings on changed lines",
			initialValue: extractSection(currentConstitution, "Verification"),
		});

		if (!isCancel(ver) && typeof ver === "string") {
			const updated = replaceSection(currentConstitution, "Verification", ver);
			writeFileSync(constitutionPath, updated);
			log.success("Verification section updated.");
		}
	}

	if (section === "visual") {
		const urls = await text({
			message: "Visual verification URLs (comma-separated):",
			placeholder: "http://localhost:3000, http://localhost:3000/about",
		});

		if (!isCancel(urls) && typeof urls === "string" && urls.trim()) {
			const prefsPath = join(mainaDir, "preferences.json");
			let prefs: Record<string, unknown> = {};
			if (existsSync(prefsPath)) {
				try {
					prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
				} catch {
					// Start fresh
				}
			}

			const urlList = urls
				.split(",")
				.map((u) => u.trim())
				.filter((u) => u.length > 0);

			prefs.visual = {
				...(typeof prefs.visual === "object" && prefs.visual !== null
					? prefs.visual
					: {}),
				urls: urlList,
			};
			writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
			log.success(`Visual URLs set: ${urlList.join(", ")}`);
		}
	}

	appendWorkflowStep(mainaDir, "configure", "Project settings updated.");
}

// ── Helpers ─────────────────────────────────────────────────────────────

function extractSection(content: string, section: string): string {
	const pattern = new RegExp(
		`^## ${section}\\s*\\n([\\s\\S]*?)(?=^## |$)`,
		"m",
	);
	const match = content.match(pattern);
	return match?.[1]?.trim() ?? "";
}

function replaceSection(
	content: string,
	section: string,
	newContent: string,
): string {
	const pattern = new RegExp(
		`(^## ${section}\\s*\\n)[\\s\\S]*?(?=^## |$)`,
		"m",
	);
	return content.replace(pattern, `$1${newContent}\n\n`);
}

// ── Commander Command ───────────────────────────────────────────────────

export function configureCommand(): Command {
	return new Command("configure")
		.description("Update project settings, constitution, and tool preferences")
		.option("--no-interactive", "Show current config without prompting")
		.action(async (options) => {
			intro("maina configure");

			await configureAction({
				noInteractive: options.interactive === false,
			});

			outro("Configuration complete.");
		});
}
