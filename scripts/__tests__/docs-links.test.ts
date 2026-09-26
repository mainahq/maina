/**
 * Docs link checker (#358, FR-DOC-2).
 *
 * Every internal link on the docs site (a page, a heading anchor, a public
 * file, a redirect) and every link to a file in this repository must
 * resolve, so moving or deleting a page cannot leave a 404 behind.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	checkDocsLinks,
	extractLinks,
	headingAnchors,
	slugify,
} from "../docs-links";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("slugify", () => {
	test("matches the ids Starlight gives headings", () => {
		expect(slugify("Cloud Verification")).toBe("cloud-verification");
		expect(slugify("`maina setup` flags")).toBe("maina-setup-flags");
		expect(slugify("What's new in v1?")).toBe("whats-new-in-v1");
		expect(slugify("L0 — Git-native")).toBe("l0--git-native");
	});
});

describe("headingAnchors", () => {
	test("reads headings outside code fences, numbering duplicates", () => {
		const text = [
			"# Title",
			"## Setup",
			"```bash",
			"# not a heading",
			"```",
			"## Setup",
			"### The [MCP](/mcp/) server",
		].join("\n");
		expect([...headingAnchors(text)].sort()).toEqual(
			["_top", "setup", "setup-1", "the-mcp-server", "title"].sort(),
		);
	});
});

describe("extractLinks", () => {
	test("finds Markdown links, href attributes and site URLs, with lines", () => {
		const text = [
			"See [Install](/install/) and [a heading](#setup).",
			'<LinkCard title="MCP" href="/mcp" />',
			"Online at [the site](https://mainahq.com/ci/).",
			"External [GitHub](https://github.com/mainahq/maina/blob/master/README.md).",
			"```bash",
			"curl [not](/a-link)",
			"```",
		].join("\n");
		expect(extractLinks(text)).toEqual([
			{ line: 1, href: "/install/" },
			{ line: 1, href: "#setup" },
			{ line: 2, href: "/mcp" },
			{ line: 3, href: "https://mainahq.com/ci/" },
			{
				line: 4,
				href: "https://github.com/mainahq/maina/blob/master/README.md",
			},
		]);
	});
});

describe("checkDocsLinks", () => {
	let root: string;
	const write = (path: string, text: string) => {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	};
	const DOCS = "packages/docs/src/content/docs";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "docs-links-"));
		write(`${DOCS}/install.mdx`, "---\ntitle: Install\n---\n\n## Verify\n");
		write(`${DOCS}/engines/verify.mdx`, "## Cloud verification\n");
		write("packages/docs/src/pages/cloud.astro", "<a href='/install/'>x</a>");
		write("packages/docs/public/robots.txt", "");
		write("README.md", "[Docs](https://mainahq.com/install/)\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("links to pages, anchors, public files, redirects and repo files pass", () => {
		write(
			`${DOCS}/ci.mdx`,
			[
				"[a](/install/) [b](/install) [c](/install/#verify)",
				"[d](/engines/verify#cloud-verification) [e](/cloud/)",
				"[f](/robots.txt) [g](/quickstart) [h](#top) [i](/)",
				"[j](https://github.com/mainahq/maina/blob/master/README.md)",
				"[k](/receipts/abc/)",
				"[l](https://github.com/mainahq/maina/tree/v1/main/README.md)",
				"",
				"## Top",
			].join("\n"),
		);
		write("packages/docs/src/pages/index.astro", "");
		const hits = checkDocsLinks(root, { redirects: ["/quickstart"] });
		expect(hits).toEqual([]);
	});

	test("reports a missing page, a missing anchor and a missing repo file", () => {
		write(
			`${DOCS}/ci.mdx`,
			[
				"Old [link](/getting-started) here.",
				"Bad [anchor](/install/#nope).",
				"Same page [anchor](#missing).",
				"[ADR](https://github.com/mainahq/maina/blob/master/adr/9999-x.md)",
			].join("\n"),
		);
		expect(checkDocsLinks(root, { redirects: [] })).toEqual([
			{
				file: `${DOCS}/ci.mdx`,
				line: 1,
				href: "/getting-started",
				reason: "no page",
			},
			{
				file: `${DOCS}/ci.mdx`,
				line: 2,
				href: "/install/#nope",
				reason: "no heading #nope",
			},
			{
				file: `${DOCS}/ci.mdx`,
				line: 3,
				href: "#missing",
				reason: "no heading #missing",
			},
			{
				file: `${DOCS}/ci.mdx`,
				line: 4,
				href: "https://github.com/mainahq/maina/blob/master/adr/9999-x.md",
				reason: "no file adr/9999-x.md in the repository",
			},
		]);
	});

	test("checks README links to the site and hrefs in components", () => {
		write("README.md", "[Old](https://mainahq.com/full-setup/)\n");
		write(
			"packages/docs/src/components/Nav.astro",
			'<a href="/quickstart">Docs</a>\n',
		);
		expect(checkDocsLinks(root, { redirects: [] })).toEqual([
			{
				file: "README.md",
				line: 1,
				href: "https://mainahq.com/full-setup/",
				reason: "no page",
			},
			{
				file: "packages/docs/src/components/Nav.astro",
				line: 1,
				href: "/quickstart",
				reason: "no page",
			},
		]);
	});
});

test("the repository's docs have no broken internal links", () => {
	expect(checkDocsLinks(REPO_ROOT)).toEqual([]);
});
