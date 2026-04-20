/**
 * Cloud-hero terminal keyframe script (~40s).
 *
 * Same frame shape as `terminal-script.ts`. Covers the 4-chapter arc
 * declared in `CLOUD_HERO.chapters`:
 *   01 login  → GitHub device flow
 *   02 sync   → team constitution + prompts arrive
 *   03 verify → 19-tool pipeline runs on a diff
 *   04 proof  → permalinkable URL printed
 *
 * Numbers are illustrative; regenerate from a captured run of
 * `maina login && maina sync pull && maina verify && maina commit` on
 * a reference repo before the page ships to mainahq.com/cloud.
 */

/**
 * Cloud frames use a separate chapter union from the / terminal. We
 * redeclare the `Frame` shape here (mirroring `./terminal-script`) so
 * cloud-specific chapter ids don't leak into the OSS hero's typing.
 */
export type FrameKind = "input" | "output" | "header" | "ok" | "warn" | "err";
export type CloudChapter = "login" | "sync" | "verify" | "proof";

export interface Frame {
	t: number;
	kind: FrameKind;
	text: string;
	annotation?: string;
	chapter?: CloudChapter;
}

// ─── Cloud hero (~40s) ───────────────────────────────────────────────

export const cloudHeroFrames: Frame[] = [
	// Chapter: login (0–9s)
	{ t: 0.0, kind: "input", text: "$ maina login", chapter: "login" },
	{ t: 1.0, kind: "output", text: "┌  maina login" },
	{
		t: 1.8,
		kind: "output",
		text: "│  opening browser · github device flow",
	},
	{
		t: 3.4,
		kind: "output",
		text: "│  https://github.com/login/device · code: B8HF-2K3Q",
	},
	{
		t: 6.0,
		kind: "ok",
		text: "│  ✓ authorized as @alex · member of mainahq/team-core",
	},
	{
		t: 7.2,
		kind: "ok",
		text: "│  ✓ token written to ~/.maina/auth.json",
	},
	{ t: 8.0, kind: "output", text: "└  Logged in." },

	// Chapter: sync (9–18s)
	{ t: 9.4, kind: "input", text: "$ maina sync pull", chapter: "sync" },
	{ t: 10.4, kind: "output", text: "┌  maina sync · team-core" },
	{
		t: 11.2,
		kind: "output",
		text: "│  constitution.md        v23 → v24  (hash a1f2…e7)",
	},
	{
		t: 12.0,
		kind: "output",
		text: "│  prompts/verify.md      v12 → v13",
	},
	{
		t: 12.6,
		kind: "output",
		text: "│  prompts/plan.md        v8  → v8   (unchanged)",
	},
	{
		t: 13.2,
		kind: "output",
		text: "│  prompts/review.md      v17 → v18",
	},
	{
		t: 13.8,
		kind: "output",
		text: "│  prompts/commit.md      v6  → v7",
	},
	{
		t: 15.6,
		kind: "ok",
		text: "│  ✓ 5 files updated · 0 conflicts",
	},
	{
		t: 16.6,
		kind: "output",
		text: "└  Team settings applied.",
	},

	// Chapter: verify (18–30s)
	{
		t: 18.0,
		kind: "input",
		text: "$ maina verify",
		chapter: "verify",
	},
	{ t: 19.0, kind: "output", text: "┌  maina verify · 12 staged files" },
	{ t: 20.0, kind: "output", text: "│  syntax guard  ✓ biome 0.31s" },
	{ t: 20.8, kind: "ok", text: "│  ✓ semgrep         7.1s" },
	{ t: 21.4, kind: "ok", text: "│  ✓ trivy           2.8s" },
	{ t: 22.0, kind: "ok", text: "│  ✓ secretlint      0.4s" },
	{ t: 22.6, kind: "ok", text: "│  ✓ sonar           4.2s" },
	{ t: 23.2, kind: "ok", text: "│  ✓ slop detector   0.2s" },
	{ t: 23.8, kind: "ok", text: "│  ✓ stryker         6.7s" },
	{ t: 24.4, kind: "ok", text: "│  ✓ typecheck       3.1s" },
	{ t: 25.0, kind: "ok", text: "│  ✓ tests           2.4s" },
	{
		t: 26.4,
		kind: "ok",
		text: "│  ✓ review stage 1 · spec compliance (team prompt v13)",
	},
	{
		t: 27.6,
		kind: "ok",
		text: "│  ✓ review stage 2 · code quality",
	},
	{
		t: 28.6,
		kind: "output",
		text: "└  13 tools · 0 findings · 12.1s",
	},

	// Chapter: proof (30–40s)
	{ t: 30.0, kind: "input", text: "$ maina commit", chapter: "proof" },
	{
		t: 30.8,
		kind: "ok",
		text: "│  ✓ verified · 13 tools · 0 findings",
	},
	{
		t: 32.0,
		kind: "ok",
		text: "│  ✓ proof attached: sha256:a1f2…e7c9",
	},
	{
		t: 33.4,
		kind: "output",
		text: "│  report: https://app.mainahq.com/r/5c0f3d1",
	},
	{
		t: 35.4,
		kind: "output",
		text: "│  [master 5c0f3d1] feat(core): team-synced",
	},
	{
		t: 36.6,
		kind: "ok",
		text: "└  Committed. Reviewer sees the proof URL in the PR.",
	},
];
