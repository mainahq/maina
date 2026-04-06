/**
 * `maina team` — Show team info and members.
 * `maina team invite <email>` — Invite a new team member.
 */

import { intro, log, outro, spinner } from "@clack/prompts";
import { createCloudClient, loadAuthConfig } from "@mainahq/core";
import { Command } from "commander";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_URL =
	process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";

// ── Team Info Action ────────────────────────────────────────────────────────

export interface TeamActionResult {
	displayed: boolean;
	reason?: string;
}

export async function teamAction(): Promise<TeamActionResult> {
	const authResult = loadAuthConfig();
	if (!authResult.ok) {
		return { displayed: false, reason: authResult.error };
	}

	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: authResult.value.accessToken,
	});

	const teamResult = await client.getTeam();
	if (!teamResult.ok) {
		return { displayed: false, reason: teamResult.error };
	}

	const team = teamResult.value;
	log.info(`Team: ${team.name}`);
	log.info(`Plan: ${team.plan}`);
	log.info(`Seats: ${team.seats.used}/${team.seats.total}`);

	const membersResult = await client.getTeamMembers();
	if (!membersResult.ok) {
		log.warning(`Could not load members: ${membersResult.error}`);
		return { displayed: true };
	}

	const members = membersResult.value;
	if (members.length > 0) {
		log.info("\nMembers:");
		for (const m of members) {
			const joined = m.joinedAt.split("T")[0];
			log.info(`  ${m.email.padEnd(30)} ${m.role.padEnd(8)} joined ${joined}`);
		}
	}

	return { displayed: true };
}

// ── Invite Action ───────────────────────────────────────────────────────────

export interface InviteActionResult {
	invited: boolean;
	reason?: string;
}

export async function inviteAction(email: string): Promise<InviteActionResult> {
	const authResult = loadAuthConfig();
	if (!authResult.ok) {
		return { invited: false, reason: authResult.error };
	}

	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: authResult.value.accessToken,
	});

	const result = await client.inviteTeamMember(email);
	if (!result.ok) {
		return { invited: false, reason: result.error };
	}

	return { invited: true };
}

// ── Commander Command ───────────────────────────────────────────────────────

export function teamCommand(): Command {
	const cmd = new Command("team").description("Manage your maina cloud team");

	cmd
		.command("info", { isDefault: true })
		.description("Show team information and members")
		.action(async () => {
			intro("maina team");

			const s = spinner();
			s.start("Loading team info...");

			const result = await teamAction();

			s.stop(result.displayed ? "Done" : "Failed");

			if (!result.displayed) {
				log.error(result.reason ?? "Unknown error");
			}

			outro("Done.");
		});

	cmd
		.command("invite")
		.description("Invite a member to your team")
		.argument("<email>", "Email address to invite")
		.action(async (email: string) => {
			intro("maina team invite");

			const s = spinner();
			s.start(`Inviting ${email}...`);

			const result = await inviteAction(email);

			if (result.invited) {
				s.stop("Done");
				log.success(`Invitation sent to ${email}.`);
			} else {
				s.stop("Failed");
				log.error(result.reason ?? "Unknown error");
			}

			outro("Done.");
		});

	return cmd;
}
