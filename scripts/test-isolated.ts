#!/usr/bin/env bun

/**
 * Isolated Test Runner
 *
 * Runs each test file in its own bun subprocess to prevent mock.module()
 * leaking across test files. bun:test shares a single module registry
 * across all test files in a single invocation, and mock.module() permanently
 * replaces modules in that registry — mock.restore() does not fully undo it.
 *
 * This script discovers all test files and runs each one in a separate
 * `bun test` process, collecting results.
 */

import { resolve } from "node:path";
import { Glob } from "bun";

const rootDir = resolve(import.meta.dir, "..");

// Discover all test files
const testGlob = new Glob("packages/**/__tests__/**/*.test.ts");
const testFiles: string[] = [];

for await (const file of testGlob.scan({ cwd: rootDir, absolute: true })) {
	testFiles.push(file);
}

testFiles.sort();

if (testFiles.length === 0) {
	process.stderr.write("No test files found.\n");
	process.exit(1);
}

let totalPass = 0;
let totalFail = 0;
let totalFiles = 0;
const failures: Array<{ file: string; output: string }> = [];

// Parse pass/fail counts from bun test output
function parseCounts(output: string): { pass: number; fail: number } {
	let pass = 0;
	let fail = 0;
	const passMatch = output.match(/(\d+)\s+pass/);
	const failMatch = output.match(/(\d+)\s+fail/);
	if (passMatch) pass = Number.parseInt(passMatch[1], 10);
	if (failMatch) fail = Number.parseInt(failMatch[1], 10);
	return { pass, fail };
}

// Run test files with controlled concurrency
const maxConcurrency = 8;

async function runTestFile(file: string): Promise<void> {
	const proc = Bun.spawn(["bun", "test", file], {
		cwd: rootDir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	const combined = stdout + stderr;

	const { pass, fail } = parseCounts(combined);
	totalPass += pass;
	totalFail += fail;
	totalFiles++;

	if (exitCode !== 0) {
		const relPath = file.replace(`${rootDir}/`, "");
		failures.push({ file: relPath, output: combined });
		process.stderr.write(`\x1b[31m✗\x1b[0m ${relPath} (${fail} fail)\n`);
	} else {
		const relPath = file.replace(`${rootDir}/`, "");
		process.stderr.write(`\x1b[32m✓\x1b[0m ${relPath} (${pass} pass)\n`);
	}
}

// Process files in batches
for (let i = 0; i < testFiles.length; i += maxConcurrency) {
	const batch = testFiles.slice(i, i + maxConcurrency);
	await Promise.all(batch.map(runTestFile));
}

// Summary
process.stdout.write(
	`\n${totalPass} pass, ${totalFail} fail across ${totalFiles} files.\n`,
);

if (failures.length > 0) {
	process.stdout.write("\n--- Failures ---\n\n");
	for (const { file, output } of failures) {
		process.stdout.write(`\n=== ${file} ===\n`);
		process.stdout.write(`${output}\n`);
	}
	process.exit(1);
}
