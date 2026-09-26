/** Shared fixtures for the evidence producer tests. */

/** A `bun test --reporter=junit` report holding `cases`. */
export const junit = (
	cases: readonly (readonly [
		suite: string,
		name: string,
		status: "passed" | "failed" | "skipped",
	])[],
): string =>
	[
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<testsuites name="bun test" tests="1">',
		'  <testsuite name="/w/a.test.ts" file="/w/a.test.ts" tests="1">',
		...cases.map(([suite, name, status]) =>
			status === "passed"
				? `    <testcase name="${name}" classname="${suite}" time="0.1" line="3" assertions="1" />`
				: `    <testcase name="${name}" classname="${suite}" time="0.1" line="3" assertions="1">\n      ${status === "failed" ? '<failure type="AssertionError" />' : "<skipped />"}\n    </testcase>`,
		),
		"  </testsuite>",
		"</testsuites>",
	].join("\n");
