import { describe, expect, test } from "bun:test";
import { identify, liveness, systemProcesses } from "../processes";

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
