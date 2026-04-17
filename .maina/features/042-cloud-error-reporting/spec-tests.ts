/**
 * Spec tests for feature 042-cloud-error-reporting.
 *
 * Real tests: packages/core/src/telemetry/__tests__/cloud-reporter.test.ts
 *
 * Coverage: 10 tests
 * - T4: isCloudReportingEnabled — default on, opt-out, explicit false
 * - T3: buildCloudErrorEvent — metadata, PII exclusion, path scrub, all tiers
 * - T5: reportCloudError — enabled, opted-out, error ID
 */

export {};
