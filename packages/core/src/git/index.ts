export interface Commit {
	hash: string;
	message: string;
	author: string;
	date: string;
}

async function exec(
	args: string[],
	cwd: string = process.cwd(),
): Promise<string> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return output.trim();
	} catch {
		return "";
	}
}

export async function getCurrentBranch(cwd?: string): Promise<string> {
	const branch = await exec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	return branch;
}

export async function getBranchName(cwd?: string): Promise<string> {
	return getCurrentBranch(cwd);
}

export async function getRepoRoot(cwd?: string): Promise<string> {
	const root = await exec(["rev-parse", "--show-toplevel"], cwd);
	return root;
}

export async function getRecentCommits(
	n: number,
	cwd?: string,
): Promise<Commit[]> {
	const separator = "|||";
	const format = `%H${separator}%s${separator}%an${separator}%ai`;
	const output = await exec(["log", `-${n}`, `--pretty=format:${format}`], cwd);
	if (!output) return [];
	return output
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const parts = line.split(separator);
			return {
				hash: parts[0]?.trim() ?? "",
				message: parts[1]?.trim() ?? "",
				author: parts[2]?.trim() ?? "",
				date: parts[3]?.trim() ?? "",
			};
		});
}

export async function getChangedFiles(
	since?: string,
	cwd?: string,
): Promise<string[]> {
	let output: string;
	if (since) {
		output = await exec(["diff", "--name-only", since], cwd);
	} else {
		output = await exec(["status", "--porcelain"], cwd);
		if (!output) return [];
		return output
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => line.slice(3).trim());
	}
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

export async function getDiff(
	ref1?: string,
	ref2?: string,
	cwd?: string,
): Promise<string> {
	const args: string[] = ["diff"];
	if (ref1 && ref2) {
		args.push(ref1, ref2);
	} else if (ref1) {
		args.push(ref1);
	}
	const output = await exec(args, cwd);
	return output;
}

export async function getStagedFiles(cwd?: string): Promise<string[]> {
	const output = await exec(["diff", "--cached", "--name-only"], cwd);
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}

export async function getTrackedFiles(cwd?: string): Promise<string[]> {
	const output = await exec(
		["ls-files", "--cached", "--exclude-standard"],
		cwd,
	);
	if (!output) return [];
	return output.split("\n").filter((line) => line.trim().length > 0);
}
