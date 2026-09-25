/**
 * The registry's only edge: looking at the machine's PATH.
 */

export type WorkerProbe = Readonly<{
	/** The absolute path of `binary` on PATH, or null. */
	which: (binary: string) => string | null;
	/** What `<path> --version` prints, or null when it cannot tell. */
	version: (path: string) => string | null;
}>;

/** An adapter that ignores `--version` would otherwise wait on stdin. */
const VERSION_TIMEOUT_MS = 5000;

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
