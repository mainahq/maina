#!/usr/bin/env bun
/**
 * Docs link checker (#358, FR-DOC-2).
 *
 * Every internal link on the docs site must resolve: a page (content page,
 * Astro page or redirect), a heading anchor on it, or a public file. Links
 * to files in this repository on GitHub (`/blob/` and `/tree/`) must name a
 * file that exists. A relative link is reported: the site serves every
 * page with and without its trailing slash, so it would resolve to two
 * different URLs. Every redirect must land on a page too. Scanned: the docs content, the Astro pages and
 * components, and the README's links to the site. Nothing is fetched:
 * external links other than the repository's own are left alone. The
 * landing copy in `src/data` is not scanned yet: the landing rebuild
 * (#360) replaces it.
 *
 *   bun scripts/docs-links.ts    exit 1 and list every broken link
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { REDIRECTS } from "../packages/docs/src/navigation";

const DOCS_PKG = "packages/docs";
const CONTENT = `${DOCS_PKG}/src/content/docs`;
const PAGES = `${DOCS_PKG}/src/pages`;
const PUBLIC = `${DOCS_PKG}/public`;
const SITE = "https://mainahq.com";
const REPO = "https://github.com/mainahq/maina";

/**
 * Paths served by the deploy, not the build: the docs workflow stages the
 * receipts under `/receipts/`.
 */
const DEPLOY_PREFIXES: readonly string[] = ["/receipts/"];

// ── Headings ────────────────────────────────────────────────────────────────

/**
 * A heading's id as Starlight (github-slugger) makes it: lower case, the
 * punctuation dropped, each space a hyphen.
 */
export function slugify(heading: string): string {
	return heading
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

/** Markdown inline syntax a heading's text drops: code, emphasis, links. */
const plain = (text: string): string =>
	text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*]/g, "")
		.replace(/\s+#+\s*$/, "")
		.trim();

/** Lines outside fenced code blocks, with their 1-based line numbers. */
function prose(text: string): { line: number; text: string }[] {
	const out: { line: number; text: string }[] = [];
	let fence: string | null = null;
	text.split(/\r?\n/).forEach((line, i) => {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence === null && marker !== undefined) {
			fence = marker;
			return;
		}
		if (fence !== null) {
			if (marker?.startsWith(fence)) fence = null;
			return;
		}
		out.push({ line: i + 1, text: line });
	});
	return out;
}

/** The ids of a page's headings, plus Starlight's `_top`. */
export function headingAnchors(text: string): Set<string> {
	const anchors = new Set<string>(["_top"]);
	const seen = new Map<string, number>();
	for (const { text: line } of prose(text)) {
		const m = /^#{1,6}\s+(.+)$/.exec(line);
		if (!m?.[1]) continue;
		const base = slugify(plain(m[1]));
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		anchors.add(n === 0 ? base : `${base}-${n}`);
	}
	return anchors;
}

// ── Links ───────────────────────────────────────────────────────────────────

export type Link = Readonly<{ line: number; href: string }>;

const MARKDOWN_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HREF = /\bhref\s*[=:]\s*\{?\s*["']([^"']+)["']/g;

/** Links a page states, in order, outside fenced code. */
export function extractLinks(text: string): Link[] {
	const links: Link[] = [];
	for (const { line, text: row } of prose(text)) {
		const found = [...row.matchAll(MARKDOWN_LINK), ...row.matchAll(HREF)]
			.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
			.map((m) => m[1] ?? "");
		for (const href of found) links.push({ line, href });
	}
	return links;
}

// ── Site ────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	return names.flatMap((name) => {
		const full = join(dir, name);
		try {
			if (statSync(full).isDirectory()) return walk(full);
		} catch {
			return [];
		}
		return [full];
	});
}

const posix = (path: string): string => path.split(sep).join("/");

/** `/a/b/` for a route, whatever its trailing slash. */
const route = (path: string): string =>
	path === "/" || path === "" ? "/" : `/${path.replace(/^\/|\/$/g, "")}/`;

/** A URL with a scheme (`https:`, `mailto:`) or protocol-relative. */
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

type Site = Readonly<{
	/** Each page's route and the anchors on it (null: not checked). */
	pages: ReadonlyMap<string, ReadonlySet<string> | null>;
	files: ReadonlySet<string>;
}>;

function readSite(root: string, redirects: readonly string[]): Site {
	const pages = new Map<string, ReadonlySet<string> | null>();
	for (const full of walk(join(root, CONTENT))) {
		const rel = posix(relative(join(root, CONTENT), full));
		if (!/\.mdx?$/.test(rel)) continue;
		const slug = rel.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
		pages.set(route(slug), headingAnchors(readFileSync(full, "utf-8")));
	}
	for (const full of walk(join(root, PAGES))) {
		const rel = posix(relative(join(root, PAGES), full));
		if (!rel.endsWith(".astro") || rel.includes("[")) continue;
		const slug = rel.replace(/\.astro$/, "").replace(/(^|\/)index$/, "");
		// An Astro page outranks a content page on the same route, and its
		// anchors are not read.
		pages.set(route(slug), null);
	}
	for (const from of redirects) pages.set(route(from), null);
	const files = new Set(
		walk(join(root, PUBLIC)).map(
			(full) => `/${posix(relative(join(root, PUBLIC), full))}`,
		),
	);
	return { pages, files };
}

