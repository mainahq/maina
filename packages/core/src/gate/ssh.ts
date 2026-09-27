/**
 * Reads an `ssh` command line the way OpenSSH does (#614), so the gate can
 * tell a login or a tunnel from a command run on another machine.
 *
 * A remote command is never classified: its paths, services and databases
 * live on a host the gate cannot see, so any one of them is `remote.exec`.
 * What ssh runs locally (`ProxyCommand`, `LocalCommand`, `KnownHostsCommand`)
 * is handed back so the caller can classify it as shell.
 */

/** A word of the command line; `null` when the gate cannot resolve it. */
type Word = string | null;

type SshInvocation = Readonly<{
	/** A command runs on the remote host: after the destination, or as `RemoteCommand`. */
	remote: boolean;
	/**
	 * No command is given, yet ssh opens a session whose shell reads stdin,
	 * so a heredoc or a pipe into it is a script run on the remote host.
	 */
	shellOnStdin: boolean;
	/** Shell commands ssh runs on this machine; `null` for one the gate cannot read. */
	local: readonly Word[];
}>;

/** Options that take a value, glued (`-p2222`) or as the next word. */
const WITH_VALUE: ReadonlySet<string> = new Set("BbcDEeFIiJLlmOoPpQRSWw");

/**
 * Options after which ssh opens no shell: no session (`-N`), printing its
 * config or version (`-G`, `-V`), a control command (`-O`), a query (`-Q`)
 * or stdio forwarding (`-W`).
 */
const NO_SHELL: ReadonlySet<string> = new Set("NGVOQW");

/** `-o` keys whose value ssh runs as a local shell command. */
const LOCAL_COMMANDS: ReadonlySet<string> = new Set([
	"proxycommand",
	"localcommand",
	"knownhostscommand",
]);

type Scan = {
	/** A `RemoteCommand` option. */
	remote: boolean;
	/** A word after the destination: the remote command starts here. */
	command: boolean;
	shell: boolean;
	stdinNull: boolean;
	destination: boolean;
	local: Word[];
};

/**
 * Parses the arguments after `ssh`. OpenSSH keeps reading options after the
 * destination (`ssh host -p 22 cmd`) until `--` or the first other word,
 * which starts the remote command. An unresolved word in option position is
 * taken as the destination, or as the command once there is one, so the
 * unknown fails towards `remote.exec`.
 */
export function parseSsh(words: readonly Word[]): SshInvocation {
	const scan: Scan = {
		remote: false,
		command: false,
		shell: true,
		stdinNull: false,
		destination: false,
		local: [],
	};
	let optionsEnded = false;
	for (let i = 0; i < words.length && !scan.command; i++) {
		const word = words[i] as Word;
		if (!optionsEnded && word === "--") {
			optionsEnded = true;
		} else if (
			!optionsEnded &&
			word !== null &&
			word.startsWith("-") &&
			word.length > 1
		) {
			i += readOptions(word, words[i + 1], scan);
		} else if (!scan.destination) {
			scan.destination = true;
		} else {
			scan.command = true;
		}
	}
	const remote = scan.remote || scan.command;
	return {
		remote,
		shellOnStdin: !remote && scan.destination && scan.shell && !scan.stdinNull,
		local: scan.local,
	};
}

/**
 * Reads one cluster of short options (`-tt`, `-4A`, `-p2222`); returns 1
 * when its last option took the next word as its value.
 */
function readOptions(word: string, next: Word | undefined, scan: Scan): number {
	for (let j = 1; j < word.length; j++) {
		const flag = word[j] as string;
		if (NO_SHELL.has(flag)) scan.shell = false;
		if (flag === "n") scan.stdinNull = true;
		if (!WITH_VALUE.has(flag)) continue;
		const glued = word.slice(j + 1);
		const value = glued !== "" ? glued : (next ?? null);
		if (flag === "o") readConfigOption(value, scan);
		return glued !== "" ? 0 : 1;
	}
	return 0;
}

/** `-o Key=value` or `-o 'Key value'`: a command-running key is recorded. */
function readConfigOption(value: Word, scan: Scan): void {
	if (value === null) {
		// Any option at all, `ProxyCommand` included.
		scan.local.push(null);
		return;
	}
	const match = /^\s*([A-Za-z]+)\s*(?:=|\s)\s*(.*)$/s.exec(value);
	if (match === null) return;
	const key = (match[1] as string).toLowerCase();
	const command = (match[2] as string).trim();
	if (command === "" || command.toLowerCase() === "none") return;
	if (key === "remotecommand") scan.remote = true;
	else if (LOCAL_COMMANDS.has(key)) scan.local.push(command);
}
