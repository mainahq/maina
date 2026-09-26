import { describe, expect, it } from "bun:test";
import { isEmail, waitlistPayload } from "../waitlist";

const fields = { email: " Dev@Example.com ", role: "ic_dev", teamSize: "6-20" };

describe("waitlistPayload", () => {
	it("sends the fields the Worker requires, trimmed, with the source", () => {
		expect(waitlistPayload(fields, { source: "landing-v1" })).toEqual({
			email: "Dev@Example.com",
			role: "ic_dev",
			team_size: "6-20",
			source: "landing-v1",
		});
	});

	it("passes utm_* parameters, the referrer and the landing path through", () => {
		const payload = waitlistPayload(fields, {
			source: "landing-v1",
			search: "?utm_source=hn&utm_medium=post&utm_campaign=v1&ref=x",
			referrer: "https://news.ycombinator.com/",
			path: "/",
		});
		expect(payload).toEqual({
			email: "Dev@Example.com",
			role: "ic_dev",
			team_size: "6-20",
			source: "landing-v1",
			utm_source: "hn",
			utm_medium: "post",
			utm_campaign: "v1",
			referrer: "https://news.ycombinator.com/",
			landing_path: "/",
		});
	});

	it("drops empty values and caps each attribution value at 500 characters", () => {
		const long = "a".repeat(900);
		const payload = waitlistPayload(fields, {
			source: "landing-v1",
			search: `?utm_source=&utm_term=${long}`,
			referrer: "",
		});
		expect(payload.utm_source).toBeUndefined();
		expect(payload.referrer).toBeUndefined();
		expect(payload.utm_term?.length).toBe(500);
	});
});

describe("isEmail", () => {
	it("accepts the shape the Worker accepts and rejects the rest", () => {
		expect(isEmail("you@company.com")).toBe(true);
		expect(isEmail("  you@company.com ")).toBe(true);
		expect(isEmail("you@company")).toBe(false);
		expect(isEmail("you company@x.io")).toBe(false);
		expect(isEmail("")).toBe(false);
	});
});
