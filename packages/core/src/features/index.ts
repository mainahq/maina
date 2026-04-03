export type { AnalysisFinding, AnalysisReport } from "./analyzer";
export { analyze } from "./analyzer";
export type { CheckResult, VerificationReport } from "./checklist";
export { verifyPlan } from "./checklist";
export {
	createFeatureDir,
	type DesignChoices,
	getNextFeatureNumber,
	scaffoldFeature,
	scaffoldFeatureWithContext,
} from "./numbering";
