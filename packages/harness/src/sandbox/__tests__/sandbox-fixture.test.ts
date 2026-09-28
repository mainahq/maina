import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TMP_MARKER } from "../tmp-root";
import { makeLayout } from "./sandbox-fixture";

describe("makeLayout", () => {
	test("the worker temp dir is shallow enough for srt's sockets (#632)", () => {
		// srt binds `srt-mux-<pid>-<n>.sock` in the worker's TMPDIR when an
		// inner srt starts (the nested spike); macOS caps a socket path at
		// 104 bytes, so a deeper layout fails the spike for the wrong reason.
		const { tmp } = makeLayout();
		expect(join(tmp, "srt-mux-99999-99.sock").length).toBeLessThanOrEqual(103);
	});

	test("the layout is a marked root, so it goes with the test run", () => {
		const { base } = makeLayout();
		expect(existsSync(join(base, TMP_MARKER))).toBe(true);
	});
});
