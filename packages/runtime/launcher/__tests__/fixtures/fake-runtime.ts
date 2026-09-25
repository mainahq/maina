/**
 * The fake runtime compiled for the Windows launcher tests, where a shell
 * script cannot stand in for `maina.exe`. Behaves like the shell fake in
 * `../fixture.ts`: answers one MCP `initialize` in `mcp` mode, and otherwise
 * echoes its arguments.
 */

async function main(args: readonly string[]): Promise<void> {
	if (args[0] === "mcp") {
		const reader = Bun.stdin.stream().getReader();
		let text = "";
		while (!text.includes("\n")) {
			const { value, done } = await reader.read();
			if (done) break;
			text += new TextDecoder().decode(value);
		}
		process.stdout.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					serverInfo: { name: "fake-runtime", version: "0" },
				},
			})}\n`,
		);
		while (!(await reader.read()).done) {
			// Drain stdin until the client closes it, like the shell fake.
		}
	} else {
		process.stdout.write(`fake-runtime ${args.join(" ")}\n`);
	}
}

void main(process.argv.slice(2));
