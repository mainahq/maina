/**
 * Entry the cloud command test bundles with `target: "node"` and runs under
 * a real Node binary: `node cloud-node.js cloud <subcommand> ...`.
 */

import { Command } from "commander";
import { cloudCommand } from "../../cloud";

await new Command("maina").addCommand(cloudCommand()).parseAsync(process.argv);
