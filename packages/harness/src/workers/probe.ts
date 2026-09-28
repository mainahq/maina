/**
 * The registry's only edge: looking at the machine's PATH.
 */

export type WorkerProbe = Readonly<{
	/** The absolute path of `binary` on PATH, or null. */
	which: (binary: string) => string | null;
	/** What `<path> --version` prints, or null when it cannot tell. */
	version: (path: string) => string | null;
}>;

/**
 * The same look for the Link inventory (#591, FR-INV-1), which the resident
 * runtime takes in the background: `version` never blocks the event loop,
 * so a slow `--version` cannot hold up a gate request.
 */
export type InventoryProbe = Readonly<{
	which: (binary: string) => string | null;
	version: (path: string) => Promise<string | null>;
}>;

/** An adapter that ignores `--version` would otherwise wait on stdin. */
const VERSION_TIMEOUT_MS = 5000;

export const systemInventoryProbe: InventoryProbe = {
	which: (binary) => Bun.which(binary),
	version: async (path) => {
		try {
			const run = Bun.spawn([path, "--version"], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				timeout: VERSION_TIMEOUT_MS,
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(run.stdout).text(),
				new Response(run.stderr).text(),
				run.exited,
			]);
			if (code !== 0) return null;
			const out = `${stdout}${stderr}`.trim();
			return out === "" ? null : out;
		} catch {
			return null;
		}
	},
};

export const systemProbe: WorkerProbe = {
	which: (binary) => Bun.which(binary),
	version: (path) => {
		try {
			const run = Bun.spawnSync([path, "--version"], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				timeout: VERSION_TIMEOUT_MS,
			});
			if (!run.success) return null;
			const out = `${run.stdout.toString()}${run.stderr.toString()}`.trim();
			return out === "" ? null : out;
		} catch {
			return null;
		}
	},
};
