/**
 * Path resolution and credential detection, the two lookups every event
 * kind shares.
 */

import { describe, expect, test } from "bun:test";
import { isBlockDevice, isInside, isScratchPath, resolvePath } from "../paths";
import {
	containsSecret,
	isCredentialStorePath,
	isSecretPath,
	isSecretVarName,
} from "../secrets";

describe("resolvePath", () => {
	const cwd = "/work/repo/packages";
	const home = "/home/dev";
	test("relative paths resolve against the working directory", () => {
		expect(resolvePath("core/src", cwd, home)).toBe(
			"/work/repo/packages/core/src",
		);
		expect(resolvePath("../../x", cwd, home)).toBe("/work/x");
	});
	test("home spellings expand", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell tokens, not a JS template.
		for (const p of ["~/.ssh", "$HOME/.ssh", "${HOME}/.ssh"]) {
			expect(resolvePath(p, cwd, home)).toBe("/home/dev/.ssh");
		}
		expect(resolvePath("~", cwd, home)).toBe("/home/dev");
	});
	test("an unknown home stays symbolic, never inside the workspace", () => {
		expect(resolvePath("~/x", cwd, undefined)).toBe("~/x");
		expect(
			isInside(resolvePath("~/x", cwd, undefined) ?? "", "/work/repo"),
		).toBe(false);
	});
	test("an unknown working directory makes relative paths unknown", () => {
		expect(resolvePath("build", null, home)).toBeNull();
		expect(resolvePath("/etc", null, home)).toBe("/etc");
	});
});

describe("path predicates", () => {
	test("isInside compares whole segments", () => {
		expect(isInside("/work/repo/a", "/work/repo")).toBe(true);
		expect(isInside("/work/repo", "/work/repo/")).toBe(true);
		expect(isInside("/work/repository", "/work/repo")).toBe(false);
	});
	test("scratch and device paths", () => {
		expect(isScratchPath("/tmp/x")).toBe(true);
		expect(isScratchPath("/private/var/folders/ab/T/x")).toBe(true);
		expect(isScratchPath("/etc/x")).toBe(false);
		expect(isBlockDevice("/dev/sda1")).toBe(true);
		expect(isBlockDevice("/dev/disk2")).toBe(true);
		expect(isBlockDevice("/dev/nvme0n1")).toBe(true);
		expect(isBlockDevice("/dev/null")).toBe(false);
	});
});

describe("secrets", () => {
	test("secret files", () => {
		for (const p of [
			".env",
			"/work/repo/.env.local",
			"config/.env.production",
			"/home/dev/.ssh/id_rsa",
			"/home/dev/.ssh",
			"~/.aws/credentials",
			"server.pem",
			"/home/dev/.netrc",
			"/home/dev/.npmrc",
			"/home/dev/.kube/config",
			"/home/dev/.docker/config.json",
			"/home/dev/.config/gh/hosts.yml",
			"/proc/self/environ",
		]) {
			expect(isSecretPath(p)).toBe(true);
		}
		for (const p of [
			".env.example",
			".env.sample",
			"README.md",
			"src/env.ts",
			"environment.ts",
		]) {
			expect(isSecretPath(p)).toBe(false);
		}
	});

	test("credential stores are directories whose writes matter", () => {
		expect(isCredentialStorePath("/home/dev/.ssh/authorized_keys")).toBe(true);
		expect(isCredentialStorePath("/home/dev/.aws/config")).toBe(true);
		expect(isCredentialStorePath("/home/dev/.gnupg/pubring.kbx")).toBe(true);
		expect(isCredentialStorePath("/home/dev/.config/app.json")).toBe(false);
	});

	test("secret-shaped variable names", () => {
		for (const name of [
			"NPM_TOKEN",
			"OPENAI_API_KEY",
			"DB_PASSWORD",
			"AWS_SECRET_ACCESS_KEY",
		]) {
			expect(isSecretVarName(name)).toBe(true);
		}
		for (const name of ["PATH", "HOME", "NODE_ENV"]) {
			expect(isSecretVarName(name)).toBe(false);
		}
	});

	test("secret-shaped content (assembled at runtime so this file holds none)", () => {
		const token = `gh${"p_"}${"A1b2C3d4".repeat(4)}abcd`;
		const key = `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----\nabc\n`;
		expect(containsSecret(`const t = "${token}";`)).toBe(true);
		expect(containsSecret(key)).toBe(true);
		expect(containsSecret("const t = process.env.TOKEN;")).toBe(false);
	});
});
