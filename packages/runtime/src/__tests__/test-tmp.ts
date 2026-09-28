/**
 * Temp dirs for runtime tests (#639): harness's `testTmpDir` (#632, #637).
 * Every dir lives under one per-process `maina-test-*` root carrying a
 * `.maina-tmp` pid marker, removed after the file's tests, on exit or a
 * signal, by a detached reaper (SIGKILL, multi-file runs) and, failing all
 * of that, by the next process's stale sweep.
 */

export { testTmpDir } from "@mainahq/harness/src/__tests__/test-tmp";
