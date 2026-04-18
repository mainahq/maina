/**
 * Structural type describing the detected stack context.
 *
 * Mirrors the `StackContext` produced by `packages/core/src/setup/context.ts`
 * (sub-task 2). Kept structural here so agent-file generators do not need a
 * hard dependency on the context module until it is wired in sub-task 4.
 */
export interface StackContext {
	languages: string[];
	frameworks: string[];
	packageManager: string;
	buildTool: string | null;
	linters: string[];
	testRunners: string[];
	cicd: string[];
	repoSize: { files: number; bytes: number };
	subprojects?: StackContext[];
	isEmpty: boolean;
	isLarge: boolean;
}
