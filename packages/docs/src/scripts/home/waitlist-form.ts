/**
 * Waitlist form wiring (#360). Email first; once it is valid the role and
 * team-size fields the Worker requires appear. Posts JSON to the Worker
 * with the page's UTM parameters, referrer and path; on any failure it
 * offers the mailto: fallback.
 */

import { track } from "./ui";
import { isEmail, waitlistPayload } from "./waitlist";

function initForm(form: HTMLFormElement): void {
	const d = form.dataset;
	const msg = document.getElementById(`${form.id}-msg`);
	const more = form.querySelector<HTMLFieldSetElement>("[data-more]");
	const email = form.querySelector<HTMLInputElement>('input[name="email"]');
	const role = form.querySelector<HTMLSelectElement>('select[name="role"]');
	const team = form.querySelector<HTMLSelectElement>(
		'select[name="team_size"]',
	);
	const say = (text: string) => {
		if (msg) msg.textContent = text;
	};
	form.addEventListener("submit", (ev) => {
		ev.preventDefault();
		if (!email || !role || !team || !more) return;
		if (!isEmail(email.value)) {
			say(d.msgInvalid ?? "");
			email.focus();
			return;
		}
		if (more.hidden) {
			more.hidden = false;
			say(d.msgMore ?? "");
			role.focus();
			return;
		}
		if (!role.value || !team.value) {
			say(d.msgMissing ?? "");
			(role.value ? team : role).focus();
			return;
		}
		const payload = waitlistPayload(
			{ email: email.value, role: role.value, teamSize: team.value },
			{
				source: d.source ?? "landing-v1",
				search: window.location.search,
				referrer: document.referrer,
				path: window.location.pathname,
			},
		);
		say(d.msgSending ?? "");
		track("waitlist_submit", { form: form.id });
		const fail = () => {
			if (!msg) return;
			msg.textContent = `${d.msgFailed ?? ""} `;
			const a = document.createElement("a");
			a.href = `mailto:${d.mailto ?? ""}?subject=${encodeURIComponent("Maina waitlist")}&body=${encodeURIComponent(payload.email)}`;
			a.textContent = d.mailto ?? "";
			msg.append(a);
		};
		fetch(d.endpoint ?? "", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		})
			.then((res) => {
				if (!res.ok) return fail();
				form.reset();
				more.hidden = true;
				say(d.msgDone ?? "");
			})
			.catch(fail);
	});
}

export function initWaitlist(): void {
	for (const form of document.querySelectorAll<HTMLFormElement>(
		"form[data-waitlist]",
	)) {
		initForm(form);
	}
}