// ── Check ───────────────────────────────────────────────────────────────────

export type BrokenLink = Readonly<{
	file: string;
	line: number;
	href: string;
	reason: string;
}>;

/** Why `href` on the page with `ownAnchors` does not resolve, or null. */
function brokenReason(
	root: string,
	site: Site,
	href: string,
	ownAnchors: ReadonlySet<string> | null,
): string | null {
	if (href.startsWith("#")) {
		const anchor = href.slice(1);
		return ownAnchors === null || ownAnchors.has(anchor)
			? null
			: `no heading #${anchor}`;
	}
	if (href.startsWith(`${REPO}/blob/`) || href.startsWith(`${REPO}/tree/`)) {
		// `<ref>/<path>`, where the ref is one segment (`master`) or two
		// (`v1/main`).
		const parts = href
			.slice(REPO.length)
			.replace(/^\/(?:blob|tree)\//, "")
			.replace(/[#?].*$/, "")
			.split("/");
		const paths = [parts.slice(1).join("/"), parts.slice(2).join("/")];
		return paths.some((path) => path !== "" && existsSync(join(root, path)))
			? null
			: `no file ${paths[0] ?? ""} in the repository`;
	}
	if (!href.startsWith(SITE) && EXTERNAL.test(href)) return null;
	if (!href.startsWith("/") && !href.startsWith(SITE)) {
		return "relative link: use a root-relative path";
	}
	const local = href.startsWith(`${SITE}/`)
		? href.slice(SITE.length)
		: href === SITE
			? "/"
			: href;
	if (!local.startsWith("/") || local.startsWith("//")) return null;
	const [pathPart = "", anchor] = local.replace(/\?[^#]*/, "").split("#");
	if (DEPLOY_PREFIXES.some((prefix) => pathPart.startsWith(prefix))) {
		return null;
	}
	if (site.files.has(pathPart)) return null;
	const anchors = site.pages.get(route(pathPart));
	if (anchors === undefined) return "no page";
	if (anchor && anchors !== null && !anchors.has(anchor)) {
		return `no heading #${anchor}`;
	}
	return null;
}

/** Files whose links are checked, repo-relative. */
function scanned(root: string): string[] {
	const sources = [
		...walk(join(root, CONTENT)).filter((f) => /\.mdx?$/.test(f)),
		...walk(join(root, DOCS_PKG, "src", "components")).filter((f) =>
			f.endsWith(".astro"),
		),
		...walk(join(root, PAGES)).filter((f) => f.endsWith(".astro")),
	];
	return [
		"README.md",
		...sources.map((f) => posix(relative(root, f))).sort(),
	].filter((rel) => existsSync(join(root, rel)));
}

export type CheckOptions = Readonly<{
	/** Old route to the route it redirects to. */
	redirects: Readonly<Record<string, string>>;
}>;

const NAVIGATION = `${DOCS_PKG}/src/navigation.ts`;

/** Redirects whose target is not a page, reported against navigation.ts. */
function brokenRedirects(
	root: string,
	site: Site,
	redirects: Readonly<Record<string, string>>,
): BrokenLink[] {
	const lines = existsSync(join(root, NAVIGATION))
		? readFileSync(join(root, NAVIGATION), "utf-8").split(/\r?\n/)
		: [];
	return Object.entries(redirects).flatMap(([from, to]) => {
		const reason = brokenReason(root, site, to, null);
		if (reason === null) return [];
		const line = lines.findIndex((l) => l.includes(`"${from}"`)) + 1;
		return [
			{
				file: NAVIGATION,
				line,
				href: to,
				reason: `redirect ${from}: ${reason}`,
			},
		];
	});
}

/** Every broken link under `root`, in file then line order. */
export function checkDocsLinks(
	root: string,
	options: CheckOptions = { redirects: REDIRECTS },
): BrokenLink[] {
	const site = readSite(root, Object.keys(options.redirects));
	const pages = scanned(root).flatMap((file) => {
		const text = readFileSync(join(root, file), "utf-8");
		const isPage = file.startsWith(`${CONTENT}/`);
		const ownAnchors = isPage ? headingAnchors(text) : null;
		const links = extractLinks(text).filter(
			// The README links elsewhere with repo-relative paths; only its
			// links to the site and to repository files are the site's.
			(link) =>
				file !== "README.md" ||
				link.href.startsWith(SITE) ||
				link.href.startsWith(REPO),
		);
		return links.flatMap((link) => {
			const reason = brokenReason(root, site, link.href, ownAnchors);
			return reason === null ? [] : [{ file, ...link, reason }];
		});
	});
	return [...pages, ...brokenRedirects(root, site, options.redirects)];
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const broken = checkDocsLinks(root);
	if (broken.length === 0) {
		process.stdout.write("docs-links: OK: every internal link resolves.\n");
		process.exit(0);
	}
	process.stderr.write("docs-links: FAIL\n");
	for (const b of broken) {
		process.stderr.write(`  ${b.file}:${b.line}: ${b.href} (${b.reason})\n`);
	}
	process.exit(1);
}
