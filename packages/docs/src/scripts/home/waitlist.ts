/**
 * The waitlist request body (#360). The maina-cloud Worker behind
 * `POST /api/waitlist` requires `email`, `role` and `team_size`, and folds
 * any other top-level string (the `utm_*` parameters, `referrer`,
 * `landing_path`) into its attribution column, each capped at 500
 * characters. Pure: the page script passes in what it reads.
 */

/** Query parameters passed through to the Worker as attribution. */
const UTM_KEYS = [
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_content",
	"utm_term",
] as const;

/** The Worker's per-field cap on attribution strings. */
const MAX_ATTRIBUTION = 500;

/** The Worker's shape check. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value: string): boolean => EMAIL.test(value.trim());

type Fields = Readonly<{ email: string; role: string; teamSize: string }>;

type Attribution = Readonly<{
	source: string;
	/** `location.search`. */
	search?: string;
	/** `document.referrer`. */
	referrer?: string;
	/** `location.pathname`. */
	path?: string;
}>;

type Payload = Readonly<
	{
		email: string;
		role: string;
		team_size: string;
		source: string;
	} & Partial<
		Record<(typeof UTM_KEYS)[number] | "referrer" | "landing_path", string>
	>
>;

export function waitlistPayload(fields: Fields, from: Attribution): Payload {
	const extra: Record<string, string> = {};
	const put = (key: string, value: string | null | undefined) => {
		const trimmed = value?.trim() ?? "";
		if (trimmed !== "") extra[key] = trimmed.slice(0, MAX_ATTRIBUTION);
	};
	const params = new URLSearchParams(from.search ?? "");
	for (const key of UTM_KEYS) put(key, params.get(key));
	put("referrer", from.referrer);
	put("landing_path", from.path);
	return {
		email: fields.email.trim(),
		role: fields.role,
		team_size: fields.teamSize,
		source: from.source,
		...extra,
	};
}
