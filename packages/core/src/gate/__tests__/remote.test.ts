/**
 * `parseRsync` / `parseScp` (#622): the commands rsync, scp and sftp run on
 * this machine in place of ssh, and whether they run one on the remote host.
 */

import { describe, expect, test } from "bun:test";
import { parseRsync, parseScp } from "../remote";

/** Resolved words; `$`-words stand for ones the gate cannot resolve. */
const tokens = (...words: string[]) =>
	words.map((raw) => ({ text: raw.includes("$") ? null : raw, raw }));

describe("parseRsync", () => {
	test("reads the remote shell as a local command, in every spelling", () => {
		for (const words of [
			["-e", "ssh -p 22", "a", "h:b"],
			["-essh -p 22", "a", "h:b"],
			["-avze", "ssh -p 22", "a", "h:b"],
			["--rsh=ssh -p 22", "a", "h:b"],
			["--rsh", "ssh -p 22", "a", "h:b"],
		]) {
			const got = parseRsync(tokens(...words));
			expect(got.local, words.join(" ")).toEqual(["ssh -p 22"]);
			expect(got.remote).toBe(false);
		}
	});

	test("marks a separate option value so it is not read as an operand", () => {
		expect([...parseRsync(tokens("-e", "ssh", "a", "h:b")).values]).toEqual([
			1,
		]);
		expect([...parseRsync(tokens("-a", "a", "h:b")).values]).toEqual([]);
	});

	test("a remote rsync other than an rsync binary is a remote command", () => {
		expect(
			parseRsync(tokens("--rsync-path=sudo rsync", "a", "h:b")).remote,
		).toBe(true);
		expect(parseRsync(tokens("--rsync-path", "rm -rf /; rsync")).remote).toBe(
			true,
		);
		expect(parseRsync(tokens("--rsync-path=$RP", "a", "h:b")).remote).toBe(
			true,
		);
		expect(
			parseRsync(tokens("--rsync-path=/opt/bin/rsync", "a", "h:b")).remote,
		).toBe(false);
		expect(parseRsync(tokens("--rsync-path", "rsync")).remote).toBe(false);
	});

	test("an unresolved remote shell is unreadable, and -- ends the options", () => {
		expect(parseRsync(tokens("-e", "$RSH", "a", "h:b")).local).toEqual([null]);
		expect(parseRsync(tokens("-e$RSH", "a", "h:b")).local).toEqual([null]);
		expect(parseRsync(tokens("-e")).local).toEqual([null]);
		expect(parseRsync(tokens("--", "-e", "x")).local).toEqual([]);
		// `-f` takes the rest of the cluster, so its `e` is no option.
		expect(parseRsync(tokens("-f- *.tmpe", "a", "b")).local).toEqual([]);
	});
});

describe("parseScp", () => {
	test("-S names a program run here, quoted as one word", () => {
		expect(parseScp(tokens("-S", "my ssh", "f", "h:"), false).local).toEqual([
			"'my ssh'",
		]);
		expect(parseScp(tokens("-S$P", "f", "h:"), false).local).toEqual([null]);
	});

	test("the letters of an unresolved variable are not read as options", () => {
		// `$SFX` would otherwise read as `-S FX`; the next word stays an operand.
		const got = parseScp(tokens("-r$SFX", "f", "h:"), false);
		expect(got.local).toEqual([]);
		expect([...got.values]).toEqual([]);
		expect(parseRsync(tokens("--rsh$X", "a", "h:b")).values.size).toBe(0);
	});

	test("-o ProxyCommand is read as ssh reads it", () => {
		expect(
			parseScp(tokens("-o", "ProxyCommand=nc %h %p", "f", "h:"), false).local,
		).toEqual(["nc %h %p"]);
		expect(
			parseScp(tokens("-oStrictHostKeyChecking=no", "f", "h:"), false).local,
		).toEqual([]);
	});

	test("options that differ between scp and sftp", () => {
		// scp `-B` is batch mode; sftp `-B` takes a buffer size.
		expect(parseScp(tokens("-BS", "prog", "f", "h:"), false).local).toEqual([
			"'prog'",
		]);
		expect(parseScp(tokens("-BS", "prog", "h"), true).local).toEqual([]);
		expect(parseScp(tokens("-D", "sftp-server -e", "h"), true).local).toEqual([
			"sftp-server -e",
		]);
		expect(parseScp(tokens("-s", "sftp", "h"), true).remote).toBe(false);
		expect(
			parseScp(tokens("-s", "sudo /usr/lib/sftp-server", "h"), true).remote,
		).toBe(true);
		expect(parseScp(tokens("-s", "/x", "h"), false).remote).toBe(false);
	});
});
