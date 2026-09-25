import { describe, expect, test } from "bun:test";
import { mineGitOutcomes } from "../git-miner";
import { linkDecisionCommit, queryOutcomes } from "../link";
import type { OutcomePorts } from "../types";
import {
	type FakeCommit,
	fakeRepo,
	hunk,
	logDecision,
	outcomePorts,
	sha,
	unwrap,
} from "./fixtures";

const ROOT = "/repo";

/** Logs `ids` as decisions of the given types, linked to `commit`. */
function decisionsOn(
	ports: OutcomePorts,
	commit: string,
	decisions: Readonly<
		Record<string, Parameters<typeof logDecision>[1]["type"]>
	>,
): void {
	for (const [id, type] of Object.entries(decisions)) {
		logDecision(ports.db, { id, type });
		unwrap(linkDecisionCommit(ports, id, commit));
	}
}

function outcomesOf(ports: OutcomePorts) {
	return unwrap(queryOutcomes(ports, {})).map((o) => ({
		decisionId: o.decisionId,
		outcome: o.outcome,
		ref: o.ref,
	}));
}

const base: FakeCommit = { sha: sha("base"), subject: "chore: start" };

describe("mineGitOutcomes: reverts", () => {
	test("a revert commit links to the originating diff.* decisions", async () => {
		const ports = outcomePorts();
		const feat: FakeCommit = {
			sha: sha("feat"),
			subject: "feat(core): add a thing",
			diff: hunk("src/a.ts", 10, 2, 10, 4),
		};
		const other: FakeCommit = {
			sha: sha("other"),
			subject: "feat(cli): unrelated",
			diff: hunk("src/b.ts", 1, 1, 1, 1),
		};
		const revert: FakeCommit = {
			sha: sha("revert"),
			subject: 'Revert "feat(core): add a thing"',
			body: `This reverts commit ${feat.sha}.\n`,
			diff: hunk("src/a.ts", 10, 4, 10, 2),
		};
		decisionsOn(ports, feat.sha, {
			"d-sens": "diff.sensitive",
			"d-review": "diff.needs_review",
			"d-slop": "slop",
		});
		decisionsOn(ports, other.sha, { "d-other": "diff.needs_review" });

		const git = fakeRepo([base, feat, other, revert]);
		const summary = unwrap(
			await mineGitOutcomes({ ...ports, git }, base.sha, { root: ROOT }),
		);

		expect(summary.scanned).toBe(3);
		expect(outcomesOf(ports)).toEqual([
			{ decisionId: "d-sens", outcome: "reverted", ref: revert.sha },
			{ decisionId: "d-review", outcome: "reverted", ref: revert.sha },
		]);
		expect(summary.linked.map((o) => o.decisionId)).toEqual([
			"d-sens",
			"d-review",
		]);
	});

	test("a revert of a commit before sinceRef still links", async () => {
		const ports = outcomePorts();
		const feat: FakeCommit = { sha: sha("feat"), subject: "feat: x" };
		const revert: FakeCommit = {
			sha: sha("revert"),
			subject: 'Revert "feat: x"',
			body: `This reverts commit ${feat.sha}.`,
		};
		decisionsOn(ports, feat.sha, { d1: "diff.needs_review" });
		const git = fakeRepo([feat, base, revert]);
		unwrap(await mineGitOutcomes({ ...ports, git }, base.sha, { root: ROOT }));
		expect(outcomesOf(ports)).toEqual([
			{ decisionId: "d1", outcome: "reverted", ref: revert.sha },
		]);
	});
});

