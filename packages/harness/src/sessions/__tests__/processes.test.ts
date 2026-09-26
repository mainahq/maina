import { describe, expect, test } from "bun:test";
import {
	identify,
	liveness,
	type ProbeIo,
	probeWith,
	systemProcesses,
} from "../processes";

describe("systemProcesses", () => {
	test("pid 1 is a running process, never reported gone", () => {
		// A harness that runs as pid 1 (a container's entrypoint) must not look
		// crashed to every other process, which would then reclaim its runs.
		const probed = systemProcesses.probe(1);
		expect(probed.state).toBe("running");
		expect(liveness(systemProcesses, identify(systemProcesses, 1))).not.toBe(
			"gone",
		);
	});

	test("pids that cannot exist are gone", () => {
		for (const pid of [0, -1, 1.5, Number.NaN]) {
			expect(systemProcesses.probe(pid).state).toBe("gone");
		}
	});

	test("this process is running, with a start time", () => {
		const me = identify(systemProcesses, process.pid);
		expect(me.start).not.toBeNull();
		expect(liveness(systemProcesses, me)).toBe("same");
	});
});

describe("probeWith", () => {
	const io = (over: Partial<ProbeIo>): ProbeIo => ({
		exists: () => true,
		procStat: () => undefined,
		ps: () => "",
		...over,
	});

	test("a pid that exists but neither /proc nor ps can show is unknown, never gone", () => {
		// /proc mounted hidepid, or ps unavailable: the process runs as far as
		// kill(0) can tell, so a reclaim must not treat its owner as crashed.
		expect(probeWith(io({}), 4242)).toEqual({ state: "running", start: null });
		expect(probeWith(io({ ps: () => undefined }), 4242)).toEqual({
			state: "running",
			start: null,
		});
	});

	test("a pid kill(0) cannot find is gone", () => {
		expect(probeWith(io({ exists: () => false }), 4242)).toEqual({
			state: "gone",
		});
	});

	test("reads state and start time from ps; a zombie is gone", () => {
		expect(
			probeWith(io({ ps: () => "Ss   Sat Sep 26 05:16:47 2026" }), 7),
		).toEqual({ state: "running", start: "Sat Sep 26 05:16:47 2026" });
		expect(
			probeWith(io({ ps: () => "Z+   Sat Sep 26 05:16:47 2026" }), 7),
		).toEqual({ state: "gone" });
	});

	test("prefers /proc when it answers", () => {
		const stat =
			"7 (a b) S 1 7 7 0 -1 4194304 1 0 0 0 0 0 0 0 20 0 1 0 12345 0";
		expect(probeWith(io({ procStat: () => stat }), 7)).toEqual({
			state: "running",
			start: "12345",
		});
	});
});