describe("mineGitOutcomes: hotfixes", () => {
	function history(fixSubject: string, fixHunk: string, gap = 0) {
		const feat: FakeCommit = {
			sha: sha("feat"),
			subject: "feat(core): parser",
			diff: hunk("src/parse.ts", 20, 3, 20, 5),
		};
		const fillers: FakeCommit[] = Array.from({ length: gap }, (_, i) => ({
			sha: sha(`filler-${i}`),
			subject: `docs: note ${i}`,
			diff: hunk("README.md", i + 1, 1, i + 1, 1),
		}));
		const fix: FakeCommit = {
			sha: sha("fix"),
			subject: fixSubject,
			diff: fixHunk,
		};
		return { feat, fix, commits: [base, feat, ...fillers, fix] } as const;
	}

	test("a fix touching the same hunk within N commits links as hotfixed", async () => {
		const ports = outcomePorts();
		const { feat, fix, commits } = history(
			"fix(core): off-by-one in parser",
			hunk("src/parse.ts", 22, 1, 22, 1),
			2,
		);
		decisionsOn(ports, feat.sha, {
			"d-review": "diff.needs_review",
			"d-slop": "slop",
		});
		const git = fakeRepo(commits);
		unwrap(await mineGitOutcomes({ ...ports, git }, base.sha, { root: ROOT }));
		expect(outcomesOf(ports)).toEqual([
			{ decisionId: "d-review", outcome: "hotfixed", ref: fix.sha },
		]);
	});

	test("a hotfix subject counts as marked fix", async () => {
		const ports = outcomePorts();
		const { feat, fix, commits } = history(
			"hotfix: parser crash",
			hunk("src/parse.ts", 21, 1, 21, 2),
		);
		decisionsOn(ports, feat.sha, { d1: "diff.sensitive" });
		unwrap(
			await mineGitOutcomes({ ...ports, git: fakeRepo(commits) }, base.sha, {
				root: ROOT,
			}),
		);
		expect(outcomesOf(ports)).toEqual([
			{ decisionId: "d1", outcome: "hotfixed", ref: fix.sha },
		]);
	});

	test("no link when the follow-up is not marked fix", async () => {
		const ports = outcomePorts();
		const { feat, commits } = history(
			"refactor(core): tidy parser",
			hunk("src/parse.ts", 22, 1, 22, 1),
		);
		decisionsOn(ports, feat.sha, { d1: "diff.needs_review" });
		unwrap(
			await mineGitOutcomes({ ...ports, git: fakeRepo(commits) }, base.sha, {
				root: ROOT,
			}),
		);
		expect(outcomesOf(ports)).toEqual([]);
	});

	test("no link when the fix touches a different hunk or file", async () => {
		const ports = outcomePorts();
		const elsewhere = history(
			"fix(core): something else",
			[
				hunk("src/parse.ts", 200, 1, 200, 1),
				hunk("src/other.ts", 21, 1, 21, 1),
			].join(""),
		);
		decisionsOn(ports, elsewhere.feat.sha, { d1: "diff.needs_review" });
		unwrap(
			await mineGitOutcomes(
				{ ...ports, git: fakeRepo(elsewhere.commits) },
				base.sha,
				{ root: ROOT },
			),
		);
		expect(outcomesOf(ports)).toEqual([]);
	});

	test("no link when the fix is more than N commits later", async () => {
		const ports = outcomePorts();
		const { feat, commits } = history(
			"fix(core): off-by-one",
			hunk("src/parse.ts", 22, 1, 22, 1),
			3,
		);
		decisionsOn(ports, feat.sha, { d1: "diff.needs_review" });
		unwrap(
			await mineGitOutcomes({ ...ports, git: fakeRepo(commits) }, base.sha, {
				root: ROOT,
				hotfixWindow: 3,
			}),
		);
		expect(outcomesOf(ports)).toEqual([]);
	});
});

describe("mineGitOutcomes: idempotence and errors", () => {
	test("miner runs are idempotent", async () => {
		const ports = outcomePorts();
		const feat: FakeCommit = {
			sha: sha("feat"),
			subject: "feat: parser",
			diff: hunk("src/p.ts", 5, 1, 5, 3),
		};
		const fix: FakeCommit = {
			sha: sha("fix"),
			subject: "fix: parser",
			diff: hunk("src/p.ts", 6, 1, 6, 1),
		};
		const revert: FakeCommit = {
			sha: sha("revert"),
			subject: 'Revert "feat: parser"',
			body: `This reverts commit ${feat.sha}.`,
		};
		decisionsOn(ports, feat.sha, { d1: "diff.needs_review" });
		const git = fakeRepo([base, feat, fix, revert]);
		const run = () =>
			mineGitOutcomes({ ...ports, git }, base.sha, { root: ROOT });

		const first = unwrap(await run());
		expect(first.linked).toHaveLength(2);
		expect(first.existing).toBe(0);
		const before = unwrap(queryOutcomes(ports, {}));

		const second = unwrap(await run());
		expect(second.linked).toEqual([]);
		expect(second.existing).toBe(2);
		expect(unwrap(queryOutcomes(ports, {}))).toEqual(before);
	});

	test("runs git in the given root", async () => {
		const ports = outcomePorts();
		const seen: string[] = [];
		const repo = fakeRepo([base]);
		const git = {
			run: (root: string, args: readonly string[]) => {
				seen.push(root);
				return repo.run(root, args);
			},
		};
		unwrap(await mineGitOutcomes({ ...ports, git }, base.sha, { root: ROOT }));
		expect(seen).toEqual([ROOT]);
	});

	test("a git failure is a git error, not a throw", async () => {
		const ports = outcomePorts();
		const result = await mineGitOutcomes(
			{ ...ports, git: fakeRepo([base]) },
			sha("unknown"),
			{ root: ROOT },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("git");
	});

	test("an option-like sinceRef is rejected before git runs", async () => {
		const ports = outcomePorts();
		const git = fakeRepo([base]);
		const result = await mineGitOutcomes({ ...ports, git }, "--output=/x", {
			root: ROOT,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("invalid_outcome");
		expect(git.calls()).toEqual([]);
	});
});
