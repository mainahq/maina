Current branch: master
Touched files: 494
Files modified this session:
  - .changeset/roundtrip-flywheel.md
  - .maina/constitution.md
  - .maina/features/024-v05-cloud-client/plan.md
  - .maina/features/024-v05-cloud-client/spec.md
  - .maina/features/025-v06-hosted-verification/plan.md
  - .maina/features/034-v110-roundtrip-flywheel/plan.md
  - .maina/features/035-wiki-foundation/plan.md
  - .maina/wiki/.signals.json
  - .maina/wiki/.state.json
  - .maina/wiki/architecture/monorepo-structure.md
  - .maina/wiki/architecture/three-engines.md
  - .maina/wiki/architecture/verification-pipeline.md
  - .maina/wiki/decisions/0001-karpathy-principled-spec-quality-system.md
  - .maina/wiki/decisions/0002-multi-language-verify-pipeline.md
  - .maina/wiki/decisions/0003-fix-host-delegation-for-cli-ai-tasks.md
  - .maina/wiki/decisions/0004-workflow-context-forwarding.md
  - .maina/wiki/decisions/0005-background-rl-feedback-at-each-workflow-step.md
  - .maina/wiki/decisions/0006-post-workflow-rl-self-improvement-loop.md
  - .maina/wiki/decisions/0007-visual-verification-with-playwright.md
  - .maina/wiki/decisions/0008-verification-proof-in-pr-body.md
  - .maina/wiki/decisions/0009-ai-delegation-protocol-for-host-agents.md
  - .maina/wiki/decisions/0010-v03x-hardening-verify-gaps-rl-loop-hldlld.md
  - .maina/wiki/decisions/0011-v040-polish-ci.md
  - .maina/wiki/decisions/0012-v050-cloud-client-maina-cloud.md
  - .maina/wiki/entities/CloudEpisodicEntry.md
  - .maina/wiki/entities/CloudFeedbackPayload.md
  - .maina/wiki/entities/CloudPromptImprovement.md
  - .maina/wiki/entities/DECAY_HALF_LIVES.md
  - .maina/wiki/entities/EpisodicCloudEntry.md
  - .maina/wiki/entities/FeedbackBatchPayload.md
  - .maina/wiki/entities/FeedbackEvent.md
  - .maina/wiki/entities/FeedbackImprovementsResponse.md
  - .maina/wiki/entities/HostDelegation.md
  - .maina/wiki/entities/PHP_PROFILE.md
  - .maina/wiki/entities/PROFILES.md
  - .maina/wiki/entities/SubmitVerifyPayload.md
  - .maina/wiki/entities/Tier3Results.md
  - .maina/wiki/entities/Tier3Totals.md
  - .maina/wiki/entities/ToolUsageInput.md
  - .maina/wiki/entities/ToolUsageStats.md
  - .maina/wiki/entities/VerifyFinding.md
  - .maina/wiki/entities/VerifyResultResponse.md
  - .maina/wiki/entities/VerifyStatusResponse.md
  - .maina/wiki/entities/WikiLintCheck.md
  - .maina/wiki/entities/WikiLintFinding.md
  - .maina/wiki/entities/WikiLintResult.md
  - .maina/wiki/entities/WikiState.md
  - .maina/wiki/entities/abTest.md
  - .maina/wiki/entities/acknowledgeFinding.md
  - .maina/wiki/entities/analyzeCommand.md
  - .maina/wiki/entities/analyzeWorkflowTrace.md
  - .maina/wiki/entities/assembleBudget.md
  - .maina/wiki/entities/assembleContext.md
  - .maina/wiki/entities/assembleEpisodicText.md
  - .maina/wiki/entities/assembleRetrievalText.md
  - .maina/wiki/entities/assembleWorkingText.md
  - .maina/wiki/entities/benchmarkCommand.md
  - .maina/wiki/entities/bootstrap.md
  - .maina/wiki/entities/brainstormAction.md
  - .maina/wiki/entities/brainstormCommand.md
  - .maina/wiki/entities/captureResult.md
  - .maina/wiki/entities/checkAnyType.md
  - .maina/wiki/entities/commitCommand.md
  - .maina/wiki/entities/commitSnapshots.md
  - .maina/wiki/entities/compareImages.md
  - .maina/wiki/entities/comprehensiveReview.md
  - .maina/wiki/entities/createCacheManager.md
  - .maina/wiki/entities/createTicket.md
  - .maina/wiki/entities/decayAllEntries.md
  - .maina/wiki/entities/deleteTodo.md
  - .maina/wiki/entities/designCommand.md
  - .maina/wiki/entities/detectCommentedCode.md
  - .maina/wiki/entities/detectSlop.md
  - .maina/wiki/entities/detectTools.md
  - .maina/wiki/entities/doctorAction.md
  - .maina/wiki/entities/doctorCommand.md
  - .maina/wiki/entities/exitCodeFromResult.md
  - .maina/wiki/entities/explainCommand.md
  - .maina/wiki/entities/exportEpisodicForCloud.md
  - .maina/wiki/entities/extractEntities.md
  - .maina/wiki/entities/filterByDiff.md
  - .maina/wiki/entities/formatTier3Comparison.md
  - .maina/wiki/entities/formatVerificationProof.md
  - .maina/wiki/entities/generateFixes.md
  - .maina/wiki/entities/generateHldLld.md
  - .maina/wiki/entities/generateModuleSummary.md
  - .maina/wiki/entities/getAllRules.md
  - .maina/wiki/entities/getBudgetMode.md
  - .maina/wiki/entities/getChangedFiles.md
  - .maina/wiki/entities/getFeedbackDb.md
  - .maina/wiki/entities/getLinkSyntax.md
  - .maina/wiki/entities/getNoisyRules.md
  - .maina/wiki/entities/getProfile.md
  - .maina/wiki/entities/getPromptStats.md
  - .maina/wiki/entities/getRepoSlug.md
  - .maina/wiki/entities/getSkipRate.md
  - .maina/wiki/entities/getStagedFiles.md
  - .maina/wiki/entities/getStatsDb.md
  - .maina/wiki/entities/getSupportedLanguages.md
  - .maina/wiki/entities/getToolUsageStats.md
  - .maina/wiki/entities/getTrackedFiles.md
  - .maina/wiki/entities/getWorkflowId.md
  - .maina/wiki/entities/handleDeleteTodo.md
  - .maina/wiki/entities/initAction.md
  - .maina/wiki/entities/initCommand.md
  - .maina/wiki/entities/isToolAvailable.md
  - .maina/wiki/entities/logoutCommand.md
  - .maina/wiki/entities/mapToArticles.md
  - .maina/wiki/entities/outputDelegationRequest.md
  - .maina/wiki/entities/parseFile.md
  - .maina/wiki/entities/persistSemanticContext.md
  - .maina/wiki/entities/planAction.md
  - .maina/wiki/entities/planCommand.md
  - .maina/wiki/entities/pollForToken.md
  - .maina/wiki/entities/prCommand.md
  - .maina/wiki/entities/promote.md
  - .maina/wiki/entities/promptVersions.md
  - .maina/wiki/entities/resetWorkingContext.md
  - .maina/wiki/entities/resolveABTests.md
  - .maina/wiki/entities/resolveModel.md
  - .maina/wiki/entities/retire.md
  - .maina/wiki/entities/reviewCodeQualityWithAI.md
  - .maina/wiki/entities/reviewCommand.md
  - .maina/wiki/entities/reviewDesign.md
  - .maina/wiki/entities/reviewDesignCommand.md
  - .maina/wiki/entities/runAIReview.md
  - .maina/wiki/entities/runBenchmark.md
  - .maina/wiki/entities/runBuiltinChecks.md
  - .maina/wiki/entities/runCoverage.md
  - .maina/wiki/entities/runHooks.md
  - .maina/wiki/entities/runLighthouse.md
  - .maina/wiki/entities/runMutation.md
  - .maina/wiki/entities/runPipeline.md
  - .maina/wiki/entities/runSecretlint.md
  - .maina/wiki/entities/runSemgrep.md
  - .maina/wiki/entities/runSonar.md
  - .maina/wiki/entities/runTrivy.md
  - .maina/wiki/entities/runTwoStageReview.md
  - .maina/wiki/entities/runTypecheck.md
  - .maina/wiki/entities/runVisualVerification.md
  - .maina/wiki/entities/runZap.md
  - .maina/wiki/entities/scaffoldFeatureWithContext.md
  - .maina/wiki/entities/scoreRelevance.md
  - .maina/wiki/entities/search.md
  - .maina/wiki/entities/searchWithGrep.md
  - .maina/wiki/entities/searchWithRipgrep.md
  - .maina/wiki/entities/shouldDelegateToHost.md
  - .maina/wiki/entities/specCommand.md
  - .maina/wiki/entities/startDeviceFlow.md
  - .maina/wiki/entities/statsAction.md
  - .maina/wiki/entities/statsCommand.md
  - .maina/wiki/entities/statusCommand.md
  - .maina/wiki/entities/syntaxGuard.md
  - .maina/wiki/entities/teamCommand.md
  - .maina/wiki/entities/ticketCommand.md
  - .maina/wiki/entities/traceFeature.md
  - .maina/wiki/entities/trackToolUsage.md
  - .maina/wiki/entities/truncateToFit.md
  - .maina/wiki/entities/updateBaselines.md
  - .maina/wiki/entities/validateArticleStructure.md
  - .maina/wiki/entities/verifyCommand.md
  - .maina/wiki/features/001-stats-tracker.md
  - .maina/wiki/features/002-ticket.md
  - .maina/wiki/features/003-pr-and-init.md
  - .maina/wiki/features/004-mcp-server.md
  - .maina/wiki/features/005-rl-feedback-and-skills.md
  - .maina/wiki/features/006-karpathy-spec-quality.md
  - .maina/wiki/features/007-todo-api-crud.md
  - .maina/wiki/features/008-benchmark-comparison.md
  - .maina/wiki/features/009-interactive-design.md
  - .maina/wiki/features/010-benchmark-harness.md
  - .maina/wiki/features/011-self-improvement.md
  - .maina/wiki/features/012-multi-language-verify.md
  - .maina/wiki/features/013-fix-host-delegation.md
  - .maina/wiki/features/014-workflow-context.md
  - .maina/wiki/features/015-background-rl-feedback.md
  - .maina/wiki/features/016-post-workflow-rl.md
  - .maina/wiki/features/017-visual-verification.md
  - .maina/wiki/features/018-verification-proof-pr.md
  - .maina/wiki/features/019-tool-install-guide.md
  - .maina/wiki/features/020-unified-host-delegation.md
  - .maina/wiki/features/021-ai-delegation-protocol.md
  - .maina/wiki/features/022-brainstorm-command.md
  - .maina/wiki/features/023-enterprise-languages.md
  - .maina/wiki/features/024-v03x-hardening.md
  - .maina/wiki/features/024-v04-polish-ci.md
  - .maina/wiki/features/024-v05-cloud-client.md
  - .maina/wiki/features/025-v06-hosted-verification.md
  - .maina/wiki/features/026-v07-rl-flywheel.md
  - .maina/wiki/features/027-v10-launch.md
  - .maina/wiki/features/028-project-aware-tools.md
  - .maina/wiki/features/029-ai-driven-init.md
  - .maina/wiki/features/030-mcp-agent-files.md
  - .maina/wiki/features/031-landing-light-mode.md
  - .maina/wiki/features/032-mermaid-workflow-diagram.md
  - .maina/wiki/features/033-v103-quick-wins.md
  - .maina/wiki/features/034-v110-roundtrip-flywheel.md
  - .maina/wiki/features/035-wiki-foundation.md
  - .maina/wiki/index.md
  - .maina/wiki/modules/ai.md
  - .maina/wiki/modules/benchmark.md
  - .maina/wiki/modules/cache.md
  - .maina/wiki/modules/cloud.md
  - .maina/wiki/modules/cluster-0.md
  - .maina/wiki/modules/cluster-1.md
  - .maina/wiki/modules/cluster-10.md
  - .maina/wiki/modules/cluster-100.md
  - .maina/wiki/modules/cluster-101.md
  - .maina/wiki/modules/cluster-102.md
  - .maina/wiki/modules/cluster-103.md
  - .maina/wiki/modules/cluster-104.md
  - .maina/wiki/modules/cluster-105.md
  - .maina/wiki/modules/cluster-107.md
  - .maina/wiki/modules/cluster-109.md
  - .maina/wiki/modules/cluster-11.md
  - .maina/wiki/modules/cluster-110.md
  - .maina/wiki/modules/cluster-111.md
  - .maina/wiki/modules/cluster-113.md
  - .maina/wiki/modules/cluster-115.md
  - .maina/wiki/modules/cluster-116.md
  - .maina/wiki/modules/cluster-117.md
  - .maina/wiki/modules/cluster-118.md
  - .maina/wiki/modules/cluster-119.md
  - .maina/wiki/modules/cluster-121.md
  - .maina/wiki/modules/cluster-123.md
  - .maina/wiki/modules/cluster-125.md
  - .maina/wiki/modules/cluster-128.md
  - .maina/wiki/modules/cluster-129.md
  - .maina/wiki/modules/cluster-13.md
  - .maina/wiki/modules/cluster-130.md
  - .maina/wiki/modules/cluster-131.md
  - .maina/wiki/modules/cluster-132.md
  - .maina/wiki/modules/cluster-133.md
  - .maina/wiki/modules/cluster-134.md
  - .maina/wiki/modules/cluster-135.md
  - .maina/wiki/modules/cluster-136.md
  - .maina/wiki/modules/cluster-137.md
  - .maina/wiki/modules/cluster-138.md
  - .maina/wiki/modules/cluster-139.md
  - .maina/wiki/modules/cluster-14.md
  - .maina/wiki/modules/cluster-140.md
  - .maina/wiki/modules/cluster-141.md
  - .maina/wiki/modules/cluster-142.md
  - .maina/wiki/modules/cluster-143.md
  - .maina/wiki/modules/cluster-144.md
  - .maina/wiki/modules/cluster-145.md
  - .maina/wiki/modules/cluster-146.md
  - .maina/wiki/modules/cluster-147.md
  - .maina/wiki/modules/cluster-148.md
  - .maina/wiki/modules/cluster-149.md
  - .maina/wiki/modules/cluster-15.md
  - .maina/wiki/modules/cluster-150.md
  - .maina/wiki/modules/cluster-151.md
  - .maina/wiki/modules/cluster-152.md
  - .maina/wiki/modules/cluster-153.md
  - .maina/wiki/modules/cluster-154.md
  - .maina/wiki/modules/cluster-155.md
  - .maina/wiki/modules/cluster-156.md
  - .maina/wiki/modules/cluster-157.md
  - .maina/wiki/modules/cluster-158.md
  - .maina/wiki/modules/cluster-159.md
  - .maina/wiki/modules/cluster-160.md
  - .maina/wiki/modules/cluster-161.md
  - .maina/wiki/modules/cluster-162.md
  - .maina/wiki/modules/cluster-163.md
  - .maina/wiki/modules/cluster-164.md
  - .maina/wiki/modules/cluster-165.md
  - .maina/wiki/modules/cluster-166.md
  - .maina/wiki/modules/cluster-167.md
  - .maina/wiki/modules/cluster-168.md
  - .maina/wiki/modules/cluster-169.md
  - .maina/wiki/modules/cluster-17.md
  - .maina/wiki/modules/cluster-170.md
  - .maina/wiki/modules/cluster-171.md
  - .maina/wiki/modules/cluster-172.md
  - .maina/wiki/modules/cluster-173.md
  - .maina/wiki/modules/cluster-174.md
  - .maina/wiki/modules/cluster-175.md
  - .maina/wiki/modules/cluster-18.md
  - .maina/wiki/modules/cluster-19.md
  - .maina/wiki/modules/cluster-2.md
  - .maina/wiki/modules/cluster-21.md
  - .maina/wiki/modules/cluster-23.md
  - .maina/wiki/modules/cluster-24.md
  - .maina/wiki/modules/cluster-25.md
  - .maina/wiki/modules/cluster-26.md
  - .maina/wiki/modules/cluster-29.md
  - .maina/wiki/modules/cluster-3.md
  - .maina/wiki/modules/cluster-30.md
  - .maina/wiki/modules/cluster-33.md
  - .maina/wiki/modules/cluster-34.md
  - .maina/wiki/modules/cluster-35.md
  - .maina/wiki/modules/cluster-4.md
  - .maina/wiki/modules/cluster-43.md
  - .maina/wiki/modules/cluster-44.md
  - .maina/wiki/modules/cluster-45.md
  - .maina/wiki/modules/cluster-5.md
  - .maina/wiki/modules/cluster-53.md
  - .maina/wiki/modules/cluster-56.md
  - .maina/wiki/modules/cluster-6.md
  - .maina/wiki/modules/cluster-60.md
  - .maina/wiki/modules/cluster-61.md
  - .maina/wiki/modules/cluster-62.md
  - .maina/wiki/modules/cluster-64.md
  - .maina/wiki/modules/cluster-65.md
  - .maina/wiki/modules/cluster-66.md
  - .maina/wiki/modules/cluster-67.md
  - .maina/wiki/modules/cluster-68.md
  - .maina/wiki/modules/cluster-69.md
  - .maina/wiki/modules/cluster-7.md
  - .maina/wiki/modules/cluster-70.md
  - .maina/wiki/modules/cluster-71.md
  - .maina/wiki/modules/cluster-72.md
  - .maina/wiki/modules/cluster-73.md
  - .maina/wiki/modules/cluster-75.md
  - .maina/wiki/modules/cluster-77.md
  - .maina/wiki/modules/cluster-78.md
  - .maina/wiki/modules/cluster-79.md
  - .maina/wiki/modules/cluster-8.md
  - .maina/wiki/modules/cluster-81.md
  - .maina/wiki/modules/cluster-83.md
  - .maina/wiki/modules/cluster-84.md
  - .maina/wiki/modules/cluster-85.md
  - .maina/wiki/modules/cluster-86.md
  - .maina/wiki/modules/cluster-87.md
  - .maina/wiki/modules/cluster-88.md
  - .maina/wiki/modules/cluster-89.md
  - .maina/wiki/modules/cluster-9.md
  - .maina/wiki/modules/cluster-90.md
  - .maina/wiki/modules/cluster-91.md
  - .maina/wiki/modules/cluster-92.md
  - .maina/wiki/modules/cluster-93.md
  - .maina/wiki/modules/cluster-95.md
  - .maina/wiki/modules/cluster-97.md
  - .maina/wiki/modules/cluster-99.md
  - .maina/wiki/modules/commands.md
  - .maina/wiki/modules/config.md
  - .maina/wiki/modules/context.md
  - .maina/wiki/modules/db.md
  - .maina/wiki/modules/defaults.md
  - .maina/wiki/modules/design.md
  - .maina/wiki/modules/explain.md
  - .maina/wiki/modules/extractors.md
  - .maina/wiki/modules/features.md
  - .maina/wiki/modules/feedback.md
  - .maina/wiki/modules/git.md
  - .maina/wiki/modules/hooks.md
  - .maina/wiki/modules/init.md
  - .maina/wiki/modules/language.md
  - .maina/wiki/modules/linters.md
  - .maina/wiki/modules/prompts.md
  - .maina/wiki/modules/src.md
  - .maina/wiki/modules/stats.md
  - .maina/wiki/modules/ticket.md
  - .maina/wiki/modules/tools.md
  - .maina/wiki/modules/verify.md
  - .maina/wiki/modules/wiki.md
  - .maina/wiki/modules/workflow.md
  - .maina/workflow/current.md
  - MAINA_WIKI_IMPLEMENTATION_PLAN_FINAL.md
  - MAINA_WIKI_INIT_MAGIC_DOCUMENTS.md
  - MAINA_WIKI_PRODUCT_SPEC_FINAL.md
  - MAINA_WIKI_WEBSITE_BRAINSTORM.md
  - README.md
  - adr/0011-v040-polish-ci.md
  - adr/0012-v050-cloud-client-maina-cloud.md
  - bun.lock
  - install.sh
  - maina-pitchdeck.pptx
  - package.json
  - packages/cli/CHANGELOG.md
  - packages/cli/package.json
  - packages/cli/src/commands/__tests__/commit.test.ts
  - packages/cli/src/commands/__tests__/doctor.test.ts
  - packages/cli/src/commands/__tests__/explain.test.ts
  - packages/cli/src/commands/__tests__/init.test.ts
  - packages/cli/src/commands/__tests__/learn.test.ts
  - packages/cli/src/commands/__tests__/pr.test.ts
  - packages/cli/src/commands/__tests__/setup.test.ts
  - packages/cli/src/commands/__tests__/stats.test.ts
  - packages/cli/src/commands/__tests__/wiki-ingest.test.ts
  - packages/cli/src/commands/__tests__/wiki.test.ts
  - packages/cli/src/commands/doctor.ts
  - packages/cli/src/commands/explain.ts
  - packages/cli/src/commands/learn.ts
  - packages/cli/src/commands/pr.ts
  - packages/cli/src/commands/setup.ts
  - packages/cli/src/commands/stats.ts
  - packages/cli/src/commands/wiki/compile.ts
  - packages/cli/src/commands/wiki/index.ts
  - packages/cli/src/commands/wiki/ingest.ts
  - packages/cli/src/commands/wiki/init.ts
  - packages/cli/src/commands/wiki/lint.ts
  - packages/cli/src/commands/wiki/query.ts
  - packages/cli/src/commands/wiki/status.ts
  - packages/cli/src/program.ts
  - packages/core/CHANGELOG.md
  - packages/core/package.json
  - packages/core/src/ai/__tests__/delegation.test.ts
  - packages/core/src/ai/delegation.ts
  - packages/core/src/context/__tests__/budget.test.ts
  - packages/core/src/context/__tests__/engine.test.ts
  - packages/core/src/context/__tests__/selector.test.ts
  - packages/core/src/context/__tests__/wiki.test.ts
  - packages/core/src/context/budget.ts
  - packages/core/src/context/engine.ts
  - packages/core/src/context/selector.ts
  - packages/core/src/context/wiki.ts
  - packages/core/src/feedback/__tests__/tmp-capture-1775575256633-lah0etnzlj/feedback.db
  - packages/core/src/feedback/__tests__/tmp-capture-1775575256640-2xmjme4qraa/feedback.db
  - packages/core/src/feedback/signals.ts
  - packages/core/src/index.ts
  - packages/core/src/init/__tests__/init.test.ts
  - packages/core/src/init/index.ts
  - packages/core/src/language/__tests__/__fixtures__/detect/composer.lock
  - packages/core/src/prompts/defaults/index.ts
  - packages/core/src/prompts/defaults/wiki-compile.md
  - packages/core/src/prompts/defaults/wiki-query.md
  - packages/core/src/verify/__tests__/pipeline.test.ts
  - packages/core/src/verify/pipeline.ts
  - packages/core/src/verify/tools/__tests__/wiki-lint.test.ts
  - packages/core/src/verify/tools/wiki-lint-runner.ts
  - packages/core/src/verify/tools/wiki-lint.ts
  - packages/core/src/wiki/__tests__/compiler.test.ts
  - packages/core/src/wiki/__tests__/extractors/code.test.ts
  - packages/core/src/wiki/__tests__/extractors/decision.test.ts
  - packages/core/src/wiki/__tests__/extractors/feature.test.ts
  - packages/core/src/wiki/__tests__/extractors/workflow.test.ts
  - packages/core/src/wiki/__tests__/graph.test.ts
  - packages/core/src/wiki/__tests__/hooks.test.ts
  - packages/core/src/wiki/__tests__/indexer.test.ts
  - packages/core/src/wiki/__tests__/linker.test.ts
  - packages/core/src/wiki/__tests__/louvain.test.ts
  - packages/core/src/wiki/__tests__/query.test.ts
  - packages/core/src/wiki/__tests__/schema.test.ts
  - packages/core/src/wiki/__tests__/signals.test.ts
  - packages/core/src/wiki/__tests__/state.test.ts
  - packages/core/src/wiki/__tests__/tracking.test.ts
  - packages/core/src/wiki/__tests__/types.test.ts
  - packages/core/src/wiki/compiler.ts
  - packages/core/src/wiki/extractors/code.ts
  - packages/core/src/wiki/extractors/decision.ts
  - packages/core/src/wiki/extractors/feature.ts
  - packages/core/src/wiki/extractors/workflow.ts
  - packages/core/src/wiki/graph.ts
  - packages/core/src/wiki/hooks.ts
  - packages/core/src/wiki/indexer.ts
  - packages/core/src/wiki/linker.ts
  - packages/core/src/wiki/louvain.ts
  - packages/core/src/wiki/prompts/compile-architecture.md
  - packages/core/src/wiki/prompts/compile-decision.md
  - packages/core/src/wiki/prompts/compile-entity.md
  - packages/core/src/wiki/prompts/compile-feature.md
  - packages/core/src/wiki/prompts/compile-module.md
  - packages/core/src/wiki/prompts/wiki-query.md
  - packages/core/src/wiki/query.ts
  - packages/core/src/wiki/schema.ts
  - packages/core/src/wiki/signals.ts
  - packages/core/src/wiki/state.ts
  - packages/core/src/wiki/tracking.ts
  - packages/core/src/wiki/types.ts
  - packages/core/src/workflow/context.ts
  - packages/docs/astro.config.mjs
  - packages/docs/bun.lock
  - packages/docs/package.json
  - packages/docs/src/components/Features.astro
  - packages/docs/src/components/Hero.astro
  - packages/docs/src/components/Terminal.astro
  - packages/docs/src/content/docs/cloud.mdx
  - packages/docs/src/content/docs/commands.mdx
  - packages/docs/src/content/docs/engines/verify.mdx
  - packages/docs/src/content/docs/getting-started.mdx
  - packages/docs/src/content/docs/mcp.mdx
  - packages/docs/src/content/docs/roadmap.mdx
  - packages/docs/src/content/docs/skills.mdx
  - packages/docs/src/content/docs/wiki.mdx
  - packages/docs/src/pages/index.astro
  - packages/mcp/CHANGELOG.md
  - packages/mcp/package.json
  - packages/mcp/src/__tests__/server.test.ts
  - packages/mcp/src/server.ts
  - packages/mcp/src/tools/__tests__/wiki.test.ts
  - packages/mcp/src/tools/wiki.ts
  - packages/skills/CHANGELOG.md
  - packages/skills/__tests__/skills.test.ts
  - packages/skills/cloud-workflow/SKILL.md
  - packages/skills/code-review/SKILL.md
  - packages/skills/context-generation/SKILL.md
  - packages/skills/onboarding/SKILL.md
  - packages/skills/package.json
  - packages/skills/plan-writing/SKILL.md
  - packages/skills/tdd/SKILL.md
  - packages/skills/verification-workflow/SKILL.md
  - packages/skills/wiki-workflow/SKILL.md
Updated at: 2026-04-07T18:54:04.003Z

## Project Constitution

# Project Constitution

Non-negotiable rules. Injected into every AI call. Not subject to A/B testing.
Updated: 2026-04-03 (Sprint 9)

## Stack
- Runtime: Bun (NOT Node.js)
- Language: TypeScript strict mode
- Lint/Format: Biome 2.x (NOT ESLint/Prettier)
- Test: bun:test (NOT Jest/Vitest)
- Build: bunup
- CLI: Commander 13 + @clack/prompts
- AI: Vercel AI SDK v6 via OpenRouter (host delegation when inside Claude Code/Cursor)
- DB: bun:sqlite + Drizzle ORM (split by purpose: context, cache, feedback, stats)
- AST: web-tree-sitter
- MCP: @modelcontextprotocol/sdk (stdio transport)

## Architecture
- Three engines: Context (observes), Prompt (learns), Verify (verifies)
- 20 CLI commands, 8 MCP tools, 5 cross-platform skills
- All DB access through repository layer (getContextDb, getCacheDb, getFeedbackDb, getStatsDb)
- Error handling: Result<T, E> pattern. Never throw.
- Single LLM call per command (exception: PR review gets two)
- Each command declares its context needs via selector
- AI output validated by slop guard before reaching user
- Shared utilities in packages/core/src/utils.ts (toKebabCase, extractAcceptanceCriteria)
- tryAIGenerate() is the single entry point for all AI calls

## Context Engine
- 4 layers: Working → Episodic → Semantic → Retrieval
- Every maina commit writes episodic entry + working context + stats snapshot
- Semantic index: tree-sitter entities + PageRank dependency graph (persisted to DB)
- Retrieval: ripgrep/grep with auto-generated search queries from recent changes
- Dynamic budget: 40% focused, 60% default, 80% explore

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- Syntax guard rejects before other gates run
- Diff-only: only report findings on changed lines
- Slop detector cached via CacheManager in pipeline
- Preferences.json tracks noisy rules (high false positive rate)
- Spec quality scored 0-100 (measurability, testability, ambiguity, completeness)
- Skip events tracked in stats.db

## Feedback Loop
- Every AI call records prompt hash + outcome to feedback.db
- Accepted reviews compressed to <500 tokens as episodic few-shot examples
- A/B testing: candidates auto-promoted at >5% improvement, retired at <-5%
- maina learn analyzes feedback and proposes prompt improvements

## Workflow Order (mandatory, sequential)

Every feature follows this exact sequence using maina CLI/MCP tools. No skipping steps.

```
maina brainstorm  → explore idea, generate structured ticket
maina ticket      → create GitHub Issue with module tagging
maina plan <name> → scaffold feature branch + directory
maina design      → create ADR (+ HLD/LLD with --hld)
maina spec        → generate TDD test stubs from plan
implement         → write code (TDD: red → green → refactor)
maina verify      → run full verification pipeline
maina review      → comprehensive code review
fix               → address review findings
maina commit      → verify + commit staged changes
maina review      → final review pass
maina pr          → create PR with verification proof
```

Between steps, use MCP tools for continuous checks:
- `getContext` — before any AI-assisted step
- `checkSlop` — after writing code
- `reviewCode` — before committing
- `verify` — before PRs
- `analyzeFeature` — check spec/plan/task consistency

## Conventions
- Conventional commits: scopes are cli, core, mcp, skills, docs, ci
- TDD: write tests before implementation (5 categories: happy, edge, error, security, integration)
- WHAT/WHY in spec.md, HOW in plan.md — never mixed
- [NEEDS CLARIFICATION] markers for ambiguity — never guess
- Dogfood: use maina CLI/MCP tools for the entire workflow — never raw git commit, never skip maina tools
- Self-improvement: after each commit run stats + review + context check
- No console.log in production code

## Related Projects

Cross-repo dogfooding flywheel. Report issues to each other with `maina ticket --repo <name>`.

| Project | Path | Repo | Relationship |
|---------|------|------|-------------|
| maina-cloud | mainahq/maina-cloud | mainahq/maina-cloud (private) | Cloud backend — consumes maina's API types, runs verification pipeline |
| workkit | mainahq/workkit | mainahq/workkit | CF Workers utilities — @workkit/* packages power maina-cloud |

- **maina → maina-cloud:** API type changes here must be synced to cloud. Cloud bugs found during CLI testing → `maina ticket --repo maina-cloud`
- **maina → workkit:** @workkit bugs found during maina-cloud development → `maina ticket --repo workkit`
- **maina-cloud → maina:** CLI client bugs or missing features → `maina ticket --repo maina`
- **workkit → maina:** Verification pipeline bugs found during Workkit dogfooding → `maina ticket --repo maina`

## Codebase Overview

### packages/core/src/wiki/types.ts (relevance: 0.0909)
- `ArticleType` (type)
- `EdgeType` (type)
- `WikiLink` (interface)
- `WikiArticle` (interface)
- `TaskItem` (interface)
- `ExtractedFeature` (interface)
- `DecisionStatus` (type)
- `ExtractedDecision` (interface)
- `WorkflowStep` (interface)
- `RLSignal` (interface)
- `ExtractedWorkflowTrace` (interface)
- `WikiState` (interface)
- `WikiLintCheck` (type)
- `WikiLintFinding` (interface)
- `WikiLintResult` (interface)
- `DECAY_HALF_LIVES` (variable)

### packages/core/src/db/index.ts (relevance: 0.0656)
- `DbHandle` (type)
- `ok` (function)
- `err` (function)
- `createContextTables` (function)
- `createCacheTables` (function)
- `createFeedbackTables` (function)
- `createStatsTables` (function)
- `initDatabase` (function)
- `getContextDb` (function)
- `getCacheDb` (function)
- `getFeedbackDb` (function)
- `getStatsDb` (function)

### packages/core/src/db/schema.ts (relevance: 0.0558)
- `episodicEntries` (variable)
- `semanticEntities` (variable)
- `dependencyEdges` (variable)
- `cacheEntries` (variable)
- `feedback` (variable)
- `commitSnapshots` (variable)
- `promptVersions` (variable)

### packages/cli/src/json.ts (relevance: 0.0471)
- `EXIT_PASSED` (variable)
- `EXIT_FINDINGS` (variable)
- `EXIT_TOOL_FAILURE` (variable)
- `EXIT_CONFIG_ERROR` (variable)
- `outputJson` (function)
- `exitCodeFromResult` (function)

### packages/core/src/context/budget.ts (relevance: 0.0256)
- `BudgetMode` (type)
- `BudgetAllocation` (interface)
- `LayerContent` (interface)
- `DEFAULT_MODEL_CONTEXT_WINDOW` (variable)
- `calculateTokens` (function)
- `getBudgetRatio` (function)
- `assembleBudget` (function)
- `truncateToFit` (function)

### packages/core/src/wiki/state.ts (relevance: 0.0201)
- `STATE_FILE` (variable)
- `hashContent` (function)
- `hashFile` (function)
- `createEmptyState` (function)
- `loadState` (function)
- `saveState` (function)
- `getChangedFiles` (function)

### packages/core/src/wiki/extractors/code.ts (relevance: 0.0170)
- `CodeEntity` (interface)
- `extractFromFile` (function)
- `extractCodeEntities` (function)

### packages/core/src/wiki/signals.ts (relevance: 0.0146)
- `WikiEffectivenessSignal` (interface)
- `CompilationPromptSignal` (interface)
- `ArticleLoadSignal` (interface)
- `WikiEffectivenessReport` (interface)
- `SignalsStore` (interface)
- `SIGNALS_FILE` (variable)
- `signalsPath` (function)
- `loadSignals` (function)
- `saveSignals` (function)
- `recordWikiUsage` (function)
- `getPromptEffectiveness` (function)
- `calculateEbbinghausScore` (function)
- `recordArticlesLoaded` (function)
- `getWikiEffectivenessReport` (function)
- `inferArticleType` (function)

### packages/mcp/src/server.ts (relevance: 0.0143)
- `createMcpServer` (function)
- `startServer` (function)

### packages/core/src/workflow/context.ts (relevance: 0.0140)
- `workflowFilePath` (function)
- `resetWorkflowContext` (function)
- `appendWorkflowStep` (function)
- `appendWikiRefs` (function)
- `loadWorkflowContext` (function)

### packages/core/src/wiki/extractors/feature.ts (relevance: 0.0131)
- `readOptionalFile` (function)
- `extractTitle` (function)
- `extractTasks` (function)
- `extractSpecAssertions` (function)
- `extractScope` (function)
- `extractSingleFeature` (function)
- `extractFeatures` (function)

### packages/core/src/wiki/extractors/decision.ts (relevance: 0.0131)
- `parseSections` (function)
- `extractId` (function)
- `extractTitle` (function)
- `normalizeStatus` (function)
- `extractBulletItems` (function)
- `extractEntityMentions` (function)
- `extractSingleDecision` (function)
- `extractDecisions` (function)

### packages/core/src/wiki/graph.ts (relevance: 0.0121)
- `GraphNode` (interface)
- `GraphEdge` (interface)
- `KnowledgeGraph` (interface)
- `addNode` (function)
- `addEdge` (function)
- `deriveModule` (function)
- `addCodeEntities` (function)
- `addFeatures` (function)
- `addDecisions` (function)
- `addWorkflowTraces` (function)
- `buildKnowledgeGraph` (function)
- `computePageRank` (function)
- `mapToArticles` (function)

### packages/core/src/wiki/compiler.ts (relevance: 0.0121)
- `CompilationResult` (interface)
- `CompileOptions` (interface)
- `enhanceWithAI` (function)
- `findSourceFiles` (function)
- `generateModuleArticle` (function)
- `generateEntityArticle` (function)
- `generateFeatureArticle` (function)
- `generateDecisionArticle` (function)
- `ArchitectureArticle` (interface)
- `generateThreeEnginesArticle` (function)
- `generateMonorepoArticle` (function)
- `generateVerifyPipelineArticle` (function)
- `generateArchitectureArticles` (function)
- `makeArticle` (function)
- `compile` (function)

### packages/core/src/wiki/louvain.ts (relevance: 0.0109)
- `LouvainNode` (interface)
- `LouvainResult` (interface)
- `totalEdges` (function)
- `computeModularity` (function)
- `detectCommunities` (function)

### packages/core/src/wiki/extractors/workflow.ts (relevance: 0.0109)
- `extractFeatureId` (function)
- `parseSteps` (function)
- `extractWorkflowTrace` (function)

### packages/core/src/verify/tools/wiki-lint.ts (relevance: 0.0103)
- `WikiLintOptions` (interface)
- `collectMarkdownFiles` (function)
- `extractWikiLinks` (function)
- `getArticleTypeFromPath` (function)
- `getArticleId` (function)
- `buildArticleIndex` (function)
- `emptyResult` (function)
- `checkStale` (function)
- `checkMissing` (function)
- `checkOrphans` (function)
- `checkBrokenLinks` (function)
- `calculateCoverage` (function)
- `collectSourceFiles` (function)
- `checkSpecDrift` (function)
- `TechConstraint` (interface)
- `TECH_CONSTRAINTS` (variable)
- `checkDecisionViolations` (function)
- `countFileCommits` (function)
- `checkMissingRationale` (function)
- `checkContradictions` (function)
- `checkFeatureTaskContradiction` (function)
- `runWikiLint` (function)
- `wikiLintToFindings` (function)

### packages/core/src/ai/delegation.ts (relevance: 0.0101)
- `DelegationRequest` (interface)
- `START_MARKER` (variable)
- `END_MARKER` (variable)
- `formatDelegationRequest` (function)
- `parseDelegationRequest` (function)
- `outputDelegationRequest` (function)

### packages/cli/src/commands/explain.ts (relevance: 0.0100)
- `ExplainActionOptions` (interface)
- `ExplainActionResult` (interface)
- `ExplainDeps` (interface)
- `defaultDeps` (variable)
- `formatSummaryTable` (function)
- `findWikiArticle` (function)
- `saveToWikiRaw` (function)
- `explainAction` (function)
- `displayExplain` (function)
- `explainCommand` (function)

### packages/cli/src/commands/stats.ts (relevance: 0.0100)
- `StatsActionOptions` (interface)
- `SpecScore` (interface)
- `SpecsResult` (interface)
- `WikiMetrics` (interface)
- `StatsActionResult` (interface)
- `StatsDeps` (interface)
- `defaultDeps` (variable)
- `trendArrow` (function)
- `formatDurationSec` (function)
- `formatUtilization` (function)
- `countMdInDir` (function)
- `gatherWikiMetrics` (function)
- `statsAction` (function)
- `displaySpecs` (function)
- `displayStats` (function)
- `displayWikiMetrics` (function)
- `displayComparison` (function)
- `statsCommand` (function)

### packages/core/src/init/index.ts (relevance: 0.0098)
- `InitOptions` (interface)
- `InitReport` (interface)
- `DetectedStack` (interface)
- `detectStack` (function)
- `WORKFLOW_ORDER` (variable)
- `MCP_TOOLS_TABLE` (variable)
- `buildConstitution` (function)
- `buildAgentsMd` (function)
- `buildCopilotInstructions` (function)
- `MERGEABLE_AGENT_FILES` (variable)
- `buildMainaSection` (function)


## Episodic Context

### [review] Accepted review (relevance: 1.00)
[review] Accepted review
Files: src/index.ts
Findings:
  - Overall: code looks good. Warning: missing null check.
Verdict: Overall: code looks good. Warning: missing null check.

### [review] Accepted review (relevance: 1.00)
[review] Accepted review
Files: src/index.ts
Findings:
  - Overall: code looks good. Warning: missing null check.
Verdict: Overall: code looks good. Warning: missing null check.

### [review] Accepted review (relevance: 1.00)
[review] Accepted review
Files: src/index.ts
Findings:
  - Overall: code looks good. Warning: missing null check.
Verdict: Overall: code looks good. Warning: missing null check.

### [commit] 1e9fcaa: fix(cli): increase init test timeout to 30s for ci runners (relevance: 1.00)
Commit 1e9fcaa on feature/035-wiki-foundation: 1 file(s), 0 finding(s), 12 tool(s), 11111ms verify

### [commit] e2a46f2: fix(core): update pipeline test assertions for wiki-lint tool addition (relevance: 1.00)
Commit e2a46f2 on feature/035-wiki-foundation: 1 file(s), 1 finding(s), 12 tool(s), 10998ms verify

### [commit] ff9a36a: fix(cli): add missing mock exports in commit test for emitAcceptSignal (relevance: 1.00)
Commit ff9a36a on feature/035-wiki-foundation: 1 file(s), 0 finding(s), 12 tool(s), 11785ms verify

### [commit] 0aa910e: fix(cli,mcp): use @mainahq/core import, fix implicit any type (relevance: 1.00)
Commit 0aa910e on feature/035-wiki-foundation: 3 file(s), 1 finding(s), 12 tool(s), 11713ms verify

### [commit] 047010e: docs: update all pages for v1.2.0 — wiki, install script, 12-tool support (relevance: 1.00)
Commit 047010e on feature/035-wiki-foundation: 9 file(s), 7 finding(s), 12 tool(s), 11529ms verify

### [commit] 27e4d57: feat(cli): universal install script with auto ide detection and mcp setup (relevance: 1.00)
Commit 27e4d57 on feature/035-wiki-foundation: 1 file(s), 1 finding(s), 12 tool(s), 11923ms verify

### [commit] 5f98532: feat(core): support 12 ai coding tools — windsurf, cline, continue, roo, amazon q, zed, aider (relevance: 0.99)
Commit 5f98532 on feature/035-wiki-foundation: 15 file(s), 6 finding(s), 12 tool(s), 11212ms verify

### [commit] de8f859: chore: version packages to v1.1.0 (relevance: 0.99)
Commit de8f859 on feature/035-wiki-foundation: 390 file(s), 4 finding(s), 12 tool(s), 11019ms verify

### [commit] 3ae23de: chore: add changeset for v1.2.0 wiki feature (relevance: 0.99)
Commit 3ae23de on feature/035-wiki-foundation: 1 file(s), 0 finding(s), 12 tool(s), 11818ms verify

### [commit] f22fbde: fix(core): mcp stdout corruption, setup command, onboarding improvements (relevance: 0.99)
Commit f22fbde on feature/035-wiki-foundation: 8 file(s), 4 finding(s), 12 tool(s), 12765ms verify

### [commit] 7febb7e: feat(core): llm compilation, advanced lint checks, rl wiring, wiki_refs tracking (relevance: 0.99)
Commit 7febb7e on feature/035-wiki-foundation: 18 file(s), 5 finding(s), 12 tool(s), 11321ms verify

### [commit] 88ca308: fix(core): use source ids for wiki filenames to fix broken wikilinks (relevance: 0.99)
Commit 88ca308 on feature/035-wiki-foundation: 1 file(s), 1 finding(s), 12 tool(s), 11775ms verify

### [commit] bab4d90: feat(core): wiki ai query, context L5, command enhancements, prompt templates (relevance: 0.99)
Commit bab4d90 on feature/035-wiki-foundation: 37 file(s), 8 finding(s), 12 tool(s), 9980ms verify

### [commit] 4672862: feat(core): enrich wiki — ADR fix, architecture, compiler wiring, lint, ingest (relevance: 0.99)
Commit 4672862 on feature/035-wiki-foundation: 19 file(s), 0 finding(s), 0 tool(s), 0ms verify

### [commit] 33d1d08: feat(core,cli,mcp): wiki Sprints 1-6 — graph, compiler, CLI, lint, RL signals, MCP tools (relevance: 0.98)
Commit 33d1d08 on feature/035-wiki-foundation: 24 file(s), 0 finding(s), 0 tool(s), 0ms verify

### [commit] 958a483: feat(core): wiki foundation — types, state, schema, 4 extractors (Sprint 0) (relevance: 0.98)
Commit 958a483 on feature/035-wiki-foundation: 16 file(s), 0 finding(s), 0 tool(s), 0ms verify

### [commit] 25e1f2e: fix(cli): chunk feedback batch upload to avoid timeouts (relevance: 0.92)
Commit 25e1f2e on master: 1 file(s), 0 finding(s), 10 tool(s), 12735ms verify

### [commit] ad7684b: feat(core): auto-sync feedback to cloud on every command for logged-in users (relevance: 0.92)
Commit ad7684b on master: 1 file(s), 0 finding(s), 10 tool(s), 12366ms verify

### [commit] 421c9a4: feat(core): add workflow stats sync to learn --cloud for analytics dashboard (relevance: 0.92)
Commit 421c9a4 on master: 4 file(s), 0 finding(s), 10 tool(s), 15616ms verify

### [commit] aad6ac1: fix(cli): update doctor test version assertion to 1.0.0 (relevance: 0.92)
Commit aad6ac1 on master: 1 file(s), 0 finding(s), 10 tool(s), 12237ms verify

### [commit] 8489e70: docs: add Show HN draft for v1.0 launch (relevance: 0.92)
Commit 8489e70 on feature/027-v10-launch: 1 file(s), 0 finding(s), 10 tool(s), 12503ms verify

### [commit] 0dbaeae: chore: transfer repos to mainahq org, update all references (relevance: 0.92)
Commit 0dbaeae on feature/027-v10-launch: 22 file(s), 0 finding(s), 10 tool(s), 11145ms verify

### [commit] 5ecb1e5: feat: fix brainstorm stubs (#47), add community files for v1.0 launch (relevance: 0.92)
Commit 5ecb1e5 on feature/027-v10-launch: 7 file(s), 0 finding(s), 10 tool(s), 11512ms verify

### [commit] 53173e9: feat(core): scaffold v1.0.0 launch — spec, plan, tasks (relevance: 0.92)
Commit 53173e9 on feature/027-v10-launch: 3 file(s), 0 finding(s), 10 tool(s), 11670ms verify

### [commit] 4505f0e: feat(core): add copilot-instructions.md to maina init, configure MCP for Copilot agent (relevance: 0.92)
Commit 4505f0e on master: 3 file(s), 0 finding(s), 10 tool(s), 10853ms verify

### [commit] ec0bfe6: fix(docs): update base URL to mainahq.com, fix double-slash links (relevance: 0.92)
Commit ec0bfe6 on master: 5 file(s), 0 finding(s), 10 tool(s), 11731ms verify

### [commit] 6113230: feat(core,cli): daily audit workflow, cloud RL endpoints, learn --cloud (relevance: 0.92)
Commit 6113230 on feature/026-v07-rl-flywheel: 10 file(s), 0 finding(s), 10 tool(s), 11478ms verify

### [commit] 2066ae5: feat(core): scaffold v0.7.0 feature — RL flywheel, dashboard, billing spec + plan (relevance: 0.92)
Commit 2066ae5 on feature/026-v07-rl-flywheel: 3 file(s), 0 finding(s), 10 tool(s), 11634ms verify

### [commit] 7275155: fix(core): map snake_case API responses for verify cloud client (relevance: 0.91)
Commit 7275155 on feature/025-v06-hosted-verification: 1 file(s), 0 finding(s), 10 tool(s), 10987ms verify

### [commit] 02eab2a: docs: update docs for v0.6.0 — cloud verify, CI page, changeset (relevance: 0.91)
Commit 02eab2a on feature/025-v06-hosted-verification: 7 file(s), 0 finding(s), 10 tool(s), 11739ms verify

### [commit] ee44a5c: fix(core): fix cloud API snake_case mapping, update default URL to api.mainahq.com (relevance: 0.91)
Commit ee44a5c on feature/025-v06-hosted-verification: 9 file(s), 3 finding(s), 10 tool(s), 11263ms verify

### [commit] ec5e387: feat(core,cli): add cloud verification — shared types, client methods, --cloud flag (#52) (relevance: 0.91)
Commit ec5e387 on feature/025-v06-hosted-verification: 9 file(s), 0 finding(s), 10 tool(s), 10712ms verify

### [commit] 345ebd5: feat(core): scaffold v0.6.0 feature — spec, plan, tasks for hosted verification (relevance: 0.91)
Commit 345ebd5 on feature/025-v06-hosted-verification: 3 file(s), 0 finding(s), 10 tool(s), 11743ms verify

### [commit] 97e53f8: docs: add v0.6.0 hosted verification design spec (relevance: 0.91)
Commit 97e53f8 on master: 1 file(s), 0 finding(s), 10 tool(s), 10837ms verify

### [commit] 0bcf028: docs: update all docs for v0.5.0 — cloud, --json, PHP, exit codes, CI (relevance: 0.80)
Commit 0bcf028 on master: 4 file(s), 0 finding(s), 10 tool(s), 10086ms verify

### [commit] c978eff: chore: add changeset for v0.5.0 npm release (relevance: 0.80)
Commit c978eff on master: 1 file(s), 0 finding(s), 10 tool(s), 10519ms verify

### [commit] 1ba1501: chore: add publishConfig access public to all packages (relevance: 0.80)
Commit 1ba1501 on master: 4 file(s), 0 finding(s), 10 tool(s), 19150ms verify

### [commit] 4c75f70: chore: version packages v0.5.0 (relevance: 0.80)
Commit 4c75f70 on master: 9 file(s), 0 finding(s), 10 tool(s), 10251ms verify

### [commit] 40c07ae: feat(cli): move repo aliases to .maina/config.json for portability (relevance: 0.80)
Commit 40c07ae on feature/024-v05-cloud-client: 2 file(s), 0 finding(s), 10 tool(s), 11138ms verify

### [commit] aa5a7b7: feat(cli): add --repo flag to maina ticket for cross-repo issues (relevance: 0.80)
Commit aa5a7b7 on feature/024-v05-cloud-client: 3 file(s), 0 finding(s), 10 tool(s), 12847ms verify

### [commit] 67048ef: feat(core): add cloud client, auth, login/sync/team commands (relevance: 0.80)
Commit 67048ef on feature/024-v05-cloud-client: 11 file(s), 0 finding(s), 10 tool(s), 10427ms verify

### [commit] 9e8cb6d: feat(core): scaffold feature 024-v05-cloud-client (relevance: 0.80)
Commit 9e8cb6d on feature/024-v05-cloud-client: 6 file(s), 1 finding(s), 10 tool(s), 11632ms verify

### [commit] 9cc1a34: docs: add PR check integration alongside Copilot/CodeRabbit/DeepSource (relevance: 0.80)
Commit 9cc1a34 on feature/024-v04-polish-ci: 2 file(s), 0 finding(s), 10 tool(s), 11254ms verify

### [commit] 3d3ca94: docs: add autonomous workflow action and self-improvement loop to roadmap (relevance: 0.80)
Commit 3d3ca94 on feature/024-v04-polish-ci: 2 file(s), 0 finding(s), 10 tool(s), 10842ms verify

### [commit] 9c3f5ac: feat(core): add GitHub Action, PHP, per-file detect, ZAP, Lighthouse (relevance: 0.79)
Commit 9c3f5ac on feature/024-v04-polish-ci: 12 file(s), 2 finding(s), 10 tool(s), 12092ms verify

### [commit] 4f85801: feat(cli): add --json flag and exit codes to all commands (relevance: 0.79)
Commit 4f85801 on feature/024-v04-polish-ci: 9 file(s), 0 finding(s), 10 tool(s), 11289ms verify

### [commit] eea41aa: feat(core): scaffold feature 024-v04-polish-ci (relevance: 0.79)
Commit eea41aa on feature/024-v04-polish-ci: 6 file(s), 1 finding(s), 10 tool(s), 11297ms verify

### [commit] 8310d49: docs: update roadmap and plan for v0.4-v1.0 path (relevance: 0.79)
Commit 8310d49 on feature/024-v03x-hardening: 5 file(s), 1 finding(s), 10 tool(s), 11499ms verify

### [commit] 7f88a45: feat(core): add --auto flags, RL trace analysis, export new modules (relevance: 0.79)
Commit 7f88a45 on feature/024-v03x-hardening: 6 file(s), 0 finding(s), 8 tool(s), 11566ms verify

### [commit] 78cd090: feat(core): add built-in typecheck, consistency check, and Biome init (relevance: 0.79)
Commit 78cd090 on feature/024-v03x-hardening: 8 file(s), 1 finding(s), 8 tool(s), 11462ms verify

### [commit] 643b78a: fix(core): add mock.module() isolation note to pipeline test — tests must run via bun run test (relevance: 0.79)
Commit 643b78a on feature/024-v03x-hardening: 1 file(s), 0 finding(s), 8 tool(s), 12200ms verify

### [commit] 7b75c7c: feat(core): scaffold feature 024-v03x-hardening — spec, plan, ADR, tasks, constitution update (relevance: 0.79)
Commit 7b75c7c on feature/024-v03x-hardening: 7 file(s), 0 finding(s), 8 tool(s), 11894ms verify

### [commit] f925674: docs: apply bold + orange dot logo style to Starlight docs header (relevance: 0.75)
Commit f925674 on master: 1 file(s), 0 finding(s), 8 tool(s), 11002ms verify

### [commit] 97cb3ab: docs: update logo to bold sans + orange dot with aligned bird icon (relevance: 0.75)
Commit 97cb3ab on master: 2 file(s), 0 finding(s), 8 tool(s), 12116ms verify

### [commit] c181a1f: docs: fix all install commands to @mainahq/cli, update tool counts to 16 (relevance: 0.75)
Commit c181a1f on master: 2 file(s), 0 finding(s), 8 tool(s), 11455ms verify

### [commit] 4e51d9e: docs: add llms.txt, structured data, OG tags for LLM optimization (relevance: 0.75)
Commit 4e51d9e on master: 3 file(s), 0 finding(s), 8 tool(s), 10933ms verify

### [commit] 5b302d9: docs: fix terminal demo — correct install command and 8-tool verify output (relevance: 0.74)
Commit 5b302d9 on master: 1 file(s), 0 finding(s), 8 tool(s), 11219ms verify

### [commit] 19830f8: docs: redesign landing page — marketing-focused hero, updated features (relevance: 0.74)
Commit 19830f8 on master: 2 file(s), 0 finding(s), 8 tool(s), 12660ms verify

### [commit] e5a82ae: docs: update for v0.3.0 — 25 commands, 6 languages, 16 tools, AI delegation (relevance: 0.74)
Commit e5a82ae on master: 6 file(s), 0 finding(s), 8 tool(s), 11742ms verify

### [commit] 63023a2: feat(core): add C#/.NET and Java/Kotlin language support (relevance: 0.74)
Commit 63023a2 on feature/022-brainstorm-command: 3 file(s), 0 finding(s), 8 tool(s), 10789ms verify

### [commit] 30247e5: feat(cli): add maina brainstorm — interactive idea exploration for tickets (relevance: 0.74)
Commit 30247e5 on feature/022-brainstorm-command: 13 file(s), 0 finding(s), 8 tool(s), 12176ms verify

### [commit] 7b12c75: feat(core): structured AI delegation protocol for host agents (relevance: 0.74)
Commit 7b12c75 on feature/021-ai-delegation-protocol: 4 file(s), 0 finding(s), 8 tool(s), 11166ms verify

### [commit] c76722d: docs(core): add spec + ADR for AI delegation protocol (feature 021) (relevance: 0.74)
Commit c76722d on feature/021-ai-delegation-protocol: 2 file(s), 0 finding(s), 8 tool(s), 11150ms verify

### [commit] 8cc3307: chore: rename packages from @maina to @mainahq (relevance: 0.74)
Commit 8cc3307 on master: 49 file(s), 2 finding(s), 8 tool(s), 10820ms verify

### [commit] fab501c: docs: rewrite README for DevRel, add docs site links to all packages (relevance: 0.74)
Commit fab501c on master: 6 file(s), 0 finding(s), 8 tool(s), 12133ms verify

### [commit] b7087ee: docs: update landing page stats — 990 tests, 12 tools, 4 languages, 24 commands (relevance: 0.74)
Commit b7087ee on master: 1 file(s), 0 finding(s), 8 tool(s), 10430ms verify

### [commit] 8512b0b: docs: add v0.2.0 benchmark results — 100% validation (was 97.9%) (relevance: 0.73)
Commit 8512b0b on master: 1 file(s), 0 finding(s), 8 tool(s), 10506ms verify

### [commit] 3ab3f73: docs: update docs site — 24 commands, multi-language, visual, workflow, roadmap (relevance: 0.73)
Commit 3ab3f73 on master: 3 file(s), 0 finding(s), 8 tool(s), 12920ms verify

### [commit] 840bb07: feat(cli): add maina configure command for interactive project settings (relevance: 0.73)
Commit 840bb07 on master: 2 file(s), 2 finding(s), 8 tool(s), 9992ms verify

### [commit] 0ffd3ed: fix(core): version slop cache keys to invalidate on detection logic changes (relevance: 0.73)
Commit 0ffd3ed on master: 1 file(s), 0 finding(s), 8 tool(s), 10222ms verify

### [commit] 37b2381: fix(core): add migration for skipped column in stats — fixes stats recording (relevance: 0.73)
Commit 37b2381 on master: 1 file(s), 0 finding(s), 8 tool(s), 10636ms verify

### [commit] 12c0777: fix(mcp): add missing main entry point + audit findings (relevance: 0.73)
Commit 12c0777 on master: 2 file(s), 0 finding(s), 8 tool(s), 11383ms verify

### [commit] 237ca38: docs: add package READMEs + update changeset for initial release (relevance: 0.73)
Commit 237ca38 on master: 4 file(s), 0 finding(s), 8 tool(s), 10542ms verify

### [commit] ec393c8: docs: remove language-specific naming, fix slop .md false positives, add session audit (relevance: 0.73)
Commit ec393c8 on master: 6 file(s), 0 finding(s), 8 tool(s), 11074ms verify

### [commit] 765846c: feat(core): clean host delegation — structured DelegationPrompt for Claude Code/Codex (relevance: 0.73)
Commit 765846c on feature/020-unified-host-delegation: 1 file(s), 0 finding(s), 8 tool(s), 10717ms verify

### [commit] a071c06: feat(core): unified host delegation — structured prompts for Claude Code/Codex/OpenCode (relevance: 0.73)
Commit a071c06 on feature/020-unified-host-delegation: 6 file(s), 0 finding(s), 8 tool(s), 10625ms verify

### [commit] a2832ff: feat(cli): add --install flag to maina init + complete tool install hints (relevance: 0.73)
Commit a2832ff on feature/019-tool-install-guide: 2 file(s), 0 finding(s), 8 tool(s), 25363ms verify

### [commit] 1e21254: feat(core,cli): add verification proof artifacts to PR body (relevance: 0.73)
Commit 1e21254 on feature/018-verification-proof-pr: 5 file(s), 0 finding(s), 8 tool(s), 8898ms verify

### [commit] 9b4c714: docs(core): add spec + ADR for verification proof in PRs (feature 018) (relevance: 0.73)
Commit 9b4c714 on feature/018-verification-proof-pr: 2 file(s), 0 finding(s), 8 tool(s), 9491ms verify

### [commit] e1c252d: fix(core): fix tool detection for multi-arg version flags + visual QA baselines (relevance: 0.73)
Commit e1c252d on master: 5 file(s), 0 finding(s), 8 tool(s), 9090ms verify

### [commit] 7acb3d6: fix(core): wire A/B test into prompt resolution + learn --no-interactive + MCP review feedback (relevance: 0.73)
Commit 7acb3d6 on fix/ab-test-wiring-and-learn-cli: 3 file(s), 0 finding(s), 8 tool(s), 8720ms verify

### [commit] 2fa6f84: feat(core): add visual verification module with Playwright + pixel comparison (relevance: 0.73)
Commit 2fa6f84 on feature/017-visual-verification: 8 file(s), 0 finding(s), 8 tool(s), 8716ms verify

### [commit] 2f9181f: docs(core): add spec + ADR for visual verification with Playwright (feature 017) (relevance: 0.73)
Commit 2f9181f on feature/017-visual-verification: 2 file(s), 0 finding(s), 8 tool(s), 9091ms verify

### [commit] 66c8efa: feat(core,cli): post-workflow RL analysis in maina learn (relevance: 0.73)
Commit 66c8efa on feature/016-post-workflow-rl: 4 file(s), 0 finding(s), 8 tool(s), 9380ms verify

### [commit] a5354c3: docs(core): add spec + ADR for post-workflow RL loop (feature 016) (relevance: 0.73)
Commit a5354c3 on feature/016-post-workflow-rl: 2 file(s), 0 finding(s), 8 tool(s), 8974ms verify

### [commit] b422b56: feat(core,cli): background non-blocking RL feedback at each workflow step (relevance: 0.73)
Commit b422b56 on feature/015-background-rl-feedback: 14 file(s), 0 finding(s), 8 tool(s), 8865ms verify

### [commit] 66fd65f: docs(core): add spec + ADR for background RL feedback (feature 015) (relevance: 0.73)
Commit 66fd65f on feature/015-background-rl-feedback: 2 file(s), 0 finding(s), 8 tool(s), 8883ms verify

### [commit] 4b16b73: feat(cli): wire workflow context into plan, design, review, commit, verify, pr commands (relevance: 0.73)
Commit 4b16b73 on feature/014-workflow-context: 10 file(s), 0 finding(s), 8 tool(s), 9464ms verify

### [commit] cea7e58: feat(core): add workflow context module for step-to-step forwarding (relevance: 0.73)
Commit cea7e58 on feature/014-workflow-context: 5 file(s), 0 finding(s), 8 tool(s), 8779ms verify

### [commit] 82e01b9: docs(core): add spec + ADR for workflow context forwarding (feature 014) (relevance: 0.73)
Commit 82e01b9 on feature/014-workflow-context: 2 file(s), 0 finding(s), 8 tool(s), 9108ms verify

### [commit] 5bfad51: feat(cli): add maina slop command for standalone slop detection (relevance: 0.72)
Commit 5bfad51 on feature/014-cli-slop-command: 2 file(s), 0 finding(s), 8 tool(s), 8994ms verify

### [commit] 4152a70: fix(core): host delegation returns usable content in CLI mode (relevance: 0.72)
Commit 4152a70 on feature/013-fix-host-delegation: 5 file(s), 0 finding(s), 8 tool(s), 8541ms verify

### [commit] c74473e: docs(core): add spec + ADR for host delegation fix (feature 013) (relevance: 0.72)
Commit c74473e on feature/013-fix-host-delegation: 2 file(s), 0 finding(s), 8 tool(s), 8984ms verify

### [commit] 171ac6b: fix(core): design review errors on empty ADRs (>5 NEEDS CLARIFICATION markers) (relevance: 0.72)
Commit 171ac6b on master: 3 file(s), 0 finding(s), 8 tool(s), 15178ms verify

### [commit] 035b3a2: feat(core): language-aware slop detection for Python, Go, Rust (relevance: 0.68)
Commit 035b3a2 on feature/012-multi-language-verify: 8 file(s), 0 finding(s), 8 tool(s), 7858ms verify

### [commit] 9ddfd10: feat(core): refactor syntax guard to dispatch per language profile (relevance: 0.68)
Commit 9ddfd10 on feature/012-multi-language-verify: 2 file(s), 0 finding(s), 8 tool(s), 8756ms verify

### [commit] 2dcce71: feat(core): add ruff, golangci-lint, clippy, cargo-audit to tool registry (relevance: 0.68)
Commit 2dcce71 on feature/012-multi-language-verify: 8 file(s), 0 finding(s), 8 tool(s), 9025ms verify

### [commit] 7d475db: feat(core): add LanguageProfile abstraction for multi-language support (relevance: 0.68)
Commit 7d475db on feature/012-multi-language-verify: 2 file(s), 0 finding(s), 8 tool(s), 7409ms verify

### [commit] 51df8a7: feat(core): add LanguageProfile abstraction for multi-language support (relevance: 0.68)
Commit 51df8a7 on feature/012-multi-language-verify: 4 file(s), 0 finding(s), 8 tool(s), 9191ms verify

### [commit] afac9b8: docs(core): add spec + ADR for multi-language verify (feature 012) (relevance: 0.68)
Commit afac9b8 on feature/012-multi-language-verify: 2 file(s), 0 finding(s), 8 tool(s), 9051ms verify

### [commit] 842e546: feat(core): create review prompt v2 candidate for A/B testing — 44% accept rate improvement (relevance: 0.68)
Commit 842e546 on feature/013-rl-review-prompt: 1 file(s), 0 finding(s), 8 tool(s), 9347ms verify

### [commit] 15ad7ed: feat(core): add Zoekt code search to retrieval layer (zoekt→rg→grep) (relevance: 0.68)
Commit 15ad7ed on feature/013-zoekt-retrieval: 2 file(s), 0 finding(s), 8 tool(s), 10846ms verify

### [commit] 60d8268: feat(core): wire sonarqube, stryker, diff-cover into verify pipeline (relevance: 0.68)
Commit 60d8268 on feature/012-verify-tools: 3 file(s), 0 finding(s), 8 tool(s), 8376ms verify

### [commit] 0e94554: feat(core): add SonarQube integration for verify pipeline (relevance: 0.68)
Commit 0e94554 on feature/012-verify-tools: 5 file(s), 0 finding(s), 5 tool(s), 8427ms verify

### [commit] 8715ff6: feat(cli): wire --hld flag for AI HLD/LLD generation in maina design (relevance: 0.67)
Commit 8715ff6 on feature/011-self-improvement: 2 file(s), 0 finding(s), 5 tool(s), 8561ms verify

### [commit] 98f75e2: feat(core): add HLD/LLD section validation to design review (relevance: 0.67)
Commit 98f75e2 on feature/011-self-improvement: 4 file(s), 0 finding(s), 5 tool(s), 10188ms verify

### [commit] a475799: feat(core): enhance ADR template with HLD/LLD sections (relevance: 0.67)
Commit a475799 on feature/011-self-improvement: 2 file(s), 0 finding(s), 5 tool(s), 8558ms verify

### [commit] bcf6c53: feat(cli): add --deep flag to maina verify (relevance: 0.67)
Commit bcf6c53 on feature/011-self-improvement: 1 file(s), 0 finding(s), 5 tool(s), 8088ms verify

### [commit] 1b2016f: feat(core): add design-hld-lld prompt template (relevance: 0.67)
Commit 1b2016f on feature/011-self-improvement: 2 file(s), 0 finding(s), 5 tool(s), 7878ms verify

### [commit] cc074a6: feat(core): wire AI review into verify pipeline (relevance: 0.67)
Commit cc074a6 on feature/011-self-improvement: 2 file(s), 0 finding(s), 5 tool(s), 8925ms verify

### [commit] ed07009: feat(core): implement runAIReview with mechanical + deep tiers (relevance: 0.67)
Commit ed07009 on feature/011-self-improvement: 2 file(s), 0 finding(s), 4 tool(s), 9494ms verify

### [commit] f23da1d: feat(core): add referenced function resolution for AI review (relevance: 0.67)
Commit f23da1d on feature/011-self-improvement: 2 file(s), 0 finding(s), 4 tool(s), 7986ms verify

### [commit] c3ba5c8: feat(core): add ai-review prompt template and update PromptTask type (relevance: 0.67)
Commit c3ba5c8 on feature/011-self-improvement: 2 file(s), 0 finding(s), 4 tool(s), 8187ms verify

### [commit] 569c069: feat(core): register code-review task in mechanical tier (relevance: 0.67)
Commit 569c069 on feature/011-self-improvement: 2 file(s), 0 finding(s), 4 tool(s), 9865ms verify

### [commit] 3afb94c: feat(core,cli): tier 3 benchmark + self-improvement — expose verify gap (relevance: 0.67)
Commit 3afb94c on feature/011-self-improvement: 26 file(s), 0 finding(s), 4 tool(s), 8772ms verify

### [commit] 59fcf84: chore: add changesets for monorepo versioning and changelog generation (relevance: 0.66)
Commit 59fcf84 on master: 4 file(s), 0 finding(s), 4 tool(s), 9366ms verify

### [commit] 1e386f8: chore: set real repo URL (beeeku/maina), add files/keywords, fix gitignore (relevance: 0.66)
Commit 1e386f8 on master: 6 file(s), 0 finding(s), 4 tool(s), 8856ms verify

### [commit] fffbe97: feat(core): smart init with project detection from package.json, clear config guidance (relevance: 0.65)
Commit fffbe97 on master: 4 file(s), 0 finding(s), 4 tool(s), 9032ms verify

### [commit] 2516eba: fix(core): wire cache stats through pipeline and MCP, stop hardcoding cacheHits: 0 (relevance: 0.65)
Commit 2516eba on master: 3 file(s), 0 finding(s), 4 tool(s), 8585ms verify

### [commit] e00d312: docs: add sprint 1-9 benchmark comparison (Claude+Superpowers vs Claude+Maina) (relevance: 0.65)
Commit e00d312 on master: 2 file(s), 0 finding(s), 4 tool(s), 8995ms verify

### [commit] 7e803c1: fix(core): fix TODO false positive, improve task parser and orphan heuristic (relevance: 0.65)
Commit 7e803c1 on master: 5 file(s), 10 finding(s), 4 tool(s), 9163ms verify

### [commit] a90eee2: feat: implement todo CRUD API with full maina e2e workflow (relevance: 0.65)
Commit a90eee2 on master: 10 file(s), 1 finding(s), 4 tool(s), 8305ms verify

### [commit] 3adcdb4: fix(core): resolve all pre-publish review issues (relevance: 0.65)
Commit 3adcdb4 on master: 14 file(s), 2 finding(s), 4 tool(s), 8412ms verify

### [commit] bdb7244: docs: add production README with real metrics from 9 sprints of dogfooding (relevance: 0.65)
Commit bdb7244 on master: 1 file(s), 0 finding(s), 4 tool(s), 9183ms verify

### [commit] c9c5169: feat(core): update constitution for Sprint 9, wire preferences into pipeline (relevance: 0.65)
Commit c9c5169 on feature/006-karpathy-spec-quality: 2 file(s), 0 finding(s), 4 tool(s), 9392ms verify

### [commit] 1384bd4: feat(cli): add maina stats --specs for spec quality evolution tracking (relevance: 0.65)
Commit 1384bd4 on feature/006-karpathy-spec-quality: 2 file(s), 1 finding(s), 4 tool(s), 9438ms verify

### [commit] 61b8b7e: feat(core): add red-green enforcement and plan-to-code traceability (relevance: 0.65)
Commit 61b8b7e on feature/006-karpathy-spec-quality: 5 file(s), 0 finding(s), 4 tool(s), 8610ms verify

### [commit] 01c1bdf: feat(core): add spec quality scoring and skip event tracking (relevance: 0.65)
Commit 01c1bdf on feature/006-karpathy-spec-quality: 8 file(s), 0 finding(s), 4 tool(s), 9214ms verify

### [commit] 4aeeabb: fix(core): wire slop cache into pipeline, fix retrieval layer grep, cache host delegation (relevance: 0.65)
Commit 4aeeabb on master: 4 file(s), 0 finding(s), 4 tool(s), 9169ms verify

### [review] Accepted review (relevance: 0.65)
[review] Accepted review
Files: src/app.ts
Findings:
  - severity: critical
  - issue: SQL injection vulnerability
Verdict: suggestion: Use parameterized queries

### [commit] cd56170: fix(core): resolve Sprint 8 review issues (relevance: 0.65)
Commit cd56170 on master: 7 file(s), 0 finding(s), 4 tool(s), 8427ms verify

### [commit] f8bffab: docs(core): add ADR-0001 Karpathy spec quality, Sprint 8 feature specs (relevance: 0.65)
Commit f8bffab on master: 4 file(s), 0 finding(s), 4 tool(s), 9341ms verify

### [commit] 7a33147: feat(core): add A/B test resolution, episodic compression of accepted reviews (relevance: 0.65)
Commit 7a33147 on feature/005-rl-feedback-and-skills: 7 file(s), 0 finding(s), 4 tool(s), 8471ms verify

### [commit] 55cae2c: feat(skills): add 5 SKILL.md files for cross-platform AI agent integration (relevance: 0.65)
Commit 55cae2c on feature/005-rl-feedback-and-skills: 7 file(s), 0 finding(s), 4 tool(s), 8647ms verify

### [commit] 2d559cf: feat(core): add feedback collector and preference learning for RL loop (relevance: 0.65)
Commit 2d559cf on feature/005-rl-feedback-and-skills: 6 file(s), 0 finding(s), 4 tool(s), 9231ms verify

### [commit] 138d311: feat(core): improve test stubs with 5-category framework — happy, edge, error, security, integration (relevance: 0.65)
Commit 138d311 on master: 3 file(s), 0 finding(s), 4 tool(s), 8714ms verify

### [commit] 4a4b164: fix(core): resolve all code review issues — shared utils, DB split, AI helper, comprehensive review (relevance: 0.65)
Commit 4a4b164 on master: 44 file(s), 21 finding(s), 4 tool(s), 8614ms verify

### [commit] 50c0d05: feat(cli): wire --mcp flag to start MCP server via stdio (relevance: 0.65)
Commit 50c0d05 on feature/004-mcp-server: 2 file(s), 0 finding(s), 4 tool(s), 9350ms verify

### [commit] 3e4a796: feat(mcp): add MCP server with 8 tools delegating to all engines (relevance: 0.65)
Commit 3e4a796 on feature/004-mcp-server: 9 file(s), 1 finding(s), 4 tool(s), 8334ms verify

### [commit] d40331d: feat(cli): add maina stats --compare for maina vs raw git comparison (relevance: 0.65)
Commit d40331d on master: 3 file(s), 1 finding(s), 4 tool(s), 9110ms verify

### [commit] 34e9f08: feat(core): add AI slop guard, fix CLAUDECODE host detection, add host delegation (relevance: 0.65)
Commit 34e9f08 on master: 5 file(s), 2 finding(s), 4 tool(s), 9250ms verify

### [commit] 360c6d2: feat(cli): wire AI summary into maina explain, export generate and getApiKey (relevance: 0.65)
Commit 360c6d2 on master: 2 file(s), 0 finding(s), 4 tool(s), 8042ms verify

### [commit] 0789f85: feat(core): wire Prompt Engine + AI into PR review and commit message generation (relevance: 0.65)
Commit 0789f85 on master: 8 file(s), 2 finding(s), 4 tool(s), 8500ms verify

### [commit] 9c17113: feat(core): add constitution.md, split .maina gitignore for team sync, add publish prereq (relevance: 0.65)
Commit 9c17113 on master: 3 file(s), 0 finding(s), 4 tool(s), 9689ms verify

### [commit] a2a8512: feat(cli): add maina status command for branch health overview (relevance: 0.65)
Commit a2a8512 on feature/003-pr-and-init: 4 file(s), 0 finding(s), 4 tool(s), 8836ms verify

### [commit] 2283e78: feat(cli): add maina init to bootstrap maina in any repo (relevance: 0.65)
Commit 2283e78 on feature/003-pr-and-init: 4 file(s), 0 finding(s), 4 tool(s), 8161ms verify

### [commit] 4a73af0: feat(cli): add maina pr with two-stage review (spec compliance + code quality) (relevance: 0.65)
Commit 4a73af0 on feature/003-pr-and-init: 6 file(s), 2 finding(s), 4 tool(s), 9835ms verify

### [commit] 2e7666f: feat(core): persist semantic entities and dependency edges to DB on context assembly (relevance: 0.65)
Commit 2e7666f on master: 2 file(s), 0 finding(s), 4 tool(s), 9405ms verify

### [commit] 689db4f: feat(core): wire episodic context, working context, and real token counts into commit flow (relevance: 0.65)
Commit 689db4f on master: 3 file(s), 0 finding(s), 4 tool(s), 8344ms verify


./.maina/features/006-karpathy-spec-quality/spec-tests.ts:3: describe("Feature: karpathy-spec-quality", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:4: 	describe("T001: Write tests and implement spec quality scoring in packages/core/src/features/quality.ts", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:5: 		it("happy path: should write tests and implement spec quality scoring in packages/core/src/features/quality.ts", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:32: 	describe("T003: Add red-green enforcement to maina spec — auto-run stubs and verify all fail", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:33: 		it("happy path: should add red-green enforcement to maina spec — auto-run stubs and verify all fail", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:46: 	describe("T004: Write tests and implement plan-to-code traceability in packages/core/src/features/traceability.ts", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:47: 		it("happy path: should write tests and implement plan-to-code traceability in packages/core/src/features/traceability.ts", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:60: 	describe("T005: Add --specs flag to maina stats showing spec quality evolution over time", () => {
./.maina/features/006-karpathy-spec-quality/spec-tests.ts:61: 		it("happy path: should add --specs flag to maina stats showing spec quality evolution over time", () => {
./.maina/benchmarks/stories/validator/tests/validation/isEmail.val.test.ts:12: // -- Boundary conditions the spec mentions but are easy to miss ----------------
./.maina/benchmarks/stories/validator/tests/validation/isEmail.val.test.ts:193: 	test("gmail domain-specific rejects dots in local", () => {
./.maina/benchmarks/stories/validator/tests/validation/isEmail.val.test.ts:195: 			isEmail("user.name@gmail.com", { domain_specific_validation: true }),
./.maina/benchmarks/stories/validator/tests/validation/isEmail.val.test.ts:199: 	test("gmail domain-specific applies to googlemail.com too", () => {
./.maina/benchmarks/stories/validator/tests/validation/isEmail.val.test.ts:201: 			isEmail("user.name@googlemail.com", { domain_specific_validation: true }),
./examples/todo-api/src/index.test.ts:93: 		it("returns a specific todo", async () => {
./packages/core/src/benchmark/story-loader.ts:39:  * Load a specific story by name, including its config, spec, and test files.
./packages/core/src/benchmark/story-loader.ts:65: 	// Load spec
./packages/core/src/benchmark/story-loader.ts:66: 	const specPath = join(storyDir, "spec.md");
./packages/core/src/benchmark/story-loader.ts:67: 	if (!existsSync(specPath)) {
./packages/core/src/benchmark/story-loader.ts:68: 		return { ok: false, error: `Missing spec.md in ${name}` };

## Wiki Knowledge (Layer 5)

### Index
# Wiki Index

> Auto-generated index. 375 articles across 5 categories.

## Architecture

- [Three Engines](wiki/architecture/three-engines.md) [fresh]
- [Monorepo Structure](wiki/architecture/monorepo-structure.md) [fresh]
- [Verification Pipeline](wiki/architecture/verification-pipeline.md) [fresh]

## Modules

- [cloud](wiki/modules/cloud.md) [fresh]
- [stats](wiki/modules/stats.md) [fresh]
- [wiki](wiki/modules/wiki.md) [fresh]
- [prompts](wiki/modules/prompts.md) [fresh]
- [language](wiki/modules/language.md) [fresh]
- [cluster-60](wiki/modules/cluster-60.md) [fresh]
- [git](wiki/modules/git.md) [fresh]
- [verify](wiki/modules/verify.md) [fresh]
- [cluster-71](wiki/modules/cluster-71.md) [fresh]
- [cluster-23](wiki/modules/cluster-23.md) [fresh]
- [config](wiki/modules/config.md) [fresh]
- [commands](wiki/modules/commands.md) [fresh]
- [cluster-53](wiki/modules/cluster-53.md) [fresh]
- [cluster-31](wiki/modules/cluster-31.md) [fresh]
- [context](wiki/modules/context.md) [fresh]
- [cluster-65](wiki/modules/cluster-65.md) [fresh]
- [cluster-68](wiki/modules/cluster-68.md) [fresh]
- [cluster-91](wiki/modules/cluster-91.md) [fresh]
- [cluster-93](wiki/modules/cluster-93.md) [fresh]
- [cluster-102](wiki/modules/cluster-102.md) [fresh]
- [benchmark](wiki/modules/benchmark.md) [fresh]
- [cluster-17](wiki/modules/cluster-17.md) [fresh]
- [cluster-18](wiki/modules/cluster-18.md) [fresh]
- [cluster-29](wiki/modules/cluster-29.md) [fresh]
- [cluster-41](wiki/modules/cluster-41.md) [fresh]
- [db](wiki/modules/db.md) [fresh]
- [feedback](wiki/modules/feedback.md) [fresh]
- [cluster-103](wiki/modules/cluster-103.md) [fresh]
- [cluster-104](wiki/modules/cluster-104.md) [fresh]
- [design](wiki/modules/design.md) [fresh]
- [cluster-95](wiki/modules/cluster-95.md) [fresh]
- [cluster-11](wiki/modules/cluster-11.md) [fresh]
- [src](wiki/modules/src.md) [fresh]
- [cluster-34](wiki/modules/cluster-34.md) [fresh]
- [cluster-36](wiki/modules/cluster-36.md) [fresh]
- [cluster-39](wiki/modules/cluster-39.md) [fresh]
- [hooks](wiki/modules/hooks.md) [fresh]
- [cluster-44](wiki/modules/cluster-44.md) [fresh]
- [ticket](wiki/modules/ticket.md) [fresh]
- [cluster-85](wiki/modules/cluster-85.md) [fresh]
- [cluster-109](wiki/modules/cluster-109.md) [fresh]
- [cluster-124](wiki/modules/cluster-124.md) [fresh]
- [cluster-21](wiki/modules/cluster-21.md) [fresh]
- [cluster-14](wiki/modules/cluster-14.md) [fresh]
- [cluster-15](wiki/modules/cluster-15.md) [fresh]
- [cluster-24](wiki/modules/cluster-24.md) [fresh]
- [cluster-30](wiki/modules/cluster-30.md) [fresh]
- [cluster-33](wiki/modules/cluster-33.md) [fresh]
- [cluster-35](wiki/modules/cluster-35.md) [fresh]
- [init](wiki/modules/init.md) [fresh]
- [cluster-46](wiki/modules/cluster-46.md) [fresh]
- [cluster-54](wiki/modules/cluster-54.md) [fresh]
- [cluster-56](wiki/modules/cluster-56.md) [fresh]
- [cluster-57](wiki/modules/cluster-57.md) [fresh]
- [cluster-67](wiki/modules/cluster-67.md) [fresh]
- [cluster-69](wiki/modules/cluster-69.md) [fresh]
- [cluster-72](wiki/modules/cluster-72.md) [fresh]
- [cluster-73](wiki/modules/cluster-73.md) [fresh]
- [cluster-75](wiki/modules/cluster-75.md) [fresh]
- [cluster-77](wiki/modules/cluster-77.md) [fresh]
- [cache](wiki/modules/cache.md) [fresh]
- [cluster-83](wiki/modules/cluster-83.md) [fresh]
- [features](wiki/modules/features.md) [fresh]
- [cluster-119](wiki/modules/cluster-119.md) [fresh]
- [cluster-125](wiki/modules/cluster-125.md) [fresh]
- [cluster-19](wiki/modules/cluster-19.md) [fresh]
- [cluster-26](wiki/modules/cluster-26.md) [fresh]
- [cluster-27](wiki/modules/cluster-27.md) [fresh]
- [ai](wiki/modules/ai.md) [fresh]
- [cluster-43](wiki/modules/cluster-43.md) [fresh]
- [cluster-48](wiki/modules/cluster-48.md) [fresh]
- [explain](wiki/modules/explain.md) [fresh]
- [cluster-50](wiki/modules/cluster-50.md) [fresh]
- [cluster-52](wiki/modules/cluster-52.md) [fresh]
- [cluster-61](wiki/modules/cluster-61.md) [fresh]
- [cluster-62](wiki/modules/cluster-62.md) [fresh]
- [cluster-64](wiki/modules/cluster-64.md) [fresh]
- [cluster-66](wiki/modules/cluster-66.md) [fresh]
- [cluster-70](wiki/modules/cluster-70.md) [fresh]
- [cluster-74](wiki/modules/cluster-74.md) [fresh]
- [cluster-78](wiki/modules/cluster-78.md) [fresh]
- [cluster-79](wiki/modules/cluster-79.md) [fresh]
- [cluster-80](wiki/modules/cluster-80.md) [fresh]
- [cluster-86](wiki/modules/cluster-86.md) [fresh]
- [cluster-87](wiki/modules/cluster-87.md) [fresh]
- [cluster-88](wiki/modules/cluster-88.md) [fresh]
- [cluster-89](wiki/modules/cluster-89.md) [fresh]
- [cluster-90](wiki/modules/cluster-90.md) [fresh]
- [cluster-92](wiki/modules/cluster-92.md) [fresh]
- [workflow](wiki/modules/workflow.md) [fresh]
- [cluster-99](wiki/modules/cluster-99.md) [fresh]
- [cluster-100](wiki/modules/cluster-100.md) [fresh]
- [cluster-112](wiki/modules/cluster-112.md) [fresh]
- [cluster-117](wiki/modules/cluster-117.md) [fresh]
- [cluster-137](wiki/modules/cluster-137.md) [fresh]
- [cluster-140](wiki/modules/cluster-140.md) [fresh]
- [cluster-97](wiki/modules/cluster-97.md) [fresh]
- [cluster-129](wiki/modules/cluster-129.md) [fresh]
- [cluster-130](wiki/modules/cluster-130.md) [fresh]
- [cluster-127](wiki/modules/cluster-127.md) [fresh]
- [cluster-131](wiki/modules/cluster-131.md) [fresh]
- [cluster-13](wiki/modules/cluster-13.md) [fresh]
- [cluster-25](wiki/modules/cluster-25.md) [fresh]
- [cluster-45](wiki/modules/cluster-45.md) [fresh]
- [cluster-81](wiki/modules/cluster-81.md) [fresh]
- [cluster-84](wiki/modules/cluster-84.md) [fresh]
- [cluster-96](wiki/modules/cluster-96.md) [fresh]
- [cluster-106](wiki/modules/cluster-106.md) [fresh]
- [cluster-110](wiki/modules/cluster-110.md) [fresh]
- [cluster-113](wiki/modules/cluster-113.md) [fresh]
- [cluster-132](wiki/modules/cluster-132.md) [fresh]
- [cluster-105](wiki/modules/cluster-105.md) [fresh]
- [cluster-101](wiki/modules/cluster-101.md) [fresh]
- [cluster-107](wiki/modules/cluster-107.md) [fresh]
- [cluster-111](wiki/modules/cluster-111.md) [fresh]
- [extractors](wiki/modules/extractors.md) [fresh]
- [cluster-115](wiki/modules/cluster-115.md) [fresh]
- [cluster-116](wiki/modules/cluster-116.md) [fresh]
- [cluster-118](wiki/modules/cluster-118.md) [fresh]
- [cluster-120](wiki/modules/cluster-120.md) [fresh]
- [cluster-121](wiki/modules/cluster-121.md) [fresh]
- [cluster-123](wiki/modules/cluster-123.md) [fresh]
- [defaults](wiki/modules/defaults.md) [fresh]
- [cluster-128](wiki/modules/cluster-128.md) [fresh]
- [cluster-133](wiki/modules/cluster-133.md) [fresh]
- [cluster-134](wiki/modules/cluster-134.md) [fresh]
- [cluster-135](wiki/modules/cluster-135.md) [fresh]
- [cluster-136](wiki/modules/cluster-136.md) [fresh]
- [cluster-138](wiki/modules/cluster-138.md) [fresh]
- [cluster-139](wiki/modules/cluster-139.md) [fresh]
- [linters](wiki/modules/linters.md) [fresh]
- [tools](wiki/modules/tools.md) [fresh]
- [cluster-0](wiki/modules/cluster-0.md) [fresh]
- [cluster-1](wiki/modules/cluster-1.md) [fresh]
- [cluster-2](wiki/modules/cluster-2.md) [fresh]
- [cluster-3](wiki/modules/cluster-3.md) [fresh]
- [cluster-4](wiki/modules/cluster-4.md) [fresh]
- [cluster-5](wiki/modules/cluster-5.md) [fresh]
- [cluster-6](wiki/modules/cluster-6.md) [fresh]
- [cluster-7](wiki/modules/cluster-7.md) [fresh]
- [cluster-8](wiki/modules/cluster-8.md) [fresh]
- [cluster-9](wiki/modules/cluster-9.md) [fresh]
- [cluster-10](wiki/modules/cluster-10.md) [fresh]
- [cluster-141](wiki/modules/cluster-141.md) [fresh]
- [cluster-142](wiki/modules/cluster-142.md) [fresh]
- [cluster-143](wiki/modules/cluster-143.md) [fresh]
- [cluster-144](wiki/modules/cluster-144.md) [fresh]
- [cluster-145](wiki/modules/cluster-145.md) [fresh]
- [cluster-146](wiki/modules/cluster-146.md) [fresh]
- [cluster-147](wiki/modules/cluster-147.md) [fresh]
- [cluster-148](wiki/modules/cluster-148.md) [fresh]
- [cluster-149](wiki/modules/cluster-149.md) [fresh]
- [cluster-150](wiki/modules/cluster-150.md) [fresh]
- [cluster-151](wiki/modules/cluster-151.md) [fresh]
- [cluster-152](wiki/modules/cluster-152.md) [fresh]
- [cluster-153](wiki/modules/cluster-153.md) [fresh]
- [cluster-154](wiki/modules/cluster-154.md) [fresh]
- [cluster-155](wiki/modules/cluster-155.md) [fresh]
- [cluster-156](wiki/modules/cluster-156.md) [fresh]
- [cluster-157](wiki/modules/cluster-157.md) [fresh]
- [cluster-158](wiki/modules/cluster-158.md) [fresh]
- [cluster-159](wiki/modules/cluster-159.md) [fresh]
- [cluster-160](wiki/modules/cluster-160.md) [fresh]
- [cluster-161](wiki/modules/cluster-161.md) [fresh]
- [cluster-162](wiki/modules/cluster-162.md) [fresh]
- [cluster-163](wiki/modules/cluster-163.md) [fresh]
- [cluster-164](wiki/modules/cluster-164.md) [fresh]
- [cluster-165](wiki/modules/cluster-165.md) [fresh]
- [cluster-166](wiki/modules/cluster-166.md) [fresh]
- [cluster-167](wiki/modules/cluster-167.md) [fresh]
- [cluster-168](wiki/modules/cluster-168.md) [fresh]
- [cluster-169](wiki/modules/cluster-169.md) [fresh]
- [cluster-170](wiki/modules/cluster-170.md) [fresh]
- [cluster-171](wiki/modules/cluster-171.md) [fresh]
- [cluster-172](wiki/modules/cluster-172.md) [fresh]
- [cluster-173](wiki/modules/cluster-173.md) [fresh]
- [cluster-174](wiki/modules/cluster-174.md) [fresh]
- [cluster-175](wiki/modules/cluster-175.md) [fresh]
- [cluster-176](wiki/modules/cluster-176.md) [fresh]
- [cluster-177](wiki/modules/cluster-177.md) [fresh]
- [cluster-180](wiki/modules/cluster-180.md) [fresh]

## Entities

- [FeedbackImprovementsResponse](wiki/entities/FeedbackImprovementsResponse.md) [fresh]
- [DECAY_HALF_LIVES](wiki/entities/DECAY_HALF_LIVES.md) [fresh]
- [getToolUsageStats](wiki/entities/getToolUsageStats.md) [fresh]
- [CloudPromptImprovement](wiki/entities/CloudPromptImprovement.md) [fresh]
- [resolveABTests](wiki/entities/resolveABTests.md) [fresh]
- [FeedbackBatchPayload](wiki/entities/FeedbackBatchPayload.md) [fresh]
- [getSupportedLanguages](wiki/entities/getSupportedLanguages.md) [fresh]
- [assembleRetrievalText](wiki/entities/assembleRetrievalText.md) [fresh]
- [getRepoSlug](wiki/entities/getRepoSlug.md) [fresh]
- [updateBaselines](wiki/entities/updateBaselines.md) [fresh]
- [WikiLintResult](wiki/entities/WikiLintResult.md) [fresh]
- [trackToolUsage](wiki/entities/trackToolUsage.md) [fresh]
- [FeedbackEvent](wiki/entities/FeedbackEvent.md) [fresh]
- [isToolAvailable](wiki/entities/isToolAvailable.md) [fresh]
- [shouldDelegateToHost](wiki/entities/shouldDelegateToHost.md) [fresh]
- [getWikiEffectivenessReport](wiki/entities/getWikiEffectivenessReport.md) [fresh]
- [setupCommand](wiki/entities/setupCommand.md) [fresh]
- [retire](wiki/entities/retire.md) [fresh]
- [CloudEpisodicEntry](wiki/entities/CloudEpisodicEntry.md) [fresh]
- [planCommand](wiki/entities/planCommand.md) [fresh]
- [assembleEpisodicText](wiki/entities/assembleEpisodicText.md) [fresh]
- [parseFile](wiki/entities/parseFile.md) [fresh]
- [assembleWorkingText](wiki/entities/assembleWorkingText.md) [fresh]
- [runBuiltinChecks](wiki/entities/runBuiltinChecks.md) [fresh]
- [detectSlop](wiki/entities/detectSlop.md) [fresh]
- [doctorCommand](wiki/entities/doctorCommand.md) [fresh]
- [statsCommand](wiki/entities/statsCommand.md) [fresh]
- [getProfile](wiki/entities/getProfile.md) [fresh]
- [WikiLintFinding](wiki/entities/WikiLintFinding.md) [fresh]
- [ToolUsageStats](wiki/entities/ToolUsageStats.md) [fresh]
- [search](wiki/entities/search.md) [fresh]
- [EpisodicCloudEntry](wiki/entities/EpisodicCloudEntry.md) [fresh]
- [getChangedFiles](wiki/entities/getChangedFiles.md) [fresh]
- [getTrackedFiles](wiki/entities/getTrackedFiles.md) [fresh]
- [Tier3Results](wiki/entities/Tier3Results.md) [fresh]
- [truncateToFit](wiki/entities/truncateToFit.md) [fresh]
- [validateArticleStructure](wiki/entities/validateArticleStructure.md) [fresh]
- [getNoisyRules](wiki/entities/getNoisyRules.md) [fresh]
- [pollForToken](wiki/entities/pollForToken.md) [fresh]
- [promptVersions](wiki/entities/promptVersions.md) [fresh]
- [getStatsDb](wiki/entities/getStatsDb.md) [fresh]
- [initCommand](wiki/entities/initCommand.md) [fresh]
- [brainstormCommand](wiki/entities/brainstormCommand.md) [fresh]
- [runVisualVerification](wiki/entities/runVisualVerification.md) [fresh]
- [runTwoStageReview](wiki/entities/runTwoStageReview.md) [fresh]
- [persistSemanticContext](wiki/entities/persistSemanticContext.md) [fresh]
- [CloudFeedbackPayload](wiki/entities/CloudFeedbackPayload.md) [fresh]
- [promote](wiki/entities/promote.md) [fresh]
- [deleteTodo](wiki/entities/deleteTodo.md) [fresh]
- [runAIReview](wiki/entities/runAIReview.md) [fresh]
- [generateFixes](wiki/entities/generateFixes.md) [fresh]
- [mapToArticles](wiki/entities/mapToArticles.md) [fresh]
- [getWorkflowId](wiki/entities/getWorkflowId.md) [fresh]
- [runHooks](wiki/entities/runHooks.md) [fresh]
- [getPromptStats](wiki/entities/getPromptStats.md) [fresh]
- [createTicket](wiki/entities/createTicket.md) [fresh]
- [exitCodeFromResult](wiki/entities/exitCodeFromResult.md) [fresh]
- [logoutCommand](wiki/entities/logoutCommand.md) [fresh]
- [verifyCommand](wiki/entities/verifyCommand.md) [fresh]
- [WikiLintCheck](wiki/entities/WikiLintCheck.md) [fresh]
- [ToolUsageInput](wiki/entities/ToolUsageInput.md) [fresh]
- [VerifyResultResponse](wiki/entities/VerifyResultResponse.md) [fresh]
- [detectTools](wiki/entities/detectTools.md) [fresh]
- [HostDelegation](wiki/entities/HostDelegation.md) [fresh]
- [recordArticlesLoaded](wiki/entities/recordArticlesLoaded.md) [fresh]
- [setupAction](wiki/entities/setupAction.md) [fresh]
- [commitCommand](wiki/entities/commitCommand.md) [fresh]
- [PROFILES](wiki/entities/PROFILES.md) [fresh]
- [searchWithGrep](wiki/entities/searchWithGrep.md) [fresh]
- [planAction](wiki/entities/planAction.md) [fresh]
- [reviewDesign](wiki/entities/reviewDesign.md) [fresh]
- [getStagedFiles](wiki/entities/getStagedFiles.md) [fresh]
- [VerifyFinding](wiki/entities/VerifyFinding.md) [fresh]
- [handleDeleteTodo](wiki/entities/handleDeleteTodo.md) [fresh]
- [bootstrap](wiki/entities/bootstrap.md) [fresh]
- [generateHldLld](wiki/entities/generateHldLld.md) [fresh]
- [scoreRelevance](wiki/entities/scoreRelevance.md) [fresh]
- [getBudgetMode](wiki/entities/getBudgetMode.md) [fresh]
- [getAllRules](wiki/entities/getAllRules.md) [fresh]
- [formatVerificationProof](wiki/entities/formatVerificationProof.md) [fresh]
- [runTypecheck](wiki/entities/runTypecheck.md) [fresh]
- [filterByDiff](wiki/entities/filterByDiff.md) [fresh]
- [scaffoldFeatureWithContext](wiki/entities/scaffoldFeatureWithContext.md) [fresh]
- [comprehensiveReview](wiki/entities/comprehensiveReview.md) [fresh]
- [analyzeCommand](wiki/entities/analyzeCommand.md) [fresh]
- [statusCommand](wiki/entities/statusCommand.md) [fresh]
- [explainCommand](wiki/entities/explainCommand.md) [fresh]
- [prCommand](wiki/entities/prCommand.md) [fresh]
- [reviewCommand](wiki/entities/reviewCommand.md) [fresh]
- [teamCommand](wiki/entities/teamCommand.md) [fresh]
- [specCommand](wiki/entities/specCommand.md) [fresh]
- [designCommand](wiki/entities/designCommand.md) [fresh]
- [benchmarkCommand](wiki/entities/benchmarkCommand.md) [fresh]
- [ticketCommand](wiki/entities/ticketCommand.md) [fresh]
- [reviewDesignCommand](wiki/entities/reviewDesignCommand.md) [fresh]
- [decayAllEntries](wiki/entities/decayAllEntries.md) [fresh]
- [extractEntities](wiki/entities/extractEntities.md) [fresh]
- [resetWorkingContext](wiki/entities/resetWorkingContext.md) [fresh]
- [checkAnyType](wiki/entities/checkAnyType.md) [fresh]
- [detectCommentedCode](wiki/entities/detectCommentedCode.md) [fresh]
- [doctorAction](wiki/entities/doctorAction.md) [fresh]
- [statsAction](wiki/entities/statsAction.md) [fresh]
- [compareImages](wiki/entities/compareImages.md) [fresh]
- [abTest](wiki/entities/abTest.md) [fresh]
- [WikiState](wiki/entities/WikiState.md) [fresh]
- [getSkipRate](wiki/entities/getSkipRate.md) [fresh]
- [VerifyStatusResponse](wiki/entities/VerifyStatusResponse.md) [fresh]
- [Tier3Totals](wiki/entities/Tier3Totals.md) [fresh]
- [assembleBudget](wiki/entities/assembleBudget.md) [fresh]
- [getLinkSyntax](wiki/entities/getLinkSyntax.md) [fresh]
- [acknowledgeFinding](wiki/entities/acknowledgeFinding.md) [fresh]
- [startDeviceFlow](wiki/entities/startDeviceFlow.md) [fresh]
- [commitSnapshots](wiki/entities/commitSnapshots.md) [fresh]
- [getFeedbackDb](wiki/entities/getFeedbackDb.md) [fresh]
- [initAction](wiki/entities/initAction.md) [fresh]
- [brainstormAction](wiki/entities/brainstormAction.md) [fresh]
- [SubmitVerifyPayload](wiki/entities/SubmitVerifyPayload.md) [fresh]
- [PHP_PROFILE](wiki/entities/PHP_PROFILE.md) [fresh]
- [reviewCodeQualityWithAI](wiki/entities/reviewCodeQualityWithAI.md) [fresh]
- [searchWithRipgrep](wiki/entities/searchWithRipgrep.md) [fresh]
- [formatTier3Comparison](wiki/entities/formatTier3Comparison.md) [fresh]
- [runBenchmark](wiki/entities/runBenchmark.md) [fresh]
- [generateModuleSummary](wiki/entities/generateModuleSummary.md) [fresh]
- [assembleContext](wiki/entities/assembleContext.md) [fresh]
- [createCacheManager](wiki/entities/createCacheManager.md) [fresh]
- [runLighthouse](wiki/entities/runLighthouse.md) [fresh]
- [runPipeline](wiki/entities/runPipeline.md) [fresh]
- [runTrivy](wiki/entities/runTrivy.md) [fresh]
- [syntaxGuard](wiki/entities/syntaxGuard.md) [fresh]
- [runCoverage](wiki/entities/runCoverage.md) [fresh]
- [runSonar](wiki/entities/runSonar.md) [fresh]
- [runSemgrep](wiki/entities/runSemgrep.md) [fresh]
- [runMutation](wiki/entities/runMutation.md) [fresh]
- [runZap](wiki/entities/runZap.md) [fresh]
- [runSecretlint](wiki/entities/runSecretlint.md) [fresh]
- [traceFeature](wiki/entities/traceFeature.md) [fresh]
- [analyzeWorkflowTrace](wiki/entities/analyzeWorkflowTrace.md) [fresh]
- [captureResult](wiki/entities/captureResult.md) [fresh]
- [exportEpisodicForCloud](wiki/entities/exportEpisodicForCloud.md) [fresh]
- [resolveModel](wiki/entities/resolveModel.md) [fresh]
- [outputDelegationRequest](wiki/entities/outputDelegationRequest.md) [fresh]
- [generate](wiki/entities/generate.md) [fresh]

## Features

- [Implementation Plan](wiki/features/001-stats-tracker.md) [fresh]
- [Implementation Plan](wiki/features/002-ticket.md) [fresh]
- [Implementation Plan](wiki/features/013-fix-host-delegation.md) [fresh]
- [Implementation Plan](wiki/features/026-v07-rl-flywheel.md) [fresh]
- [Implementation Plan](wiki/features/004-mcp-server.md) [fresh]
- [Implementation Plan](wiki/features/007-todo-api-crud.md) [fresh]
- [Implementation Plan](wiki/features/014-workflow-context.md) [fresh]
- [Implementation Plan](wiki/features/006-karpathy-spec-quality.md) [fresh]
- [Implementation Plan](wiki/features/017-visual-verification.md) [fresh]
- [Implementation Plan — Feature 011: Self-Improvement](wiki/features/011-self-improvement.md) [fresh]
- [Feature 034: v1.1.0 Round-Trip Flywheel — Implementation Plan](wiki/features/034-v110-roundtrip-flywheel.md) [fresh]
- [Implementation Plan](wiki/features/023-enterprise-languages.md) [fresh]
- [Feature 030: Auto-Configure MCP + Agent Instruction Files During Init](wiki/features/030-mcp-agent-files.md) [fresh]
- [Feature 029: AI-Driven Interactive maina init](wiki/features/029-ai-driven-init.md) [fresh]
- [Implementation Plan](wiki/features/019-tool-install-guide.md) [fresh]
- [Implementation Plan](wiki/features/005-rl-feedback-and-skills.md) [fresh]
- [Implementation Plan](wiki/features/009-interactive-design.md) [fresh]
- [Implementation Plan](wiki/features/025-v06-hosted-verification.md) [fresh]
- [Implementation Plan — v0.5.0 Cloud Client + maina-cloud](wiki/features/024-v05-cloud-client.md) [fresh]
- [Implementation Plan](wiki/features/010-benchmark-harness.md) [fresh]
- [Implementation Plan](wiki/features/015-background-rl-feedback.md) [fresh]
- [Implementation Plan](wiki/features/021-ai-delegation-protocol.md) [fresh]
- [Feature 033: v1.0.3 Quick Wins](wiki/features/033-v103-quick-wins.md) [fresh]
- [Implementation Plan](wiki/features/016-post-workflow-rl.md) [fresh]
- [Implementation Plan](wiki/features/022-brainstorm-command.md) [fresh]
- [Project-Aware Tool Detection Implementation Plan](wiki/features/028-project-aware-tools.md) [fresh]
- [Feature 031: Landing Page Full Light Mode](wiki/features/031-landing-light-mode.md) [fresh]
- [Implementation Plan](wiki/features/018-verification-proof-pr.md) [fresh]
- [Feature 032: Add Mermaid Workflow Diagram to Commands Docs](wiki/features/032-mermaid-workflow-diagram.md) [fresh]
- [Wiki Foundation (Sprint 0)](wiki/features/035-wiki-foundation.md) [fresh]
- [Implementation Plan](wiki/features/027-v10-launch.md) [fresh]
- [Multi-Language Verify Support Implementation Plan](wiki/features/012-multi-language-verify.md) [fresh]
- [Implementation Plan](wiki/features/003-pr-and-init.md) [fresh]
- [Benchmark: Claude + Superpowers vs Claude + Maina](wiki/features/008-benchmark-comparison.md) [fresh]
- [Implementation Plan — v0.3.x Hardening](wiki/features/024-v03x-hardening.md) [fresh]
- [Implementation Plan](wiki/features/020-unified-host-delegation.md) [fresh]
- [Implementation Plan — v0.4.0 Polish + CI](wiki/features/024-v04-polish-ci.md) [fresh]

## Decisions

- [v0.5.0 Cloud Client + maina-cloud](wiki/decisions/0012-v050-cloud-client-maina-cloud.md) [fresh]
- [Post-workflow RL self-improvement loop](wiki/decisions/0006-post-workflow-rl-self-improvement-loop.md) [fresh]
- [Background RL feedback at each workflow step](wiki/decisions/0005-background-rl-feedback-at-each-workflow-step.md) [fresh]
- [v0.4.0 Polish + CI](wiki/decisions/0011-v040-polish-ci.md) [fresh]
- [Workflow context forwarding](wiki/decisions/0004-workflow-context-forwarding.md) [fresh]
- [AI delegation protocol for host agents](wiki/decisions/0009-ai-delegation-protocol-for-host-agents.md) [fresh]
- [Visual verification with Playwright](wiki/decisions/0007-visual-verification-with-playwright.md) [fresh]
- [Multi-language verify pipeline](wiki/decisions/0002-multi-language-verify-pipeline.md) [fresh]
- [Verification proof in PR body](wiki/decisions/0008-verification-proof-in-pr-body.md) [fresh]
- [Karpathy-Principled Spec Quality System](wiki/decisions/0001-karpathy-principled-spec-quality-system.md) [fresh]
- [Fix host delegation for CLI AI tasks](wiki/decisions/0003-fix-host-delegation-for-cli-ai-tasks.md) [fresh]
- [v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD](wiki/decisions/0010-v03x-hardening-verify-gaps-rl-loop-hldlld.md) [fresh]


### Relevant Articles
#### Feature: Feature 031: Landing Page Full Light Mode (wiki/features/031-landing-light-mode.md)
# Feature: Feature 031: Landing Page Full Light Mode

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/017-visual-verification.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/027-v10-launch.md)
# Feature: Implementation Plan

## Scope

### In Scope - Fix bug #47 (brainstorm --no-interactive stubs) - Community files: CONTRIBUTING.md, issue templates, CODEOWNERS, PR template - Repo transfers to mainahq org - Update all GitHub/npm references post-transfer - Enable GitHub Discussions - Show HN + dev.to draft - Version bump to 1.0.0 ### Out of Scope - CF Workers skill (v1.1.0) - Cross-dogfooding report (v1.1.0) - New features — this is polish + launch only

## Tasks

Progress: 0/18 (0%)

- [ ] T001: Fix brainstorm --no-interactive to generate real content (#47)
- [ ] T002: Write test for brainstorm --no-interactive output
- [ ] T003: Create CONTRIBUTING.md
- [ ] T004: Create .github/ISSUE_TEMPLATE/bug_report.yml
- [ ] T005: Create .github/ISSUE_TEMPLATE/feature_request.yml
- [ ] T006: Create .github/PULL_REQUEST_TEMPLATE.md
- [ ] T007: Create CODEOWNERS
- [ ] T008: Transfer beeeku/maina → mainahq/maina
- [ ] T009: Transfer beeeku/maina-cloud → mainahq/maina-cloud
- [ ] T010: Update all internal references post-transfer
- [ ] T011: Enable GitHub Discussions
- [ ] T012: Set up branch protection
- [ ] T013: Write Show HN post draft
- [ ] T014: Write dev.to article draft
- [ ] T015: Update docs landing page for v1.0
- [ ] T016: Create changeset for v1.0.0
- [ ] T017: Version bump + npm publish
- [ ] T018: Close issue #46

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/022-brainstorm-command.md)
# Feature: Implementation Plan

## Scope

### In Scope -  ### Out of Scope -

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan — Feature 011: Self-Improvement (wiki/features/011-self-improvement.md)
# Feature: Implementation Plan — Feature 011: Self-Improvement

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/023-enterprise-languages.md)
# Feature: Implementation Plan

## Scope

### In Scope -  ### Out of Scope -

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan — v0.3.x Hardening (wiki/features/024-v03x-hardening.md)
# Feature: Implementation Plan — v0.3.x Hardening

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Project-Aware Tool Detection Implementation Plan (wiki/features/028-project-aware-tools.md)
# Feature: Project-Aware Tool Detection Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Wiki Foundation (Sprint 0) (wiki/features/035-wiki-foundation.md)
# Feature: Wiki Foundation (Sprint 0)

## Tasks

Progress: 0/7 (0%)

- [ ] T001: Define all wiki types in types.ts
- [ ] T002: Implement state management with SHA-256 hashing (depends on T001)
- [ ] T003: Implement schema management (depends on T001)
- [ ] T004: Implement code entity extractor (depends on T001)
- [ ] T005: Implement feature extractor (depends on T001)
- [ ] T006: Implement decision extractor (depends on T001)
- [ ] T007: Implement workflow trace extractor (depends on T001)

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Feature 032: Add Mermaid Workflow Diagram to Commands Docs (wiki/features/032-mermaid-workflow-diagram.md)
# Feature: Feature 032: Add Mermaid Workflow Diagram to Commands Docs

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Feature 030: Auto-Configure MCP + Agent Instruction Files During Init (wiki/features/030-mcp-agent-files.md)
# Feature: Feature 030: Auto-Configure MCP + Agent Instruction Files During Init

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/004-mcp-server.md)
# Feature: Implementation Plan

## Scope

### In Scope - stdio MCP server with @modelcontextprotocol/sdk - 8 tools delegating to existing engines - Cache-aware responses - `maina --mcp` flag on CLI entrypoint ### Out of Scope - HTTP/SSE transport (stdio only for v1) - MCP resources/prompts (tools only for v1) - Auto-installation into IDE configs

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Install @modelcontextprotocol/sdk, write tests and implement MCP server scaffold with stdio transport
- [ ] T002: Write tests and implement context tools (getContext, getConventions) delegating to Context Engine + Prompt Engine
- [ ] T003: Write tests and implement verify tools (verify, checkSlop) delegating to Verify Engine
- [ ] T004: Write tests and implement feature tools (suggestTests, analyzeFeature) delegating to Features module
- [ ] T005: Write tests and implement explain tool (explainModule) delegating to Explain module
- [ ] T006: Wire --mcp flag into CLI entrypoint and test end-to-end

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/025-v06-hosted-verification.md)
# Feature: Implementation Plan

## Scope

### In Scope - `--cloud` flag on `maina verify` command (maina repo) - `CloudClient.submitVerify/getVerifyStatus/getVerifyResult` methods (maina repo) - Shared type exports: `Finding`, `PipelineResult`, `ToolReport`, `DetectedTool` from `@mainahq/core` - Workers Workflow migration replacing Durable Object (maina-cloud) - `@workkit/ratelimit` middleware on API endpoints (maina-cloud) - `@workkit/cache` SWR keyed on `team_id:diff_hash:prompt_version` (maina-cloud) - `@workkit/crypto` replacing manual sha256/HMAC (maina-cloud) - `mainahq/verify-action` GitHub Action (new repo) ### Out of Scope - Container execution for heavy tools (enterprise, future) - Inline PR review comments (commit status only for now) - Dashboard / billing (v0.7.0) - `mainahq/workflow-action` autonomous coding (v0.7.0+) - New storage schemas

## Tasks

Progress: 0/31 (0%)

- [ ] T001: Write tests for verify type exports from @mainahq/core
- [ ] T002: Create packages/core/src/verify/types.ts, export Finding/PipelineResult/ToolReport/DetectedTool
- [ ] T003: Re-export from packages/core/src/index.ts
- [ ] T004: Write tests for CloudClient.submitVerify
- [ ] T005: Write tests for CloudClient.getVerifyStatus
- [ ] T006: Write tests for CloudClient.getVerifyResult
- [ ] T007: Implement submitVerify, getVerifyStatus, getVerifyResult in client.ts
- [ ] T008: Add types to cloud/types.ts
- [ ] T009: Write tests for verify --cloud flow (submit, poll, render)
- [ ] T010: Add --cloud option to verify command
- [ ] T011: Implement cloud verify flow: submit → poll with spinner → render findings
- [ ] T012: Write tests for Workflow step functions
- [ ] T013: Create src/workflows/verify.ts with 5 Workflow steps
- [ ] T014: Update src/api/verify.ts to dispatch to Workflow
- [ ] T015: Update src/api/webhooks.ts to dispatch to Workflow
- [ ] T016: Remove src/do/verification-session.ts
- [ ] T017: Update wrangler.toml bindings
- [ ] T018: Write tests for rate limit middleware
- [ ] T019: Add @workkit/ratelimit on /verify and /webhooks/github
- [ ] T020: Write tests for KV cache
- [ ] T021: Upgrade cache to @workkit/cache KV with SWR
- [ ] T022: Replace utils/crypto.ts with @workkit/crypto
- [ ] T023: Import types from @mainahq/core, delete duplicates
- [ ] T024: Scaffold mainahq/verify-action repo
- [ ] T025: Write action.yml with inputs (token, base, cloud_url)
- [ ] T026: Implement src/index.ts: diff → submit → poll → exit code
- [ ] T027: Build with ncc, test locally
- [ ] T028: Tag and publish as v1
- [ ] T029: E2E test: maina verify --cloud against staging
- [ ] T030: E2E test: GitHub Action in a test repo
- [ ] T031: E2E test: GitHub App webhook → commit status

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/001-stats-tracker.md)
# Feature: Implementation Plan

## Spec Assertions

- [ ] Record a commit snapshot with timing, token, cache, and quality stats after every successful maina commit via recordSnapshot in commitAction
- [ ] Implement maina stats command showing last commit stats, rolling averages, and trend arrows
- [ ] Support maina stats --json to output raw commit snapshots as JSON
- [ ] Support maina stats --last N to limit displayed commits
- [ ] Compute trends comparing recent N vs previous N commits with directional indicators via getTrends
- [ ] Add commit_snapshots Drizzle schema to the database
- [ ] Stats recording wrapped in try/catch so it never blocks a commit
- [ ] Implement tracker with recordSnapshot, getStats, getLatest, getTrends functions

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Add `commit_snapshots` Drizzle schema to `packages/core/src/db/schema.ts`
- [ ] T002: Write tests for `tracker.ts` — `recordSnapshot`, `getStats`, `getLatest`, `getTrends`
- [ ] T003: Implement `packages/core/src/stats/tracker.ts` with all four functions
- [ ] T004: Write tests for `maina stats` CLI command — default output, `--json`, `--last N`
- [ ] T005: Implement `packages/cli/src/commands/stats.ts` and register in `program.ts`
- [ ] T006: Integrate `recordSnapshot()` into `commitAction()` in commit.ts — capture timing, pipeline result, cache stats

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/013-fix-host-delegation.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/016-post-workflow-rl.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/026-v07-rl-flywheel.md)
# Feature: Implementation Plan

## Scope

### In Scope **Sub-project 1: Daily Audit + Copilot Integration** - `.github/workflows/daily-audit.yml` for maina and maina-cloud repos - Runs maina verify, review, slop, stats, learn --no-interactive - Creates GitHub issues with findings, labeled `audit` + `copilot` - Reusable workflow pattern other repos can copy - Copilot coding agent picks up labeled issues **Sub-project 2: Cloud RL Endpoint + maina learn --cloud** - `POST /feedback/batch` — bulk upload from local feedback.db - D1 table: `feedback_events` (team_id, member_id, prompt_hash, command, accepted, context, diff_hash, timestamp) - Aggregation queries: win rate per prompt_version per task per team - `maina learn --cloud` CLI flag: push local → pull team improvements - A/B test coordination: 90% current, 10% candidate, promote at >N trials + higher win rate **Sub-project 3: Dashboard + Billing** - Hono JSX + htmx pages served from maina-cloud at `/dashboard` - 4 pages: overview (pass rate chart), prompts (A/B results), team (members + usage), billing (Stripe) - Stripe Checkout for Team tier, webhook for subscription events - D1 tables: `subscriptions` (team_id, stripe_customer_id, plan, status, current_period_end) - Tier enforcement middleware: check plan limits before processing verification jobs ### Out of Scope - Real-time WebSocket updates on dashboard - Custom prompt editor in dashboard UI - Cross-team learning (patterns from team A improving team B) - Own model fine-tuning (needs data volume first) - SSO / SAML (Enterprise, future) - Self-hosted deployment (Enterprise, future)

## Tasks

Progress: 0/31 (0%)

- [ ] T001: Create .github/workflows/daily-audit.yml for beeeku/maina
- [ ] T002: Create .github/workflows/daily-audit.yml for beeeku/maina-cloud
- [ ] T003: Test workflow locally with act or manual dispatch
- [ ] T004: Write tests for POST /feedback/batch
- [ ] T005: Add feedback_events table to D1 schema
- [ ] T006: Implement POST /feedback/batch endpoint
- [ ] T007: Write tests for GET /feedback/improvements
- [ ] T008: Implement GET /feedback/improvements (aggregation queries)
- [ ] T009: Add rate limiting on feedback endpoints
- [ ] T010: Write tests for feedback sync (export local → cloud format)
- [ ] T011: Create packages/core/src/feedback/sync.ts
- [ ] T012: Write tests for CloudClient.postFeedbackBatch and getFeedbackImprovements
- [ ] T013: Add postFeedbackBatch, getFeedbackImprovements to CloudClient
- [ ] T014: Write tests for learn --cloud flow
- [ ] T015: Add --cloud flag to learn command
- [ ] T016: Create shared layout with Hono JSX (header, nav, htmx)
- [ ] T017: Write tests for /dashboard routes (auth required, returns HTML)
- [ ] T018: Implement overview page (verification history, pass rate)
- [ ] T019: Implement prompts page (A/B test results)
- [ ] T020: Implement team page (members, usage stats)
- [ ] T021: Implement billing page (current plan, upgrade link)
- [ ] T022: Write tests for billing checkout + webhook endpoints
- [ ] T023: Add subscriptions table to D1 schema
- [ ] T024: Implement POST /billing/checkout (Stripe Checkout session)
- [ ] T025: Implement POST /billing/webhook (Stripe webhook handler)
- [ ] T026: Implement tier enforcement middleware
- [ ] T027: Apply tier middleware to /verify endpoint
- [ ] T028: E2E: daily audit workflow creates issue on findings
- [ ] T029: E2E: maina learn --cloud pushes feedback, pulls improvements
- [ ] T030: E2E: dashboard renders with real data
- [ ] T031: E2E: Stripe checkout → subscription → tier enforcement

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/020-unified-host-delegation.md)
# Feature: Implementation Plan

## Scope

### In Scope -  ### Out of Scope -

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/003-pr-and-init.md)
# Feature: Implementation Plan

## Scope

### In Scope - PR creation via gh CLI, two-stage review core logic, init bootstrapping, status display ### Out of Scope - GitLab/Bitbucket support (GitHub only for v1) - PR merge automation (review only, human merges) - CI workflow for non-GitHub platforms

## Tasks

Progress: 0/5 (0%)

- [ ] T001: Write tests and implement two-stage PR review in packages/core/src/review/index.ts
- [ ] T002: Write tests and implement maina pr CLI command with gh CLI integration
- [ ] T003: Write tests and implement maina init bootstrapping in packages/core/src/init/index.ts
- [ ] T004: Write tests and implement maina init CLI command
- [ ] T005: Write tests and implement maina status CLI command reading working.json

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/002-ticket.md)
# Feature: Implementation Plan

## Spec Assertions

- [ ] `maina ticket` creates a GitHub Issue via the gh CLI
- [ ] Ticket includes a title and body provided by the user via interactive prompts
- [ ] Context Engine semantic layer auto-detects relevant modules and adds them as labels
- [ ] Supports `--title` and `--body` flags for non-interactive use
- [ ] Supports `--label` flag to add custom labels
- [ ] Gracefully handles missing gh CLI with helpful error message
- [ ] Works without AI — module tagging uses tree-sitter entity index, not LLM

## Tasks

Progress: 0/4 (0%)

- [ ] T001: Write tests for core ticket module — detectModules, buildIssueBody, createTicket
- [ ] T002: Implement packages/core/src/ticket/index.ts with gh CLI integration
- [ ] T003: Write tests for maina ticket CLI command — interactive and non-interactive modes
- [ ] T004: Implement packages/cli/src/commands/ticket.ts and register in program.ts

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/009-interactive-design.md)
# Feature: Implementation Plan

## Scope

### In Scope - Interactive question-asking in `maina spec` (B) - Multiple approach proposals in `maina design` (C) - Recording answers/decisions in spec.md and ADR - MCP tool integration for `suggestTests` - `--no-interactive` flag for CI/subagent use ### Out of Scope - Visual companion / browser mockups (A) — future sprint - Redesigning existing commands beyond spec and design - Chat-style multi-turn conversation (questions are one-shot per run) - Custom question templates (use AI to derive from plan content)

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/007-todo-api-crud.md)
# Feature: Implementation Plan

## Scope

### In Scope - HTTP server with JSON CRUD endpoints for todos - Persistent storage across server restarts - Input validation and error handling - Integration tests covering all endpoints ### Out of Scope - Authentication or authorization - Pagination or filtering - Frontend UI

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Set up SQLite database module with lazy-init and todos table
- [ ] T002: Create response envelope helpers (ok, err) matching { data, error, meta }
- [ ] T003: Implement todo repository with list, get, create, update, delete
- [ ] T004: Implement route handlers with input validation
- [ ] T005: Wire up Bun.serve() entrypoint with routes and configurable port
- [ ] T006: Write integration tests covering CRUD lifecycle, validation, and 404s

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Feature 034: v1.1.0 Round-Trip Flywheel — Implementation Plan (wiki/features/034-v110-roundtrip-flywheel.md)
# Feature: Feature 034: v1.1.0 Round-Trip Flywheel — Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan — v0.5.0 Cloud Client + maina-cloud (wiki/features/024-v05-cloud-client.md)
# Feature: Implementation Plan — v0.5.0 Cloud Client + maina-cloud

## Scope

### Cloud API Client (`packages/core/src/cloud/`) - `client.ts` — HTTP client for Maina Cloud API. Handles auth headers, retries, error envelopes. - `types.ts` — Shared request/response types. Used by both CLI and cloud. - `auth.ts` — GitHub OAuth device flow (client-side). Stores token in `~/.maina/auth.json`. ### CLI Commands - `maina login` — GitHub OAuth device flow. Opens browser, polls for token, stores locally. - `maina logout` — Removes stored credentials. - `maina sync push` — Uploads local prompts + feedback to cloud. - `maina sync pull` — Downloads team prompts, merges with local. - `maina team` — Shows team members, roles, prompt sync status. ### Config - `maina configure` gains cloud section: API URL, team ID. - Default API URL: `https://api.mainahq.com` (configurable for self-hosted). ### Scaffold at `mainahq/maina-cloud` (private repo) - Bun + Workkit + Cloudflare Workers project - Health check endpoint (`GET /health`) - Auth endpoint (`POST /auth/device`, `POST /auth/token`) - Prompt sync endpoints (`GET /prompts`, `PUT /prompts`) - Team endpoints (`GET /team`, `POST /team/invite`) - D1 schema: teams, members, prompts, feedback - CLAUDE.md with project conventions

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/005-rl-feedback-and-skills.md)
# Feature: Implementation Plan

## Scope

### In Scope - Feedback collection wired into tryAIGenerate and commit flow - Preference learning from dismissed findings - Episodic compression of accepted reviews - Skills SKILL.md files in packages/skills/ ### Out of Scope - Online learning (real-time prompt updates) — batch only via `maina learn` - Custom model fine-tuning - Skills marketplace or registry

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Write tests and implement feedback collector — wire into tryAIGenerate to record every AI interaction
- [ ] T002: Write tests and implement preference learning — track dismissed findings, write preferences.json
- [ ] T003: Enhance maina learn to propose improved prompts with A/B testing when accept rate drops
- [ ] T004: Write tests and implement episodic compression — accepted reviews become few-shot examples
- [ ] T005: Create skills package with 5 SKILL.md files using progressive disclosure
- [ ] T006: Test skills work in Claude Code context — verify metadata scanning and activation

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Feature 029: AI-Driven Interactive maina init (wiki/features/029-ai-driven-init.md)
# Feature: Feature 029: AI-Driven Interactive maina init

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Benchmark: Claude + Superpowers vs Claude + Maina (wiki/features/008-benchmark-comparison.md)
# Feature: Benchmark: Claude + Superpowers vs Claude + Maina

## Scope

### In Scope - Metrics we can derive from git history, stats.db, feedback.db, benchmarks - Qualitative observations from the development process - Sprint-by-sprint progression showing maina bootstrapping itself ### Out of Scope - A/B testing with separate teams (single developer project) - Cost analysis (API spend tracking not implemented)

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Multi-Language Verify Support Implementation Plan (wiki/features/012-multi-language-verify.md)
# Feature: Multi-Language Verify Support Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/021-ai-delegation-protocol.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/006-karpathy-spec-quality.md)
# Feature: Implementation Plan

## Scope

### In Scope - Spec quality scoring (deterministic, no AI) - Skip event tracking in stats - Red-green enforcement in maina spec - Plan-to-code traceability checking - Spec evolution metrics in maina stats ### Out of Scope - AI-powered spec improvement suggestions (future — use learn command instead) - Blocking commits on low spec scores (warning only) - Cross-project spec comparison

## Tasks

Progress: 0/5 (0%)

- [ ] T001: Write tests and implement spec quality scoring in packages/core/src/features/quality.ts
- [ ] T002: Write tests and implement skip event tracking in stats/tracker.ts
- [ ] T003: Add red-green enforcement to maina spec — auto-run stubs and verify all fail
- [ ] T004: Write tests and implement plan-to-code traceability in packages/core/src/features/traceability.ts
- [ ] T005: Add --specs flag to maina stats showing spec quality evolution over time

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/018-verification-proof-pr.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Feature 033: v1.0.3 Quick Wins (wiki/features/033-v103-quick-wins.md)
# Feature: Feature 033: v1.0.3 Quick Wins

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/014-workflow-context.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/010-benchmark-harness.md)
# Feature: Implementation Plan

## Scope

### In Scope - Benchmark harness CLI command (`maina benchmark`) - Story format (story.json + spec.md + tests/) - Maina pipeline runner (spec → plan → implement → verify → test) - Spec Kit pipeline runner (specify → plan → tasks → implement → test) - Metrics collection (tokens, time, test results, findings, spec score) - JSON + terminal comparison report - Tier 1 story: mitt event emitter ### Out of Scope - Running Spec Kit automatically (requires separate installation — harness records metrics from manual runs) - Generating library code automatically - CI integration - Web dashboard for results

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/015-background-rl-feedback.md)
# Feature: Implementation Plan

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan (wiki/features/019-tool-install-guide.md)
# Feature: Implementation Plan

## Scope

### In Scope -  ### Out of Scope -

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Feature: Implementation Plan — v0.4.0 Polish + CI (wiki/features/024-v04-polish-ci.md)
# Feature: Implementation Plan — v0.4.0 Polish + CI

## Scope

### In Scope - `--json` flag on all commands - Exit codes (0/1/2/3) - GitHub Action (`mainahq/verify-action`) - PHP language profile (PHPStan, Psalm) - Per-file language detection - ZAP DAST integration - Lighthouse integration ### Out of Scope - GitLab CI / Buildkite integrations (deferred to v0.6.0 hosted verify) - PHP framework-specific rules (Laravel, Symfony) - Lighthouse CI (scheduled runs) — just single-run auditing for now

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no

---
#### Decision: Post-workflow RL self-improvement loop (wiki/decisions/0006-post-workflow-rl-self-improvement-loop.md)
# Decision: Post-workflow RL self-improvement loop

> Status: **proposed**

## Context

Feature 015 added `workflow_step` and `workflow_id` columns to feedback records, but nothing reads them. `maina learn` only shows per-command metrics, missing workflow-level patterns.

## Decision

Add `analyseWorkflowFeedback` and `analyseWorkflowRuns` functions to the evolution module. Enhance `maina learn` to show per-step accept rates and recent workflow run summaries. This completes the RL feedback loop: record → analyze → improve.

## Rationale

### Positive

- Per-step visibility: which workflow phases underperform
- Per-run tracking: see if overall workflow quality is trending up
- Data foundation for future correlation analysis

### Negative

- More output in `maina learn` — could feel overwhelming
- Workflow data sparse until enough features go through full lifecycle

### Neutral

- Builds on existing feedback.db schema (no new tables)
- Same A/B testing mechanism, just more data to inform decisions

---
#### Decision: v0.5.0 Cloud Client + maina-cloud (wiki/decisions/0012-v050-cloud-client-maina-cloud.md)
# Decision: v0.5.0 Cloud Client + maina-cloud

> Status: **accepted**

## Context

Maina is local-only. Teams need shared prompts, feedback, and A/B testing coordination. The cloud infrastructure must be private (business logic), while the CLI client stays open source.

## Decision

Split into two repos: open-source CLI client in mainahq/maina, private Workers service repo (mainahq/maina-cloud). Shared types ensure API contract consistency. GitHub OAuth device flow for auth. Workkit packages power the cloud service.

## Rationale

### Positive

- Cloud business logic stays private
- CLI client is open source — community can see how sync works
- Shared types prevent API drift
- Workkit dogfooding starts immediately

### Negative

- Two repos to maintain
- Shared types need manual sync (mitigated by shared types package later)
- OAuth device flow is more complex than simple API key

### Neutral

- Cloud repo is standard Cloudflare Workers project
- API client follows existing Result<T, E> pattern

## Affected Entities

- `packages/core/src/cloud/types.ts`

---
#### Decision: Background RL feedback at each workflow step (wiki/decisions/0005-background-rl-feedback-at-each-workflow-step.md)
# Decision: Background RL feedback at each workflow step

> Status: **proposed**

## Context

The RL feedback loop only captures commit message and review outcomes. Workflow-level data (which specs led to clean code, which reviews caught issues) is lost. Feedback calls are synchronous, adding latency.

## Decision

Add `recordFeedbackAsync` that fires via `queueMicrotask` — zero blocking. Extend feedback records with `workflowStep` and `workflowId` fields. Every CLI command that appends workflow context also records async feedback. `maina learn` shows per-step accept rates.

## Rationale

### Positive

- Full workflow trace captured for every feature
- Zero latency impact — async recording never blocks commands
- `maina learn` can analyze per-step patterns (which steps have low accept rates)

### Negative

- Slightly more data in feedback.db (one row per workflow step per feature)
- Async recording means feedback might be lost if process exits immediately

### Neutral

- Backward compatible — existing `recordFeedback` unchanged
- Uses `queueMicrotask` (Bun native) instead of setTimeout

---
#### Decision: v0.4.0 Polish + CI (wiki/decisions/0011-v040-polish-ci.md)
# Decision: v0.4.0 Polish + CI

> Status: **accepted**

## Context

Maina CLI outputs human-readable text only. CI pipelines need machine-readable JSON, meaningful exit codes, and a GitHub Action for easy integration. The language profile system only detects a project's primary language, missing per-file analysis in polyglot repos. PHP (4th most popular backend language) has no support. DAST and performance auditing are gaps in the verification pipeline.

## Decision

Add 7 features in 4 phases: structured output (--json, exit codes), CI integration (GitHub Action), language expansion (PHP, per-file detection), and new verification tools (ZAP DAST, Lighthouse).

## Rationale

### Positive

- Every maina command becomes CI-ready with `--json` and meaningful exit codes
- GitHub Action makes adoption a 3-line YAML change
- PHP developers can use maina
- Polyglot repos get accurate per-file analysis
- Security and performance coverage expands

### Negative

- ZAP requires Docker, adding a dependency for DAST
- Lighthouse adds ~5s to verification when enabled
- More language profiles = more maintenance surface

### Neutral

- --json flag adds minimal code per command (serialize existing types)
- Exit codes are a one-time change to the CLI entrypoint

## Affected Entities

- `src/commands/*.ts`
- `src/index.ts`
- `src/json.ts`
- `src/language/profile.ts`
- `src/language/detect.ts`
- `src/verify/pipeline.ts`
- `src/verify/zap.ts`
- `src/verify/lighthouse.ts`

---
#### Decision: Workflow context forwarding (wiki/decisions/0004-workflow-context-forwarding.md)
# Decision: Workflow context forwarding

> Status: **proposed**

## Context

Each maina workflow step is stateless. Step N has no knowledge of steps 1 through N-1. This causes AI calls to miss spec decisions, design review flags, and prior verification results.

## Decision

Add a rolling workflow context file (`.maina/workflow/current.md`) that each maina command appends to. The context engine includes this in the working layer, making it available to all AI calls. `maina plan` resets it for new features.

## Rationale

### Positive

- Every workflow step has full context from prior steps
- AI calls (review, commit, design) make better decisions with workflow history
- Human-readable markdown — easy to inspect and debug

### Negative

- File grows with each step (~100 tokens per step, ~1000 tokens for a full workflow)
- Must be reset correctly on new features to avoid stale context

### Neutral

- Follows the same file-based pattern as working.json

---
#### Decision: AI delegation protocol for host agents (wiki/decisions/0009-ai-delegation-protocol-for-host-agents.md)
# Decision: AI delegation protocol for host agents

> Status: **proposed**

## Context

AI features are non-functional when maina runs as a subprocess inside Claude Code, Codex, or OpenCode. No API key is available. The current DelegationPrompt object is returned but never acted on.

## Decision

Plain text stdout protocol. AI-dependent steps output `---MAINA_AI_REQUEST---` blocks. Any host agent reading stdout can parse and process them. No IPC, no binary, no dependencies.

## Rationale

### Positive

- AI features work in every MCP-compatible host
- Zero integration effort for hosts — just parse stdout
- Existing direct API path unchanged

### Negative

- Host must understand the protocol (simple text parsing)
- No result injection back into pipeline (host acts independently)

### Neutral

- Protocol is versioned and extensible

---
#### Decision: Visual verification with Playwright (wiki/decisions/0007-visual-verification-with-playwright.md)
# Decision: Visual verification with Playwright

> Status: **proposed**

## Context

Maina verifies code correctness but not visual correctness. Web projects can pass all gates and still ship broken layouts. This is the last verification gap.

## Decision

Add visual verification using Playwright for screenshots and pixelmatch for pixel comparison. Opt-in via `maina verify --visual`. Baselines stored in `.maina/visual-baselines/` and committed to git. Configurable threshold and URLs in preferences.json.

## Rationale

### Positive

- Visual regressions caught before merge
- Baselines as source of truth — reviewable in PRs
- No external service dependency (all local)

### Negative

- Requires Playwright installed (graceful skip if missing)
- Slower than static analysis (~5-10s per page)
- Baselines add to repo size (PNG files)

### Neutral

- Opt-in only — doesn't slow default verify
- Chromium-only for v1, expandable later

---
#### Decision: Multi-language verify pipeline (wiki/decisions/0002-multi-language-verify-pipeline.md)
# Decision: Multi-language verify pipeline

> Status: **accepted**

## Context

Maina's verify pipeline was hardcoded for TypeScript/JavaScript — Biome for syntax guard, JS-specific slop patterns, tree-sitter tuned for TS imports, file collectors only scanning .ts/.js. This blocked adoption for any non-TypeScript project, contradicting the product spec's "any repo" promise.

## Decision

Introduce a LanguageProfile abstraction that maps each supported language to its tools, file patterns, and slop detection rules. The pipeline auto-detects languages from project marker files and routes to the appropriate linter.

Supported languages: TypeScript (Biome), Python (ruff), Go (go vet), Rust (clippy).

## Rationale

### Positive

- Maina works with Python, Go, and Rust projects out of the box
- Language detection is automatic — no configuration needed
- Existing TypeScript behavior is fully preserved (backward compatible)
- Adding new languages requires only a new LanguageProfile entry

### Negative

- More tools to maintain (ruff, go vet, clippy parsers)
- Polyglot repos use primary language only (no per-file language detection)

### Neutral

- Future languages (Java, C#, Ruby) follow the same pattern

---
#### Decision: Verification proof in PR body (wiki/decisions/0008-verification-proof-in-pr-body.md)
# Decision: Verification proof in PR body

> Status: **proposed**

## Context

PRs include no evidence that verification ran. Reviewers must trust claims like "tests pass" without proof.

## Decision

Add `buildVerificationProof` to gather pipeline, test, review, slop, and visual results into a formatted markdown section. `maina pr` appends this proof to the PR body automatically using collapsible `<details>` blocks.

## Rationale

### Positive

- Every PR carries auditable verification evidence
- Reviewers can expand sections to see per-tool results
- Visual regression data visible in PR without leaving GitHub

### Negative

- PR body becomes longer (mitigated by collapsible sections)
- Adds ~5-10s to PR creation (runs verification pipeline)

### Neutral

- Does not block PR creation on failure — just reports

---
#### Decision: Karpathy-Principled Spec Quality System (wiki/decisions/0001-karpathy-principled-spec-quality-system.md)
# Decision: Karpathy-Principled Spec Quality System

> Status: **proposed**

## Context

After 8 sprints and 769 tests, maina has a complete verification pipeline for code but no quality gate for specifications. The spec/plan analyzer catches structural issues (missing sections, orphaned tasks) but doesn't measure whether specs are actually good — measurable, testable, unambiguous.

Andrej Karpathy's principles apply directly:
- "The most dangerous thing is a slightly wrong answer" — A spec that seems complete but has gaps is worse than no spec
- "You need to stare at your data" — Specs are training data for implementation. Garbage in, garbage out.
- "Loss curves don't lie" — Track spec quality metrics over time. Are they improving?

Additionally, the code review revealed we need rationalization prevention (skip tracking) and red-green enforcement for test stubs.

## Decision

Build a spec quality scoring system that:

1. **Scores specs 0-100** based on measurability, testability, ambiguity, completeness
2. **Tracks skip events** when developers bypass verification (rationalization prevention)
3. **Enforces red-green** by verifying test stubs actually fail before implementation
4. **Traces plan→code→test→commit** to ensure nothing falls through cracks
5. **Shows spec evolution** in `maina stats --specs` to prove quality is trending up

All checks are deterministic — no AI needed. This is the Karpathy principle: measure everything, trust nothing.

## Rationale

### Positive

- Specs become measurably better over time (tracked via stats)
- Developers can't rationalize skipping verification without it being recorded
- Test stubs that pass immediately are flagged as suspicious (not testing anything)
- Every plan task is traceable to test + code + commit

### Negative

- Additional overhead on each commit (spec quality check)
- False positives from measurability heuristics (vague verb detection isn't perfect)
- Skip tracking might feel punitive — needs to be presented as data, not judgment

### Neutral

- Requires cultural shift: specs are first-class artifacts, not throwaway docs
- Quality scores are relative to the project — not comparable across projects

---
#### Decision: Fix host delegation for CLI AI tasks (wiki/decisions/0003-fix-host-delegation-for-cli-ai-tasks.md)
# Decision: Fix host delegation for CLI AI tasks

> Status: **proposed**

## Context

When `maina design --hld` runs inside Claude Code, the subprocess detects host mode (CLAUDECODE=1) but has no API keys. `shouldDelegateToHost()` returns true, but the subprocess can't send delegation prompts back to the host. AI-dependent CLI commands silently produce empty output.

## Decision

Three changes:
1. `tryAIGenerate` strips `[HOST_DELEGATION]` prefix and returns the structured prompt as usable text instead of marking it as delegation
2. `generateHldLld` returns an explicit error instead of silent null when AI is unavailable
3. CLI design command shows clear error message when HLD generation fails

## Rationale

### Positive

- No more silently empty ADRs from `--hld`
- Clear error messages when AI is unavailable
- Host delegation text is usable as structured content

### Negative

- Delegation text is a prompt, not AI-generated content — lower quality than actual AI output

### Neutral

- MCP delegation path unchanged
- Users with API keys unaffected

---
#### Decision: v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD (wiki/decisions/0010-v03x-hardening-verify-gaps-rl-loop-hldlld.md)
# Decision: v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD

> Status: **accepted**

## Context

Tier 3 benchmark (2026-04-03): SpecKit achieved 100% on 95 hidden validation tests. Maina got 97.9% (2 bugs). SpecKit's 58s self-review caught 4 issues that Maina's verify pipeline missed because no external tools were installed. `maina verify` returned "0 findings, passed" — false confidence.

Additionally, `maina design` only produces ADR scaffolds with no HLD/LLD generation, `maina spec` and `maina design` lack `--auto` flags (blocking CI/benchmark automation), and the RL loop doesn't close automatically after workflow completion.

## Decision

Add built-in verification checks that work without external tools, AI-powered review via delegation protocol, HLD/LLD generation in design, automation flags, and automatic post-workflow RL trace analysis. Execute sequentially: deterministic checks first, then AI features, then automation.

## Rationale

### Positive

- `maina verify` produces meaningful findings on any project, even with 0 external tools installed
- AI self-review catches cross-function consistency bugs that deterministic tools miss
- `maina design` generates useful HLD/LLD from spec, not just empty templates
- `--auto` flags enable full workflow automation in CI and benchmarks
- RL loop closes automatically — prompts improve without human intervention

### Negative

- AI self-review adds latency (~3s mechanical, ~15s deep)
- Cross-function consistency check depends on tree-sitter AST quality per language
- Automatic RL could theoretically degrade prompts (mitigated by A/B testing with rollback)

### Neutral

- Built-in typecheck duplicates what external tools do, but guarantees baseline coverage
- HLD/LLD quality depends on spec quality — garbage in, garbage out

---
#### Architecture: Monorepo Structure (wiki/architecture/monorepo-structure.md)
# Architecture: Monorepo Structure

> Auto-generated architecture article describing the monorepo layout.

Maina is organized as a monorepo under `packages/`.

## Packages

### cli

- **Path:** `packages/cli/`
- **Description:** Commander entrypoint, commands (thin wrappers over engines), terminal UI
- **Modules:** __tests__, commands

### core

- **Path:** `packages/core/`
- **Description:** Three engines + cache + AI + git + DB + hooks
- **Modules:** ai, benchmark, cache, cloud, config, context, db, design, explain, features, feedback, git, hooks, init, language, prompts, review, stats, ticket, verify, wiki, workflow

### docs

- **Path:** `packages/docs/`
- **Description:** Documentation site
- **Modules:** assets, components, content, pages, styles

### mcp

- **Path:** `packages/mcp/`
- **Description:** MCP server (delegates to engines)
- **Modules:** __tests__, tools

### skills

- **Path:** `packages/skills/`
- **Description:** Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI)

---
#### Architecture: Verification Pipeline (wiki/architecture/verification-pipeline.md)
# Architecture: Verification Pipeline

> Auto-generated architecture article listing all verify tools.

The verification pipeline runs a multi-stage process to prove AI-generated code is correct before it merges.

## Pipeline Stages

1. **Syntax Guard** — Fast linting (<500ms)
2. **Parallel Deterministic Tools** — Semgrep, Trivy, Secretlint, SonarQube, coverage, mutation
3. **Diff-Only Filter** — Only report findings on changed lines
4. **AI Fix** — Automatic fix suggestions
5. **Two-Stage AI Review** — Spec compliance, then code quality

## Verify Tools

- **ai-review** — Two-stage AI review (spec compliance + code quality)
- **builtin** — Built-in verification checks
- **consistency** — Code consistency analysis
- **coverage** — Code coverage tracking via diff-cover
- **detect** — Language and tool detection
- **diff-filter** — Diff-only filter — only report findings on changed lines
- **fix** — AI-powered automatic fix suggestions
- **lighthouse** — Lighthouse performance audits
- **mutation** — Mutation testing via Stryker
- **pipeline** — Verification pipeline orchestrator
- **proof** — Verification proof generation for PR bodies
- **secretlint** — Secret detection in code and config files
- **semgrep** — Static analysis via Semgrep rules
- **slop** — AI slop detection — catches lazy/generic AI output patterns
- **sonar** — SonarQube code quality analysis
- **syntax-guard** — Fast syntax checking (<500ms) via language-specific linters
- **trivy** — Container and dependency vulnerability scanning
- **typecheck** — TypeScript type checking
- **types** — `verify/types.ts`
- **visual** — Visual verification with Playwright
- **zap** — OWASP ZAP security scanning

## Language-Specific Linters

- **checkstyle** — `verify/linters/checkstyle.ts`
- **clippy** — `verify/linters/clippy.ts`
- **dotnet-format** — `verify/linters/dotnet-format.ts`
- **go-vet** — `verify/linters/go-vet.ts`
- **ruff** — `verify/linters/ruff.ts`

## Additional Tools

- **wiki-lint-runner** — `verify/tools/wiki-lint-runner.ts`
- **wiki-lint** — `verify/tools/wiki-lint.ts`

---
#### Architecture: Three Engines (wiki/architecture/three-engines.md)
# Architecture: Three Engines

> Auto-generated architecture article describing the three-engine pattern.

Maina's core is organized around three engines that work together:

1. **Context Engine** (`context/`) — Observes the codebase via 4-layer retrieval (Working, Episodic, Semantic, Retrieval), PageRank scoring, and dynamic token budgets.
2. **Prompt Engine** (`prompts/`) — Learns from project conventions via constitution loading, custom prompts, versioning, and A/B-tested evolution.
3. **Verify Engine** (`verify/`) — Verifies AI-generated code via a multi-stage pipeline: syntax guard, parallel tools, diff filter, AI fix, and two-stage review.

## Context Engine

Source files (`packages/core/src/context/`):

- `budget.ts`
- `engine.ts`
- `episodic.ts`
- `relevance.ts`
- `retrieval.ts`
- `selector.ts`
- `semantic.ts`
- `treesitter.ts`
- `wiki.ts`
- `working.ts`

## Prompts Engine

Source files (`packages/core/src/prompts/`):

- `engine.ts`
- `evolution.ts`
- `loader.ts`

## Verify Engine

Source files (`packages/core/src/verify/`):

- `ai-review.ts`
- `builtin.ts`
- `consistency.ts`
- `coverage.ts`
- `detect.ts`
- `diff-filter.ts`
- `fix.ts`
- `lighthouse.ts`
- `mutation.ts`
- `pipeline.ts`
- `proof.ts`
- `secretlint.ts`
- `semgrep.ts`
- `slop.ts`
- `sonar.ts`
- `syntax-guard.ts`
- `trivy.ts`
- `typecheck.ts`
- `types.ts`
- `visual.ts`
- `zap.ts`

---
#### Module: cluster-65 (wiki/modules/cluster-65.md)
# Module: cluster-65

> Auto-generated module article for `cluster-65`.

## Entities

- **detectSlop** (function) — `packages/core/src/verify/slop.ts:434` [PR: 0.0020]
- **detectCommentedCode** (function) — `packages/core/src/verify/slop.ts:326` [PR: 0.0014]
- **detectTodosWithoutTickets** (function) — `packages/core/src/verify/slop.ts:282` [PR: 0.0011]
- **detectConsoleLogs** (function) — `packages/core/src/verify/slop.ts:238` [PR: 0.0009]
- **detectHallucinatedImports** (function) — `packages/core/src/verify/slop.ts:162` [PR: 0.0008]
- **detectEmptyBodies** (function) — `packages/core/src/verify/slop.ts:57` [PR: 0.0007]
- **SlopResult** (interface) — `packages/core/src/verify/slop.ts:28` [PR: 0.0006]
- **SlopRule** (type) — `packages/core/src/verify/slop.ts:21` [PR: 0.0005]

---
#### Module: language (wiki/modules/language.md)
# Module: language

> Auto-generated module article for `language`.

## Entities

- **getSupportedLanguages** (function) — `packages/core/src/language/profile.ts:173` [PR: 0.0028]
- **getProfile** (function) — `packages/core/src/language/profile.ts:169` [PR: 0.0019]
- **PROFILES** (variable) — `packages/core/src/language/profile.ts:159` [PR: 0.0015]
- **PHP_PROFILE** (variable) — `packages/core/src/language/profile.ts:139` [PR: 0.0012]
- **JAVA_PROFILE** (variable) — `packages/core/src/language/profile.ts:125` [PR: 0.0011]
- **CSHARP_PROFILE** (variable) — `packages/core/src/language/profile.ts:104` [PR: 0.0009]
- **RUST_PROFILE** (variable) — `packages/core/src/language/profile.ts:84` [PR: 0.0008]
- **GO_PROFILE** (variable) — `packages/core/src/language/profile.ts:70` [PR: 0.0007]
- **PYTHON_PROFILE** (variable) — `packages/core/src/language/profile.ts:51` [PR: 0.0007]
- **TYPESCRIPT_PROFILE** (variable) — `packages/core/src/language/profile.ts:29` [PR: 0.0006]
- **LanguageProfile** (interface) — `packages/core/src/language/profile.ts:15` [PR: 0.0006]
- **LanguageId** (type) — `packages/core/src/language/profile.ts:6` [PR: 0.0005]

---
#### Module: cluster-34 (wiki/modules/cluster-34.md)
# Module: cluster-34

> Auto-generated module article for `cluster-34`.

## Entities

- **getPromptStats** (function) — `packages/core/src/prompts/engine.ts:115` [PR: 0.0016]
- **recordOutcome** (function) — `packages/core/src/prompts/engine.ts:88` [PR: 0.0011]
- **buildSystemPrompt** (function) — `packages/core/src/prompts/engine.ts:34` [PR: 0.0009]
- **PromptStat** (interface) — `packages/core/src/prompts/engine.ts:23` [PR: 0.0007]
- **FeedbackOutcome** (interface) — `packages/core/src/prompts/engine.ts:17` [PR: 0.0006]
- **BuiltPrompt** (interface) — `packages/core/src/prompts/engine.ts:12` [PR: 0.0005]

---
#### Module: cluster-148 (wiki/modules/cluster-148.md)
# Module: cluster-148

> Auto-generated module article for `cluster-148`.

## Entities

_No entities detected._

---
#### Module: cluster-96 (wiki/modules/cluster-96.md)
# Module: cluster-96

> Auto-generated module article for `cluster-96`.

## Entities

- **assembleWikiText** (function) — `packages/core/src/context/wiki.ts:270` [PR: 0.0010]
- **loadWikiContext** (function) — `packages/core/src/context/wiki.ts:170` [PR: 0.0007]
- **WikiContextOptions** (interface) — `packages/core/src/context/wiki.ts:8` [PR: 0.0005]

---
#### Module: cluster-119 (wiki/modules/cluster-119.md)
# Module: cluster-119

> Auto-generated module article for `cluster-119`.

## Entities

- **generateHldLld** (function) — `packages/core/src/design/index.ts:260` [PR: 0.0014]
- **listAdrs** (function) — `packages/core/src/design/index.ts:194` [PR: 0.0010]
- **scaffoldAdr** (function) — `packages/core/src/design/index.ts:162` [PR: 0.0008]
- **getNextAdrNumber** (function) — `packages/core/src/design/index.ts:128` [PR: 0.0006]
- **AdrSummary** (interface) — `packages/core/src/design/index.ts:16` [PR: 0.0005]

---
#### Module: stats (wiki/modules/stats.md)
# Module: stats

> Auto-generated module article for `stats`.

## Entities

- **getToolUsageStats** (function) — `packages/core/src/stats/tracker.ts:536` [PR: 0.0035]
- **trackToolUsage** (function) — `packages/core/src/stats/tracker.ts:512` [PR: 0.0024]
- **ToolUsageStats** (interface) — `packages/core/src/stats/tracker.ts:502` [PR: 0.0019]
- **ToolUsageInput** (interface) — `packages/core/src/stats/tracker.ts:494` [PR: 0.0016]
- **getSkipRate** (function) — `packages/core/src/stats/tracker.ts:466` [PR: 0.0013]
- **getComparison** (function) — `packages/core/src/stats/tracker.ts:382` [PR: 0.0012]
- **getTrends** (function) — `packages/core/src/stats/tracker.ts:289` [PR: 0.0010]
- **getStats** (function) — `packages/core/src/stats/tracker.ts:203` [PR: 0.0009]
- **getLatest** (function) — `packages/core/src/stats/tracker.ts:182` [PR: 0.0009]
- **recordSnapshot** (function) — `packages/core/src/stats/tracker.ts:127` [PR: 0.0008]
- **ComparisonReport** (interface) — `packages/core/src/stats/tracker.ts:50` [PR: 0.0007]
- **TrendsReport** (interface) — `packages/core/src/stats/tracker.ts:42` [PR: 0.0007]
- **TrendDirection** (type) — `packages/core/src/stats/tracker.ts:40` [PR: 0.0006]
- **StatsReport** (interface) — `packages/core/src/stats/tracker.ts:29` [PR: 0.0006]
- **CommitSnapshot** (interface) — `packages/core/src/stats/tracker.ts:22` [PR: 0.0006]
- **SnapshotInput** (interface) — `packages/core/src/stats/tracker.ts:4` [PR: 0.0005]

---
#### Module: cluster-1 (wiki/modules/cluster-1.md)
# Module: cluster-1

> Auto-generated module article for `cluster-1`.

## Entities

_No entities detected._

---
#### Module: cluster-41 (wiki/modules/cluster-41.md)
# Module: cluster-41

> Auto-generated module article for `cluster-41`.

## Entities

- **initCommand** (function) — `packages/cli/src/commands/init.ts:368` [PR: 0.0018]
- **initAction** (function) — `packages/cli/src/commands/init.ts:115` [PR: 0.0013]
- **saveApiKeyToEnv** (function) — `packages/cli/src/commands/init.ts:106` [PR: 0.0010]
- **ensureGitignoreHasMainaEnv** (function) — `packages/cli/src/commands/init.ts:88` [PR: 0.0008]
- **detectAIAvailability** (function) — `packages/cli/src/commands/init.ts:73` [PR: 0.0007]
- **InitActionDeps** (interface) — `packages/cli/src/commands/init.ts:28` [PR: 0.0006]
- **InitActionOptions** (interface) — `packages/cli/src/commands/init.ts:21` [PR: 0.0005]

---
#### Module: cluster-10 (wiki/modules/cluster-10.md)
# Module: cluster-10

> Auto-generated module article for `cluster-10`.

## Entities

_No entities detected._

---
#### Module: cluster-109 (wiki/modules/cluster-109.md)
# Module: cluster-109

> Auto-generated module article for `cluster-109`.

## Entities

- **deleteTodo** (function) — `examples/todo-api/src/repo.ts:65` [PR: 0.0016]
- **updateTodo** (function) — `examples/todo-api/src/repo.ts:42` [PR: 0.0011]
- **createTodo** (function) — `examples/todo-api/src/repo.ts:35` [PR: 0.0009]
- **getTodo** (function) — `examples/todo-api/src/repo.ts:28` [PR: 0.0007]
- **listTodos** (function) — `examples/todo-api/src/repo.ts:21` [PR: 0.0006]
- **Todo** (interface) — `examples/todo-api/src/repo.ts:3` [PR: 0.0005]

---
#### Module: cluster-86 (wiki/modules/cluster-86.md)
# Module: cluster-86

> Auto-generated module article for `cluster-86`.

## Entities

- **visualCommand** (function) — `packages/cli/src/commands/visual.ts:40` [PR: 0.0012]
- **visualUpdateAction** (function) — `packages/cli/src/commands/visual.ts:20` [PR: 0.0009]
- **VisualActionResult** (interface) — `packages/cli/src/commands/visual.ts:15` [PR: 0.0007]
- **VisualActionOptions** (interface) — `packages/cli/src/commands/visual.ts:11` [PR: 0.0005]

---
#### Module: cluster-158 (wiki/modules/cluster-158.md)
# Module: cluster-158

> Auto-generated module article for `cluster-158`.

## Entities

_No entities detected._

---
#### Module: cluster-24 (wiki/modules/cluster-24.md)
# Module: cluster-24

> Auto-generated module article for `cluster-24`.

## Entities

- **comprehensiveReview** (function) — `packages/core/src/review/comprehensive.ts:101` [PR: 0.0014]
- **ComprehensiveReviewOptions** (interface) — `packages/core/src/review/comprehensive.ts:48` [PR: 0.0010]
- **ComprehensiveReviewResult** (interface) — `packages/core/src/review/comprehensive.ts:23` [PR: 0.0008]
- **ComprehensiveReviewFinding** (interface) — `packages/core/src/review/comprehensive.ts:8` [PR: 0.0006]
- **ReviewSeverity** (type) — `packages/core/src/review/comprehensive.ts:6` [PR: 0.0005]

---
#### Module: cluster-75 (wiki/modules/cluster-75.md)
# Module: cluster-75

> Auto-generated module article for `cluster-75`.

## Entities

- **ticketCommand** (function) — `packages/cli/src/commands/ticket.ts:144` [PR: 0.0014]
- **ticketAction** (function) — `packages/cli/src/commands/ticket.ts:41` [PR: 0.0010]
- **TicketDeps** (interface) — `packages/cli/src/commands/ticket.ts:25` [PR: 0.0008]
- **TicketActionResult** (interface) — `packages/cli/src/commands/ticket.ts:19` [PR: 0.0006]
- **TicketActionOptions** (interface) — `packages/cli/src/commands/ticket.ts:11` [PR: 0.0005]

---
#### Module: cluster-129 (wiki/modules/cluster-129.md)
# Module: cluster-129

> Auto-generated module article for `cluster-129`.

## Entities

- **renderTemplate** (function) — `packages/core/src/prompts/loader.ts:61` [PR: 0.0011]
- **mergePrompts** (function) — `packages/core/src/prompts/loader.ts:47` [PR: 0.0008]
- **loadUserOverride** (function) — `packages/core/src/prompts/loader.ts:25` [PR: 0.0006]

---
#### Module: defaults (wiki/modules/defaults.md)
# Module: defaults

> Auto-generated module article for `defaults`.

## Entities

- **loadDefault** (function) — `packages/core/src/prompts/defaults/index.ts:32` [PR: 0.0008]
- **PromptTask** (type) — `packages/core/src/prompts/defaults/index.ts:3` [PR: 0.0005]

---
#### Module: cluster-30 (wiki/modules/cluster-30.md)
# Module: cluster-30

> Auto-generated module article for `cluster-30`.

## Entities

- **designCommand** (function) — `packages/cli/src/commands/design.ts:318` [PR: 0.0014]
- **designAction** (function) — `packages/cli/src/commands/design.ts:82` [PR: 0.0010]
- **DesignDeps** (interface) — `packages/cli/src/commands/design.ts:43` [PR: 0.0008]
- **DesignActionResult** (interface) — `packages/cli/src/commands/design.ts:34` [PR: 0.0006]
- **DesignActionOptions** (interface) — `packages/cli/src/commands/design.ts:26` [PR: 0.0005]

---
#### Module: cluster-61 (wiki/modules/cluster-61.md)
# Module: cluster-61

> Auto-generated module article for `cluster-61`.

## Entities

- **runSecretlint** (function) — `packages/core/src/verify/secretlint.ts:133` [PR: 0.0012]
- **parseSecretlintOutput** (function) — `packages/core/src/verify/secretlint.ts:64` [PR: 0.0009]
- **SecretlintResult** (interface) — `packages/core/src/verify/secretlint.ts:21` [PR: 0.0007]
- **SecretlintOptions** (interface) — `packages/core/src/verify/secretlint.ts:14` [PR: 0.0005]

---
#### Module: cluster-92 (wiki/modules/cluster-92.md)
# Module: cluster-92

> Auto-generated module article for `cluster-92`.

## Entities

- **runZap** (function) — `packages/core/src/verify/zap.ts:149` [PR: 0.0012]
- **parseZapJson** (function) — `packages/core/src/verify/zap.ts:76` [PR: 0.0009]
- **ZapResult** (interface) — `packages/core/src/verify/zap.ts:21` [PR: 0.0007]
- **ZapOptions** (interface) — `packages/core/src/verify/zap.ts:14` [PR: 0.0005]

---
#### Module: cluster-5 (wiki/modules/cluster-5.md)
# Module: cluster-5

> Auto-generated module article for `cluster-5`.

## Entities

_No entities detected._

---
#### Module: cluster-71 (wiki/modules/cluster-71.md)
# Module: cluster-71

> Auto-generated module article for `cluster-71`.

## Entities

- **isToolAvailable (packages)** (function) — `packages/core/src/context/retrieval.ts:19` [PR: 0.0023]
- **isToolAvailable (packages)** (function) — `packages/core/src/verify/detect.ts:317` [PR: 0.0023]
- **detectTools** (function) — `packages/core/src/verify/detect.ts:298` [PR: 0.0015]
- **detectTool** (function) — `packages/core/src/verify/detect.ts:253` [PR: 0.0012]
- **getToolsForLanguages** (function) — `packages/core/src/verify/detect.ts:166` [PR: 0.0010]
- **TOOL_REGISTRY** (variable) — `packages/core/src/verify/detect.ts:49` [PR: 0.0008]
- **ToolRegistryEntry** (interface) — `packages/core/src/verify/detect.ts:42` [PR: 0.0007]
- **ToolTier** (type) — `packages/core/src/verify/detect.ts:40` [PR: 0.0007]
- **DetectedTool** (interface) — `packages/core/src/verify/detect.ts:33` [PR: 0.0006]
- **ToolName** (type) — `packages/core/src/verify/detect.ts:13` [PR: 0.0005]

---
#### Module: cluster-139 (wiki/modules/cluster-139.md)
# Module: cluster-139

> Auto-generated module article for `cluster-139`.

## Entities

- **validateAIOutput** (function) — `packages/core/src/ai/validate.ts:42` [PR: 0.0008]
- **AIValidationResult** (interface) — `packages/core/src/ai/validate.ts:8` [PR: 0.0005]

---
#### Module: cluster-168 (wiki/modules/cluster-168.md)
# Module: cluster-168

> Auto-generated module article for `cluster-168`.

## Entities

_No entities detected._

---
#### Module: src (wiki/modules/src.md)
# Module: src

> Auto-generated module article for `src`.

## Entities

- **exitCodeFromResult** (function) — `packages/cli/src/json.ts:27` [PR: 0.0016]
- **outputJson** (function) — `packages/cli/src/json.ts:19` [PR: 0.0011]
- **EXIT_CONFIG_ERROR** (variable) — `packages/cli/src/json.ts:13` [PR: 0.0009]
- **EXIT_TOOL_FAILURE** (variable) — `packages/cli/src/json.ts:12` [PR: 0.0007]
- **EXIT_FINDINGS** (variable) — `packages/cli/src/json.ts:11` [PR: 0.0006]
- **VERSION** (variable) — `packages/core/src/index.ts:1` [PR: 0.0005]
- **collections** (variable) — `packages/docs/src/content.config.ts:5` [PR: 0.0005]
- **EXIT_PASSED** (variable) — `packages/cli/src/json.ts:10` [PR: 0.0005]
- **createProgram** (function) — `packages/cli/src/program.ts:33` [PR: 0.0005]

---
#### Module: cluster-14 (wiki/modules/cluster-14.md)
# Module: cluster-14

> Auto-generated module article for `cluster-14`.

## Entities

- **analyzeCommand** (function) — `packages/cli/src/commands/analyze.ts:266` [PR: 0.0014]
- **analyzeAction** (function) — `packages/cli/src/commands/analyze.ts:128` [PR: 0.0010]
- **AnalyzeDeps** (interface) — `packages/cli/src/commands/analyze.ts:29` [PR: 0.0008]
- **AnalyzeActionResult** (interface) — `packages/cli/src/commands/analyze.ts:17` [PR: 0.0006]
- **AnalyzeActionOptions** (interface) — `packages/cli/src/commands/analyze.ts:10` [PR: 0.0005]

---
#### Module: cluster-45 (wiki/modules/cluster-45.md)
# Module: cluster-45

> Auto-generated module article for `cluster-45`.

## Entities

- **detectCommunities** (function) — `packages/core/src/wiki/louvain.ts:81` [PR: 0.0010]
- **LouvainResult** (interface) — `packages/core/src/wiki/louvain.ts:21` [PR: 0.0007]
- **LouvainNode** (interface) — `packages/core/src/wiki/louvain.ts:16` [PR: 0.0005]

---
#### Module: cluster-54 (wiki/modules/cluster-54.md)
# Module: cluster-54

> Auto-generated module article for `cluster-54`.

## Entities

- **prCommand** (function) — `packages/cli/src/commands/pr.ts:338` [PR: 0.0014]
- **prAction** (function) — `packages/cli/src/commands/pr.ts:212` [PR: 0.0010]
- **PrDeps** (interface) — `packages/cli/src/commands/pr.ts:34` [PR: 0.0008]
- **PrActionResult** (interface) — `packages/cli/src/commands/pr.ts:27` [PR: 0.0006]
- **PrActionOptions** (interface) — `packages/cli/src/commands/pr.ts:20` [PR: 0.0005]

---
#### Module: cluster-128 (wiki/modules/cluster-128.md)
# Module: cluster-128

> Auto-generated module article for `cluster-128`.

## Entities

- **loadStory** (function) — `packages/core/src/benchmark/story-loader.ts:41` [PR: 0.0008]
- **listStories** (function) — `packages/core/src/benchmark/story-loader.ts:10` [PR: 0.0005]

---
#### Module: cluster-31 (wiki/modules/cluster-31.md)
# Module: cluster-31

> Auto-generated module article for `cluster-31`.

## Entities

- **doctorCommand** (function) — `packages/cli/src/commands/doctor.ts:442` [PR: 0.0020]
- **doctorAction** (function) — `packages/cli/src/commands/doctor.ts:365` [PR: 0.0014]
- **DoctorActionResult** (interface) — `packages/cli/src/commands/doctor.ts:53` [PR: 0.0011]
- **McpHealth** (interface) — `packages/cli/src/commands/doctor.ts:46` [PR: 0.0009]
- **WikiHealth** (interface) — `packages/cli/src/commands/doctor.ts:38` [PR: 0.0008]
- **AIStatus** (interface) — `packages/cli/src/commands/doctor.ts:29` [PR: 0.0007]
- **EngineHealth** (interface) — `packages/cli/src/commands/doctor.ts:23` [PR: 0.0006]
- **DoctorActionOptions** (interface) — `packages/cli/src/commands/doctor.ts:18` [PR: 0.0005]

---
#### Module: cluster-60 (wiki/modules/cluster-60.md)
# Module: cluster-60

> Auto-generated module article for `cluster-60`.

## Entities

- **assembleRetrievalText** (function) — `packages/core/src/context/retrieval.ts:325` [PR: 0.0027]
- **search** (function) — `packages/core/src/context/retrieval.ts:274` [PR: 0.0019]
- **searchWithGrep** (function) — `packages/core/src/context/retrieval.ts:219` [PR: 0.0015]
- **searchWithRipgrep** (function) — `packages/core/src/context/retrieval.ts:151` [PR: 0.0012]
- **searchWithZoekt** (function) — `packages/core/src/context/retrieval.ts:121` [PR: 0.0010]
- **parseZoektOutput** (function) — `packages/core/src/context/retrieval.ts:95` [PR: 0.0009]
- **RetrievalOptions** (interface) — `packages/core/src/context/retrieval.ts:8` [PR: 0.0006]
- **SearchResult** (interface) — `packages/core/src/context/retrieval.ts:1` [PR: 0.0005]

---
#### Module: cluster-93 (wiki/modules/cluster-93.md)
# Module: cluster-93

> Auto-generated module article for `cluster-93`.

## Entities

- **assembleEpisodicText** (function) — `packages/core/src/context/episodic.ts:237` [PR: 0.0020]
- **decayAllEntries** (function) — `packages/core/src/context/episodic.ts:212` [PR: 0.0014]
- **pruneEntries** (function) — `packages/core/src/context/episodic.ts:177` [PR: 0.0011]
- **getEntries** (function) — `packages/core/src/context/episodic.ts:152` [PR: 0.0009]
- **accessEntry** (function) — `packages/core/src/context/episodic.ts:115` [PR: 0.0008]
- **addEntry** (function) — `packages/core/src/context/episodic.ts:67` [PR: 0.0007]
- **calculateDecay** (function) — `packages/core/src/context/episodic.ts:55` [PR: 0.0006]
- **EpisodicEntry** (interface) — `packages/core/src/context/episodic.ts:3` [PR: 0.0005]

---
#### Module: cluster-4 (wiki/modules/cluster-4.md)
# Module: cluster-4

> Auto-generated module article for `cluster-4`.

## Entities

_No entities detected._

---
#### Module: cluster-83 (wiki/modules/cluster-83.md)
# Module: cluster-83

> Auto-generated module article for `cluster-83`.

## Entities

- **runTypecheck** (function) — `packages/core/src/verify/typecheck.ts:106` [PR: 0.0014]
- **parseTscOutput** (function) — `packages/core/src/verify/typecheck.ts:82` [PR: 0.0010]
- **getTypecheckCommand** (function) — `packages/core/src/verify/typecheck.ts:71` [PR: 0.0008]
- **TypecheckCommand** (interface) — `packages/core/src/verify/typecheck.ts:23` [PR: 0.0006]
- **TypecheckResult** (interface) — `packages/core/src/verify/typecheck.ts:16` [PR: 0.0005]

---
#### Module: cluster-70 (wiki/modules/cluster-70.md)
# Module: cluster-70

> Auto-generated module article for `cluster-70`.

## Entities

- **syntaxGuard** (function) — `packages/core/src/verify/syntax-guard.ts:122` [PR: 0.0012]
- **parseBiomeOutput** (function) — `packages/core/src/verify/syntax-guard.ts:87` [PR: 0.0009]
- **SyntaxGuardResult** (type) — `packages/core/src/verify/syntax-guard.ts:30` [PR: 0.0007]
- **SyntaxDiagnostic** (interface) — `packages/core/src/verify/syntax-guard.ts:22` [PR: 0.0005]

---
#### Module: cluster-21 (wiki/modules/cluster-21.md)
# Module: cluster-21

> Auto-generated module article for `cluster-21`.

## Entities

- **commitCommand** (function) — `packages/cli/src/commands/commit.ts:500` [PR: 0.0015]
- **commitAction** (function) — `packages/cli/src/commands/commit.ts:122` [PR: 0.0011]
- **CommitDeps** (interface) — `packages/cli/src/commands/commit.ts:109` [PR: 0.0008]
- **CommitActionResult** (interface) — `packages/cli/src/commands/commit.ts:34` [PR: 0.0006]
- **CommitActionOptions** (interface) — `packages/cli/src/commands/commit.ts:26` [PR: 0.0005]

---
#### Module: cluster-138 (wiki/modules/cluster-138.md)
# Module: cluster-138

> Auto-generated module article for `cluster-138`.

## Entities

- **trackWikiRefsWritten** (function) — `packages/core/src/wiki/tracking.ts:24` [PR: 0.0008]
- **trackWikiRefsRead** (function) — `packages/core/src/wiki/tracking.ts:13` [PR: 0.0005]

---
#### Module: cluster-169 (wiki/modules/cluster-169.md)
# Module: cluster-169

> Auto-generated module article for `cluster-169`.

## Entities

_No entities detected._

---
#### Module: cluster-15 (wiki/modules/cluster-15.md)
# Module: cluster-15

> Auto-generated module article for `cluster-15`.

## Entities

- **benchmarkCommand** (function) — `packages/cli/src/commands/benchmark.ts:110` [PR: 0.0014]
- **benchmarkAction** (function) — `packages/cli/src/commands/benchmark.ts:49` [PR: 0.0010]
- **BenchmarkDeps** (interface) — `packages/cli/src/commands/benchmark.ts:22` [PR: 0.0008]
- **BenchmarkActionResult** (interface) — `packages/cli/src/commands/benchmark.ts:14` [PR: 0.0006]
- **BenchmarkActionOptions** (interface) — `packages/cli/src/commands/benchmark.ts:7` [PR: 0.0005]

---
#### Module: cluster-44 (wiki/modules/cluster-44.md)
# Module: cluster-44

> Auto-generated module article for `cluster-44`.

## Entities

- **logoutCommand** (function) — `packages/cli/src/commands/login.ts:190` [PR: 0.0016]
- **loginCommand** (function) — `packages/cli/src/commands/login.ts:174` [PR: 0.0011]
- **logoutAction** (function) — `packages/cli/src/commands/login.ts:162` [PR: 0.0009]
- **LogoutActionResult** (interface) — `packages/cli/src/commands/login.ts:157` [PR: 0.0007]
- **loginAction** (function) — `packages/cli/src/commands/login.ts:29` [PR: 0.0006]
- **LoginActionResult** (interface) — `packages/cli/src/commands/login.ts:24` [PR: 0.0005]

---
#### Module: cluster-64 (wiki/modules/cluster-64.md)
# Module: cluster-64

> Auto-generated module article for `cluster-64`.

## Entities

- **slopCommand** (function) — `packages/cli/src/commands/slop.ts:83` [PR: 0.0012]
- **slopAction** (function) — `packages/cli/src/commands/slop.ts:43` [PR: 0.0009]
- **SlopActionResult** (interface) — `packages/cli/src/commands/slop.ts:20` [PR: 0.0007]
- **SlopActionOptions** (interface) — `packages/cli/src/commands/slop.ts:14` [PR: 0.0005]

---
#### Module: cluster-35 (wiki/modules/cluster-35.md)
# Module: cluster-35

> Auto-generated module article for `cluster-35`.

## Entities

- **filterByDiff** (function) — `packages/core/src/verify/diff-filter.ts:165` [PR: 0.0014]
- **filterByDiffWithMap** (function) — `packages/core/src/verify/diff-filter.ts:134` [PR: 0.0010]
- **parseChangedLines** (function) — `packages/core/src/verify/diff-filter.ts:37` [PR: 0.0008]
- **DiffFilterResult** (interface) — `packages/core/src/verify/diff-filter.ts:23` [PR: 0.0006]
- **Finding** (interface) — `packages/core/src/verify/diff-filter.ts:13` [PR: 0.0005]

---
#### Module: cluster-149 (wiki/modules/cluster-149.md)
# Module: cluster-149

> Auto-generated module article for `cluster-149`.

## Entities

_No entities detected._

---
#### Module: cluster-97 (wiki/modules/cluster-97.md)
# Module: cluster-97

> Auto-generated module article for `cluster-97`.

## Entities

- **buildCacheKey** (function) — `packages/core/src/cache/keys.ts:39` [PR: 0.0011]
- **hashFiles** (function) — `packages/core/src/cache/keys.ts:29` [PR: 0.0008]
- **CacheKeyInput** (interface) — `packages/core/src/cache/keys.ts:1` [PR: 0.0005]

---
#### Module: cluster-118 (wiki/modules/cluster-118.md)
# Module: cluster-118

> Auto-generated module article for `cluster-118`.

## Entities

- **generateDesignApproaches** (function) — `packages/core/src/ai/design-approaches.ts:23` [PR: 0.0008]
- **DesignApproach** (interface) — `packages/core/src/ai/design-approaches.ts:4` [PR: 0.0005]

---
#### Module: cluster-50 (wiki/modules/cluster-50.md)
# Module: cluster-50

> Auto-generated module article for `cluster-50`.

## Entities

- **runMutation** (function) — `packages/core/src/verify/mutation.ts:105` [PR: 0.0012]
- **parseStrykerReport** (function) — `packages/core/src/verify/mutation.ts:48` [PR: 0.0009]
- **MutationResult** (interface) — `packages/core/src/verify/mutation.ts:20` [PR: 0.0007]
- **MutationOptions** (interface) — `packages/core/src/verify/mutation.ts:14` [PR: 0.0005]

---
#### Module: cluster-0 (wiki/modules/cluster-0.md)
# Module: cluster-0

> Auto-generated module article for `cluster-0`.

## Entities

_No entities detected._

---
#### Module: context (wiki/modules/context.md)
# Module: context

> Auto-generated module article for `context`.

## Entities

- **parseFile** (function) — `packages/core/src/context/treesitter.ts:207` [PR: 0.0020]
- **extractEntities** (function) — `packages/core/src/context/treesitter.ts:166` [PR: 0.0014]
- **extractExports** (function) — `packages/core/src/context/treesitter.ts:90` [PR: 0.0011]
- **extractImports** (function) — `packages/core/src/context/treesitter.ts:30` [PR: 0.0009]
- **ParseResult** (interface) — `packages/core/src/context/treesitter.ts:19` [PR: 0.0008]
- **ParsedExport** (interface) — `packages/core/src/context/treesitter.ts:14` [PR: 0.0007]
- **ParsedImport** (interface) — `packages/core/src/context/treesitter.ts:8` [PR: 0.0006]
- **ParsedEntity** (interface) — `packages/core/src/context/treesitter.ts:1` [PR: 0.0005]

---
#### Module: cluster-11 (wiki/modules/cluster-11.md)
# Module: cluster-11

> Auto-generated module article for `cluster-11`.

## Entities

- **runAIReview** (function) — `packages/core/src/verify/ai-review.ts:182` [PR: 0.0016]
- **resolveReferencedFunctions** (function) — `packages/core/src/verify/ai-review.ts:56` [PR: 0.0011]
- **AIReviewResult** (interface) — `packages/core/src/verify/ai-review.ts:40` [PR: 0.0009]
- **AIReviewOptions** (interface) — `packages/core/src/verify/ai-review.ts:31` [PR: 0.0007]
- **EntityWithBody** (interface) — `packages/core/src/verify/ai-review.ts:22` [PR: 0.0006]
- **ReferencedFunction** (interface) — `packages/core/src/verify/ai-review.ts:16` [PR: 0.0005]

---
#### Module: cluster-87 (wiki/modules/cluster-87.md)
# Module: cluster-87

> Auto-generated module article for `cluster-87`.

## Entities

- **wikiIngestCommand** (function) — `packages/cli/src/commands/wiki/ingest.ts:90` [PR: 0.0012]
- **wikiIngestAction** (function) — `packages/cli/src/commands/wiki/ingest.ts:40` [PR: 0.0009]
- **WikiIngestOptions** (interface) — `packages/cli/src/commands/wiki/ingest.ts:23` [PR: 0.0007]
- **WikiIngestResult** (interface) — `packages/cli/src/commands/wiki/ingest.ts:16` [PR: 0.0005]

---
#### Module: cluster-159 (wiki/modules/cluster-159.md)
# Module: cluster-159

> Auto-generated module article for `cluster-159`.

## Entities

_No entities detected._

---
#### Module: cluster-25 (wiki/modules/cluster-25.md)
# Module: cluster-25

> Auto-generated module article for `cluster-25`.

## Entities

- **checkConsistency** (function) — `packages/core/src/verify/consistency.ts:145` [PR: 0.0010]
- **ConsistencyResult** (interface) — `packages/core/src/verify/consistency.ts:26` [PR: 0.0007]
- **ConsistencyRule** (interface) — `packages/core/src/verify/consistency.ts:21` [PR: 0.0005]

---
#### Module: cluster-74 (wiki/modules/cluster-74.md)
# Module: cluster-74

> Auto-generated module article for `cluster-74`.

## Entities

- **runBenchmark** (function) — `packages/core/src/benchmark/runner.ts:42` [PR: 0.0012]
- **parseTestOutput** (function) — `packages/core/src/benchmark/runner.ts:28` [PR: 0.0009]
- **RunBenchmarkOptions** (interface) — `packages/core/src/benchmark/runner.ts:10` [PR: 0.0007]
- **TestResult** (interface) — `packages/core/src/benchmark/runner.ts:4` [PR: 0.0005]

---
#### Module: cluster-142 (wiki/modules/cluster-142.md)
# Module: cluster-142

> Auto-generated module article for `cluster-142`.

## Entities

_No entities detected._

---
#### Module: cluster-113 (wiki/modules/cluster-113.md)
# Module: cluster-113

> Auto-generated module article for `cluster-113`.

## Entities

- **extractAcceptanceCriteria** (function) — `packages/core/src/utils.ts:58` [PR: 0.0010]
- **STOP_WORDS** (variable) — `packages/core/src/utils.ts:29` [PR: 0.0007]
- **toKebabCase** (function) — `packages/core/src/utils.ts:9` [PR: 0.0005]

---
#### Module: cluster-127 (wiki/modules/cluster-127.md)
# Module: cluster-127

> Auto-generated module article for `cluster-127`.

## Entities

- **saveState** (function) — `packages/core/src/wiki/state.ts:57` [PR: 0.0011]
- **loadState** (function) — `packages/core/src/wiki/state.ts:44` [PR: 0.0008]
- **hashFile (packages)** (function) — `packages/core/src/cache/keys.ts:15` [PR: 0.0007]
- **hashFile (packages)** (function) — `packages/core/src/wiki/state.ts:21` [PR: 0.0007]
- **createEmptyState** (function) — `packages/core/src/wiki/state.ts:32` [PR: 0.0007]
- **hashContent (packages)** (function) — `packages/core/src/cache/keys.ts:9` [PR: 0.0006]
- **hashContent (packages)** (function) — `packages/core/src/wiki/state.ts:17` [PR: 0.0006]

---
#### Module: cluster-176 (wiki/modules/cluster-176.md)
# Module: cluster-176

> Auto-generated module article for `cluster-176`.

## Entities

_No entities detected._

---
#### Module: commands (wiki/modules/commands.md)
# Module: commands

> Auto-generated module article for `commands`.

## Entities

- **setupCommand** (function) — `packages/cli/src/commands/setup.ts:440` [PR: 0.0022]
- **setupAction** (function) — `packages/cli/src/commands/setup.ts:262` [PR: 0.0015]
- **ensureClaudeSettings** (function) — `packages/cli/src/commands/setup.ts:196` [PR: 0.0012]
- **buildClaudeSettingsJson** (function) — `packages/cli/src/commands/setup.ts:176` [PR: 0.0010]
- **detectEnvironment** (function) — `packages/cli/src/commands/setup.ts:94` [PR: 0.0008]
- **SetupActionDeps** (interface) — `packages/cli/src/commands/setup.ts:56` [PR: 0.0007]
- **SetupActionOptions** (interface) — `packages/cli/src/commands/setup.ts:48` [PR: 0.0007]
- **SetupResult** (interface) — `packages/cli/src/commands/setup.ts:39` [PR: 0.0006]
- **promptCommand** (function) — `packages/cli/src/commands/prompt.ts:17` [PR: 0.0005]
- **learnCommand** (function) — `packages/cli/src/commands/learn.ts:33` [PR: 0.0005]
- **contextCommand** (function) — `packages/cli/src/commands/context.ts:41` [PR: 0.0005]
- **AgentEnvironment** (type) — `packages/cli/src/commands/setup.ts:26` [PR: 0.0005]
- **cacheCommand** (function) — `packages/cli/src/commands/cache.ts:6` [PR: 0.0005]

---
#### Module: explain (wiki/modules/explain.md)
# Module: explain

> Auto-generated module article for `explain`.

## Entities

- **generateModuleSummary** (function) — `packages/core/src/explain/index.ts:102` [PR: 0.0012]
- **generateDependencyDiagram** (function) — `packages/core/src/explain/index.ts:52` [PR: 0.0009]
- **DiagramOptions** (interface) — `packages/core/src/explain/index.ts:22` [PR: 0.0007]
- **ModuleSummary** (interface) — `packages/core/src/explain/index.ts:13` [PR: 0.0005]

---
#### Module: cluster-166 (wiki/modules/cluster-166.md)
# Module: cluster-166

> Auto-generated module article for `cluster-166`.

## Entities

_No entities detected._

---
#### Module: cluster-137 (wiki/modules/cluster-137.md)
# Module: cluster-137

> Auto-generated module article for `cluster-137`.

## Entities

- **syncCommand** (function) — `packages/cli/src/commands/sync.ts:127` [PR: 0.0012]
- **syncPullAction** (function) — `packages/cli/src/commands/sync.ts:91` [PR: 0.0009]
- **syncPushAction** (function) — `packages/cli/src/commands/sync.ts:58` [PR: 0.0007]
- **SyncActionResult** (interface) — `packages/cli/src/commands/sync.ts:52` [PR: 0.0005]

---
#### Module: cluster-103 (wiki/modules/cluster-103.md)
# Module: cluster-103

> Auto-generated module article for `cluster-103`.

## Entities

- **pollForToken** (function) — `packages/core/src/cloud/auth.ts:178` [PR: 0.0018]
- **startDeviceFlow** (function) — `packages/core/src/cloud/auth.ts:127` [PR: 0.0013]
- **clearAuthConfig** (function) — `packages/core/src/cloud/auth.ts:103` [PR: 0.0010]
- **saveAuthConfig** (function) — `packages/core/src/cloud/auth.ts:83` [PR: 0.0008]
- **loadAuthConfig** (function) — `packages/core/src/cloud/auth.ts:60` [PR: 0.0007]
- **getAuthConfigPath** (function) — `packages/core/src/cloud/auth.ts:49` [PR: 0.0006]
- **AuthConfig** (interface) — `packages/core/src/cloud/auth.ts:36` [PR: 0.0005]

---
#### Module: cluster-152 (wiki/modules/cluster-152.md)
# Module: cluster-152

> Auto-generated module article for `cluster-152`.

## Entities

_No entities detected._

---
#### Module: wiki (wiki/modules/wiki.md)
# Module: wiki

> Auto-generated module article for `wiki`.

## Entities

- **DECAY_HALF_LIVES** (variable) — `packages/core/src/wiki/types.ts:162` [PR: 0.0035]
- **WikiLintResult** (interface) — `packages/core/src/wiki/types.ts:148` [PR: 0.0024]
- **WikiLintFinding** (interface) — `packages/core/src/wiki/types.ts:140` [PR: 0.0019]
- **WikiLintCheck** (type) — `packages/core/src/wiki/types.ts:130` [PR: 0.0016]
- **WikiState** (interface) — `packages/core/src/wiki/types.ts:120` [PR: 0.0013]
- **ExtractedWorkflowTrace** (interface) — `packages/core/src/wiki/types.ts:110` [PR: 0.0012]
- **RLSignal** (interface) — `packages/core/src/wiki/types.ts:105` [PR: 0.0010]
- **WorkflowStep** (interface) — `packages/core/src/wiki/types.ts:99` [PR: 0.0009]
- **ExtractedDecision** (interface) — `packages/core/src/wiki/types.ts:87` [PR: 0.0009]
- **DecisionStatus** (type) — `packages/core/src/wiki/types.ts:81` [PR: 0.0008]
- **ExtractedFeature** (interface) — `packages/core/src/wiki/types.ts:67` [PR: 0.0007]
- **TaskItem** (interface) — `packages/core/src/wiki/types.ts:61` [PR: 0.0007]
- **WikiArticle** (interface) — `packages/core/src/wiki/types.ts:44` [PR: 0.0006]
- **WikiLink** (interface) — `packages/core/src/wiki/types.ts:38` [PR: 0.0006]
- **EdgeType** (type) — `packages/core/src/wiki/types.ts:23` [PR: 0.0006]
- **generateIndex** (function) — `packages/core/src/wiki/indexer.ts:56` [PR: 0.0005]
- **ArticleType** (type) — `packages/core/src/wiki/types.ts:10` [PR: 0.0005]
- **onPostCommit** (function) — `packages/core/src/wiki/hooks.ts:20` [PR: 0.0005]
- **wikiCommand** (function) — `packages/cli/src/commands/wiki/index.ts:15` [PR: 0.0005]

---
#### Module: cluster-172 (wiki/modules/cluster-172.md)
# Module: cluster-172

> Auto-generated module article for `cluster-172`.

## Entities

_No entities detected._

---
#### Module: cluster-123 (wiki/modules/cluster-123.md)
# Module: cluster-123

> Auto-generated module article for `cluster-123`.

## Entities

- **closeDb** (function) — `examples/todo-api/src/db.ts:21` [PR: 0.0008]
- **getDb** (function) — `examples/todo-api/src/db.ts:5` [PR: 0.0005]

---
#### Module: cluster-117 (wiki/modules/cluster-117.md)
# Module: cluster-117

> Auto-generated module article for `cluster-117`.

## Entities

- **outputDelegationRequest** (function) — `packages/core/src/ai/delegation.ts:110` [PR: 0.0012]
- **parseDelegationRequest** (function) — `packages/core/src/ai/delegation.ts:53` [PR: 0.0009]
- **formatDelegationRequest** (function) — `packages/core/src/ai/delegation.ts:30` [PR: 0.0007]
- **DelegationRequest** (interface) — `packages/core/src/ai/delegation.ts:11` [PR: 0.0005]

---
#### Module: cluster-146 (wiki/modules/cluster-146.md)
# Module: cluster-146

> Auto-generated module article for `cluster-146`.

## Entities

_No entities detected._

---
#### Module: cluster-156 (wiki/modules/cluster-156.md)
# Module: cluster-156

> Auto-generated module article for `cluster-156`.

## Entities

_No entities detected._

---
#### Module: cluster-88 (wiki/modules/cluster-88.md)
# Module: cluster-88

> Auto-generated module article for `cluster-88`.

## Entities

- **wikiInitCommand** (function) — `packages/cli/src/commands/wiki/init.ts:115` [PR: 0.0012]
- **wikiInitAction** (function) — `packages/cli/src/commands/wiki/init.ts:36` [PR: 0.0009]
- **WikiInitOptions** (interface) — `packages/cli/src/commands/wiki/init.ts:28` [PR: 0.0007]
- **WikiInitResult** (interface) — `packages/cli/src/commands/wiki/init.ts:18` [PR: 0.0005]

---
#### Module: cluster-107 (wiki/modules/cluster-107.md)
# Module: cluster-107

> Auto-generated module article for `cluster-107`.

## Entities

- **createCloudClient** (function) — `packages/core/src/cloud/client.ts:139` [PR: 0.0008]
- **CloudClient** (interface) — `packages/core/src/cloud/client.ts:57` [PR: 0.0005]

---
#### Module: cluster-133 (wiki/modules/cluster-133.md)
# Module: cluster-133

> Auto-generated module article for `cluster-133`.

## Entities

- **runWikiLintTool** (function) — `packages/core/src/verify/tools/wiki-lint-runner.ts:22` [PR: 0.0008]
- **WikiLintRunnerOptions** (interface) — `packages/core/src/verify/tools/wiki-lint-runner.ts:13` [PR: 0.0005]

---
#### Module: cluster-162 (wiki/modules/cluster-162.md)
# Module: cluster-162

> Auto-generated module article for `cluster-162`.

## Entities

_No entities detected._

---
#### Module: verify (wiki/modules/verify.md)
# Module: verify

> Auto-generated module article for `verify`.

## Entities

- **updateBaselines** (function) — `packages/core/src/verify/visual.ts:425` [PR: 0.0026]
- **runVisualVerification** (function) — `packages/core/src/verify/visual.ts:269` [PR: 0.0018]
- **compareImages** (function) — `packages/core/src/verify/visual.ts:222` [PR: 0.0014]
- **captureScreenshot** (function) — `packages/core/src/verify/visual.ts:160` [PR: 0.0012]
- **loadVisualConfig** (function) — `packages/core/src/verify/visual.ts:123` [PR: 0.0010]
- **detectWebProject** (function) — `packages/core/src/verify/visual.ts:88` [PR: 0.0009]
- **VisualVerifyResult** (interface) — `packages/core/src/verify/visual.ts:39` [PR: 0.0008]
- **VisualDiffResult** (interface) — `packages/core/src/verify/visual.ts:33` [PR: 0.0007]
- **ScreenshotResult** (interface) — `packages/core/src/verify/visual.ts:26` [PR: 0.0006]
- **ScreenshotOptions** (interface) — `packages/core/src/verify/visual.ts:21` [PR: 0.0006]
- **VisualConfig** (interface) — `packages/core/src/verify/visual.ts:15` [PR: 0.0005]

---
#### Module: cluster-173 (wiki/modules/cluster-173.md)
# Module: cluster-173

> Auto-generated module article for `cluster-173`.

## Entities

_No entities detected._

---
#### Module: cluster-180 (wiki/modules/cluster-180.md)
# Module: cluster-180

> Auto-generated module article for `cluster-180`.

## Entities

_No entities detected._

---
#### Module: cluster-116 (wiki/modules/cluster-116.md)
# Module: cluster-116

> Auto-generated module article for `cluster-116`.

## Entities

- **extractFeatures** (function) — `packages/core/src/wiki/extractors/feature.ts:177` [PR: 0.0008]
- **extractSingleFeature** (function) — `packages/core/src/wiki/extractors/feature.ts:124` [PR: 0.0005]

---
#### Module: cluster-99 (wiki/modules/cluster-99.md)
# Module: cluster-99

> Auto-generated module article for `cluster-99`.

## Entities

- **formatTier3Comparison** (function) — `packages/core/src/benchmark/reporter.ts:250` [PR: 0.0012]
- **buildTier3Report** (function) — `packages/core/src/benchmark/reporter.ts:192` [PR: 0.0009]
- **formatComparison** (function) — `packages/core/src/benchmark/reporter.ts:52` [PR: 0.0007]
- **buildReport** (function) — `packages/core/src/benchmark/reporter.ts:13` [PR: 0.0005]

---
#### Module: cluster-147 (wiki/modules/cluster-147.md)
# Module: cluster-147

> Auto-generated module article for `cluster-147`.

## Entities

_No entities detected._

---
#### Module: cluster-157 (wiki/modules/cluster-157.md)
# Module: cluster-157

> Auto-generated module article for `cluster-157`.

## Entities

_No entities detected._

---
#### Module: workflow (wiki/modules/workflow.md)
# Module: workflow

> Auto-generated module article for `workflow`.

## Entities

- **loadWorkflowContext** (function) — `packages/core/src/workflow/context.ts:96` [PR: 0.0012]
- **appendWikiRefs** (function) — `packages/core/src/workflow/context.ts:70` [PR: 0.0009]
- **appendWorkflowStep** (function) — `packages/core/src/workflow/context.ts:46` [PR: 0.0007]
- **resetWorkflowContext** (function) — `packages/core/src/workflow/context.ts:30` [PR: 0.0005]

---
#### Module: cluster-89 (wiki/modules/cluster-89.md)
# Module: cluster-89

> Auto-generated module article for `cluster-89`.

## Entities

- **wikiLintCommand** (function) — `packages/cli/src/commands/wiki/lint.ts:119` [PR: 0.0012]
- **wikiLintAction** (function) — `packages/cli/src/commands/wiki/lint.ts:34` [PR: 0.0009]
- **WikiLintCommandOptions** (interface) — `packages/cli/src/commands/wiki/lint.ts:27` [PR: 0.0007]
- **WikiLintCommandResult** (interface) — `packages/cli/src/commands/wiki/lint.ts:15` [PR: 0.0005]

---
#### Module: cluster-106 (wiki/modules/cluster-106.md)
# Module: cluster-106

> Auto-generated module article for `cluster-106`.

## Entities

- **configureCommand** (function) — `packages/cli/src/commands/configure.ts:205` [PR: 0.0010]
- **configureAction** (function) — `packages/cli/src/commands/configure.ts:36` [PR: 0.0007]
- **ConfigureActionOptions** (interface) — `packages/cli/src/commands/configure.ts:31` [PR: 0.0005]

---
#### Module: cluster-132 (wiki/modules/cluster-132.md)
# Module: cluster-132

> Auto-generated module article for `cluster-132`.

## Entities

- **wikiLintToFindings** (function) — `packages/core/src/verify/tools/wiki-lint.ts:872` [PR: 0.0010]
- **runWikiLint** (function) — `packages/core/src/verify/tools/wiki-lint.ts:814` [PR: 0.0007]
- **WikiLintOptions** (interface) — `packages/core/src/verify/tools/wiki-lint.ts:19` [PR: 0.0005]

---
#### Module: cluster-163 (wiki/modules/cluster-163.md)
# Module: cluster-163

> Auto-generated module article for `cluster-163`.

## Entities

_No entities detected._

---
#### Module: cluster-143 (wiki/modules/cluster-143.md)
# Module: cluster-143

> Auto-generated module article for `cluster-143`.

## Entities

_No entities detected._

---
#### Module: cluster-112 (wiki/modules/cluster-112.md)
# Module: cluster-112

> Auto-generated module article for `cluster-112`.

## Entities

- **exportEpisodicForCloud** (function) — `packages/core/src/feedback/sync.ts:130` [PR: 0.0012]
- **exportWorkflowStats** (function) — `packages/core/src/feedback/sync.ts:73` [PR: 0.0009]
- **WorkflowStats** (interface) — `packages/core/src/feedback/sync.ts:59` [PR: 0.0007]
- **exportFeedbackForCloud** (function) — `packages/core/src/feedback/sync.ts:28` [PR: 0.0005]

---
#### Module: cluster-177 (wiki/modules/cluster-177.md)
# Module: cluster-177

> Auto-generated module article for `cluster-177`.

## Entities

_No entities detected._

---
#### Module: cluster-167 (wiki/modules/cluster-167.md)
# Module: cluster-167

> Auto-generated module article for `cluster-167`.

## Entities

_No entities detected._

---
#### Module: cluster-136 (wiki/modules/cluster-136.md)
# Module: cluster-136

> Auto-generated module article for `cluster-136`.

## Entities

- **storeCompressedReview** (function) — `packages/core/src/feedback/compress.ts:82` [PR: 0.0008]
- **compressReview** (function) — `packages/core/src/feedback/compress.ts:12` [PR: 0.0005]

---
#### Module: cluster-102 (wiki/modules/cluster-102.md)
# Module: cluster-102

> Auto-generated module article for `cluster-102`.

## Entities

- **runBuiltinChecks** (function) — `packages/core/src/verify/builtin.ts:340` [PR: 0.0020]
- **checkAnyType** (function) — `packages/core/src/verify/builtin.ts:296` [PR: 0.0014]
- **checkEmptyCatch** (function) — `packages/core/src/verify/builtin.ts:229` [PR: 0.0011]
- **checkSecrets** (function) — `packages/core/src/verify/builtin.ts:196` [PR: 0.0009]
- **checkFileSize** (function) — `packages/core/src/verify/builtin.ts:171` [PR: 0.0008]
- **checkTodoComments** (function) — `packages/core/src/verify/builtin.ts:140` [PR: 0.0007]
- **checkUnusedImports** (function) — `packages/core/src/verify/builtin.ts:76` [PR: 0.0006]
- **checkConsoleLogs** (function) — `packages/core/src/verify/builtin.ts:46` [PR: 0.0005]

---
#### Module: cluster-153 (wiki/modules/cluster-153.md)
# Module: cluster-153

> Auto-generated module article for `cluster-153`.

## Entities

_No entities detected._

---
#### Module: linters (wiki/modules/linters.md)
# Module: linters

> Auto-generated module article for `linters`.

## Entities

- **parseGoVetOutput** (function) — `packages/core/src/verify/linters/go-vet.ts:8` [PR: 0.0005]
- **parseRuffOutput** (function) — `packages/core/src/verify/linters/ruff.ts:12` [PR: 0.0005]
- **parseCheckstyleOutput** (function) — `packages/core/src/verify/linters/checkstyle.ts:11` [PR: 0.0005]
- **parseClippyOutput** (function) — `packages/core/src/verify/linters/clippy.ts:8` [PR: 0.0005]
- **parseDotnetFormatOutput** (function) — `packages/core/src/verify/linters/dotnet-format.ts:12` [PR: 0.0005]

---
#### Module: init (wiki/modules/init.md)
# Module: init

> Auto-generated module article for `init`.

## Entities

- **bootstrap** (function) — `packages/core/src/init/index.ts:1290` [PR: 0.0014]
- **buildMainaSection** (function) — `packages/core/src/init/index.ts:565` [PR: 0.0010]
- **DetectedStack** (interface) — `packages/core/src/init/index.ts:38` [PR: 0.0008]
- **InitReport** (interface) — `packages/core/src/init/index.ts:28` [PR: 0.0006]
- **InitOptions** (interface) — `packages/core/src/init/index.ts:23` [PR: 0.0005]

---
#### Module: benchmark (wiki/modules/benchmark.md)
# Module: benchmark

> Auto-generated module article for `benchmark`.

## Entities

- **Tier3Results** (interface) — `packages/core/src/benchmark/types.ts:82` [PR: 0.0018]
- **Tier3Totals** (interface) — `packages/core/src/benchmark/types.ts:69` [PR: 0.0013]
- **StepMetrics** (interface) — `packages/core/src/benchmark/types.ts:51` [PR: 0.0010]
- **LoadedStory** (interface) — `packages/core/src/benchmark/types.ts:44` [PR: 0.0008]
- **BenchmarkReport** (interface) — `packages/core/src/benchmark/types.ts:36` [PR: 0.0007]
- **BenchmarkMetrics** (interface) — `packages/core/src/benchmark/types.ts:17` [PR: 0.0006]
- **StoryConfig** (interface) — `packages/core/src/benchmark/types.ts:1` [PR: 0.0005]

---
#### Module: cluster-121 (wiki/modules/cluster-121.md)
# Module: cluster-121

> Auto-generated module article for `cluster-121`.

## Entities

- **generateSpecQuestions** (function) — `packages/core/src/ai/spec-questions.ts:22` [PR: 0.0008]
- **SpecQuestion** (interface) — `packages/core/src/ai/spec-questions.ts:4` [PR: 0.0005]

---
#### Module: cluster-170 (wiki/modules/cluster-170.md)
# Module: cluster-170

> Auto-generated module article for `cluster-170`.

## Entities

_No entities detected._

---
#### Module: cluster-69 (wiki/modules/cluster-69.md)
# Module: cluster-69

> Auto-generated module article for `cluster-69`.

## Entities

- **statusCommand** (function) — `packages/cli/src/commands/status.ts:141` [PR: 0.0014]
- **statusAction** (function) — `packages/cli/src/commands/status.ts:60` [PR: 0.0010]
- **StatusDeps** (interface) — `packages/cli/src/commands/status.ts:24` [PR: 0.0008]
- **StatusActionResult** (interface) — `packages/cli/src/commands/status.ts:12` [PR: 0.0006]
- **StatusActionOptions** (interface) — `packages/cli/src/commands/status.ts:8` [PR: 0.0005]

---
#### Module: config (wiki/modules/config.md)
# Module: config

> Auto-generated module article for `config`.

## Entities

- **shouldDelegateToHost** (function) — `packages/core/src/config/index.ts:191` [PR: 0.0022]
- **HostDelegation** (interface) — `packages/core/src/config/index.ts:175` [PR: 0.0015]
- **isHostMode** (function) — `packages/core/src/config/index.ts:149` [PR: 0.0012]
- **resolveProvider** (function) — `packages/core/src/config/index.ts:117` [PR: 0.0010]
- **getApiKey** (function) — `packages/core/src/config/index.ts:99` [PR: 0.0008]
- **loadConfig** (function) — `packages/core/src/config/index.ts:77` [PR: 0.0007]
- **findConfigFile** (function) — `packages/core/src/config/index.ts:52` [PR: 0.0007]
- **getDefaultConfig** (function) — `packages/core/src/config/index.ts:39` [PR: 0.0006]
- **MainaConfig** (interface) — `packages/core/src/config/index.ts:4` [PR: 0.0005]

---
#### Module: cluster-144 (wiki/modules/cluster-144.md)
# Module: cluster-144

> Auto-generated module article for `cluster-144`.

## Entities

_No entities detected._

---
#### Module: cluster-115 (wiki/modules/cluster-115.md)
# Module: cluster-115

> Auto-generated module article for `cluster-115`.

## Entities

- **extractDecisions** (function) — `packages/core/src/wiki/extractors/decision.ts:193` [PR: 0.0008]
- **extractSingleDecision** (function) — `packages/core/src/wiki/extractors/decision.ts:133` [PR: 0.0005]

---
#### Module: cluster-105 (wiki/modules/cluster-105.md)
# Module: cluster-105

> Auto-generated module article for `cluster-105`.

## Entities

- **compile** (function) — `packages/core/src/wiki/compiler.ts:814` [PR: 0.0009]
- **CompileOptions** (interface) — `packages/core/src/wiki/compiler.ts:56` [PR: 0.0006]

---
#### Module: cluster-154 (wiki/modules/cluster-154.md)
# Module: cluster-154

> Auto-generated module article for `cluster-154`.

## Entities

_No entities detected._

---
#### Module: cluster-79 (wiki/modules/cluster-79.md)
# Module: cluster-79

> Auto-generated module article for `cluster-79`.

## Entities

- **analyzeWorkflowTrace** (function) — `packages/core/src/feedback/trace-analysis.ts:138` [PR: 0.0012]
- **TraceResult** (interface) — `packages/core/src/feedback/trace-analysis.ts:31` [PR: 0.0009]
- **PromptImprovement** (interface) — `packages/core/src/feedback/trace-analysis.ts:24` [PR: 0.0007]
- **TraceStep** (interface) — `packages/core/src/feedback/trace-analysis.ts:17` [PR: 0.0005]

---
#### Module: cluster-160 (wiki/modules/cluster-160.md)
# Module: cluster-160

> Auto-generated module article for `cluster-160`.

## Entities

_No entities detected._

---
#### Module: cluster-131 (wiki/modules/cluster-131.md)
# Module: cluster-131

> Auto-generated module article for `cluster-131`.

## Entities

- **wikiQueryCommand** (function) — `packages/cli/src/commands/wiki/query.ts:82` [PR: 0.0010]
- **queryWiki** (function) — `packages/core/src/wiki/query.ts:249` [PR: 0.0007]
- **wikiQueryAction** (function) — `packages/cli/src/commands/wiki/query.ts:31` [PR: 0.0007]
- **WikiQueryOptions (packages)** (interface) — `packages/core/src/wiki/query.ts:21` [PR: 0.0007]
- **WikiQueryOptions (packages)** (interface) — `packages/cli/src/commands/wiki/query.ts:23` [PR: 0.0007]
- **WikiQueryResult (packages)** (interface) — `packages/core/src/wiki/query.ts:15` [PR: 0.0005]
- **WikiQueryResult (packages)** (interface) — `packages/cli/src/commands/wiki/query.ts:17` [PR: 0.0005]

---
#### Module: cluster-9 (wiki/modules/cluster-9.md)
# Module: cluster-9

> Auto-generated module article for `cluster-9`.

## Entities

_No entities detected._

---
#### Module: cloud (wiki/modules/cloud.md)
# Module: cloud

> Auto-generated module article for `cloud`.

## Entities

- **FeedbackImprovementsResponse** (interface) — `packages/core/src/cloud/types.ts:243` [PR: 0.0044]
- **CloudPromptImprovement** (interface) — `packages/core/src/cloud/types.ts:230` [PR: 0.0034]
- **FeedbackBatchPayload** (interface) — `packages/core/src/cloud/types.ts:225` [PR: 0.0028]
- **FeedbackEvent** (interface) — `packages/core/src/cloud/types.ts:210` [PR: 0.0024]
- **CloudEpisodicEntry** (interface) — `packages/core/src/cloud/types.ts:195` [PR: 0.0021]
- **EpisodicCloudEntry** (interface) — `packages/core/src/cloud/types.ts:182` [PR: 0.0019]
- **CloudFeedbackPayload** (interface) — `packages/core/src/cloud/types.ts:167` [PR: 0.0017]
- **VerifyResultResponse** (interface) — `packages/core/src/cloud/types.ts:146` [PR: 0.0016]
- **VerifyFinding** (interface) — `packages/core/src/cloud/types.ts:131` [PR: 0.0014]
- **VerifyStatusResponse** (interface) — `packages/core/src/cloud/types.ts:124` [PR: 0.0013]
- **SubmitVerifyPayload** (interface) — `packages/core/src/cloud/types.ts:115` [PR: 0.0012]
- **ProfileUpdateResponse** (interface) — `packages/core/src/cloud/types.ts:93` [PR: 0.0011]
- **ProfileUpdatePayload** (interface) — `packages/core/src/cloud/types.ts:86` [PR: 0.0011]
- **TokenResponse** (interface) — `packages/core/src/cloud/types.ts:73` [PR: 0.0010]
- **DeviceCodeResponse** (interface) — `packages/core/src/cloud/types.ts:60` [PR: 0.0010]
- **ApiResponse (examples)** (interface) — `examples/todo-api/src/response.ts:1` [PR: 0.0009]
- **ApiResponse (packages)** (interface) — `packages/core/src/cloud/types.ts:104` [PR: 0.0009]
- **TeamMember** (interface) — `packages/core/src/cloud/types.ts:49` [PR: 0.0009]
- **TeamInfo** (interface) — `packages/core/src/cloud/types.ts:38` [PR: 0.0009]
- **PromptRecord** (interface) — `packages/core/src/cloud/types.ts:23` [PR: 0.0008]
- **CloudConfig** (interface) — `packages/core/src/cloud/types.ts:10` [PR: 0.0008]

## Related Decisions

- [[decision:0012-v050-cloud-client-maina-cloud]] — v0.5.0 Cloud Client + maina-cloud [accepted]

---
#### Module: cluster-111 (wiki/modules/cluster-111.md)
# Module: cluster-111

> Auto-generated module article for `cluster-111`.

## Entities

- **emitRejectSignal** (function) — `packages/core/src/feedback/signals.ts:40` [PR: 0.0008]
- **emitAcceptSignal** (function) — `packages/core/src/feedback/signals.ts:12` [PR: 0.0005]

---
#### Module: cluster-140 (wiki/modules/cluster-140.md)
# Module: cluster-140

> Auto-generated module article for `cluster-140`.

## Entities

- **wikiCompileCommand** (function) — `packages/cli/src/commands/wiki/compile.ts:108` [PR: 0.0011]
- **wikiCompileAction** (function) — `packages/cli/src/commands/wiki/compile.ts:44` [PR: 0.0008]
- **WikiCompileOptions** (interface) — `packages/cli/src/commands/wiki/compile.ts:34` [PR: 0.0006]
- **CompilationResult (packages)** (interface) — `packages/core/src/wiki/compiler.ts:42` [PR: 0.0005]
- **CompilationResult (packages)** (interface) — `packages/cli/src/commands/wiki/compile.ts:22` [PR: 0.0005]

---
#### Module: cluster-174 (wiki/modules/cluster-174.md)
# Module: cluster-174

> Auto-generated module article for `cluster-174`.

## Entities

_No entities detected._

---
#### Module: cluster-125 (wiki/modules/cluster-125.md)
# Module: cluster-125

> Auto-generated module article for `cluster-125`.

## Entities

- **handleDeleteTodo** (function) — `examples/todo-api/src/routes.ts:73` [PR: 0.0014]
- **handleUpdateTodo** (function) — `examples/todo-api/src/routes.ts:43` [PR: 0.0010]
- **handleGetTodo** (function) — `examples/todo-api/src/routes.ts:33` [PR: 0.0008]
- **handleCreateTodo** (function) — `examples/todo-api/src/routes.ts:23` [PR: 0.0006]
- **handleListTodos** (function) — `examples/todo-api/src/routes.ts:19` [PR: 0.0005]

---
#### Module: cluster-135 (wiki/modules/cluster-135.md)
# Module: cluster-135

> Auto-generated module article for `cluster-135`.

## Entities

- **startServer** (function) — `packages/mcp/src/server.ts:30` [PR: 0.0008]
- **createMcpServer** (function) — `packages/mcp/src/server.ts:14` [PR: 0.0005]

---
#### Module: cluster-164 (wiki/modules/cluster-164.md)
# Module: cluster-164

> Auto-generated module article for `cluster-164`.

## Entities

_No entities detected._

---
#### Module: cluster-18 (wiki/modules/cluster-18.md)
# Module: cluster-18

> Auto-generated module article for `cluster-18`.

## Entities

- **truncateToFit** (function) — `packages/core/src/context/budget.ts:88` [PR: 0.0018]
- **assembleBudget** (function) — `packages/core/src/context/budget.ts:55` [PR: 0.0013]
- **getBudgetRatio** (function) — `packages/core/src/context/budget.ts:34` [PR: 0.0010]
- **calculateTokens** (function) — `packages/core/src/context/budget.ts:25` [PR: 0.0008]
- **LayerContent** (interface) — `packages/core/src/context/budget.ts:13` [PR: 0.0007]
- **BudgetAllocation** (interface) — `packages/core/src/context/budget.ts:3` [PR: 0.0006]
- **BudgetMode** (type) — `packages/core/src/context/budget.ts:1` [PR: 0.0005]

---
#### Module: cluster-150 (wiki/modules/cluster-150.md)
# Module: cluster-150

> Auto-generated module article for `cluster-150`.

## Entities

_No entities detected._

---
#### Module: cluster-101 (wiki/modules/cluster-101.md)
# Module: cluster-101

> Auto-generated module article for `cluster-101`.

## Entities

- **checkAIAvailability** (function) — `packages/core/src/ai/availability.ts:9` [PR: 0.0008]
- **AIAvailability** (interface) — `packages/core/src/ai/availability.ts:3` [PR: 0.0005]

---
#### Module: extractors (wiki/modules/extractors.md)
# Module: extractors

> Auto-generated module article for `extractors`.

## Entities

- **extractCodeEntities** (function) — `packages/core/src/wiki/extractors/code.ts:78` [PR: 0.0008]
- **extractWorkflowTrace** (function) — `packages/core/src/wiki/extractors/workflow.ts:76` [PR: 0.0005]
- **CodeEntity** (interface) — `packages/core/src/wiki/extractors/code.ts:16` [PR: 0.0005]

---
#### Module: cluster-8 (wiki/modules/cluster-8.md)
# Module: cluster-8

> Auto-generated module article for `cluster-8`.

## Entities

_No entities detected._

---
#### Module: cluster-110 (wiki/modules/cluster-110.md)
# Module: cluster-110

> Auto-generated module article for `cluster-110`.

## Entities

- **detectFileLanguage** (function) — `packages/core/src/language/detect.ts:91` [PR: 0.0010]
- **getPrimaryLanguage** (function) — `packages/core/src/language/detect.ts:82` [PR: 0.0007]
- **detectLanguages** (function) — `packages/core/src/language/detect.ts:30` [PR: 0.0005]

---
#### Module: cluster-141 (wiki/modules/cluster-141.md)
# Module: cluster-141

> Auto-generated module article for `cluster-141`.

## Entities

_No entities detected._

---
#### Module: cluster-175 (wiki/modules/cluster-175.md)
# Module: cluster-175

> Auto-generated module article for `cluster-175`.

## Entities

_No entities detected._

---
#### Module: cluster-124 (wiki/modules/cluster-124.md)
# Module: cluster-124

> Auto-generated module article for `cluster-124`.

## Entities

- **getWorkflowId** (function) — `packages/core/src/feedback/collector.ts:187` [PR: 0.0016]
- **recordFeedbackAsync** (function) — `packages/core/src/feedback/collector.ts:132` [PR: 0.0011]
- **recordFeedbackWithCompression** (function) — `packages/core/src/feedback/collector.ts:79` [PR: 0.0009]
- **getFeedbackSummary** (function) — `packages/core/src/feedback/collector.ts:34` [PR: 0.0007]
- **recordFeedback** (function) — `packages/core/src/feedback/collector.ts:23` [PR: 0.0006]
- **FeedbackRecord** (interface) — `packages/core/src/feedback/collector.ts:11` [PR: 0.0005]

---
#### Module: cluster-134 (wiki/modules/cluster-134.md)
# Module: cluster-134

> Auto-generated module article for `cluster-134`.

## Entities

- **scoreSpec** (function) — `packages/core/src/features/quality.ts:288` [PR: 0.0008]
- **QualityScore** (interface) — `packages/core/src/features/quality.ts:45` [PR: 0.0005]

---
#### Module: cluster-165 (wiki/modules/cluster-165.md)
# Module: cluster-165

> Auto-generated module article for `cluster-165`.

## Entities

_No entities detected._

---
#### Module: cluster-19 (wiki/modules/cluster-19.md)
# Module: cluster-19

> Auto-generated module article for `cluster-19`.

## Entities

- **createCacheManager** (function) — `packages/core/src/cache/manager.ts:69` [PR: 0.0012]
- **CacheManager** (interface) — `packages/core/src/cache/manager.ts:60` [PR: 0.0009]
- **CacheStats** (interface) — `packages/core/src/cache/manager.ts:13` [PR: 0.0007]
- **CacheEntry** (interface) — `packages/core/src/cache/manager.ts:3` [PR: 0.0005]

---
#### Module: cluster-48 (wiki/modules/cluster-48.md)
# Module: cluster-48

> Auto-generated module article for `cluster-48`.

## Entities

- **resolveModel** (function) — `packages/core/src/ai/tiers.ts:41` [PR: 0.0012]
- **getTaskTier** (function) — `packages/core/src/ai/tiers.ts:27` [PR: 0.0009]
- **ModelResolution** (interface) — `packages/core/src/ai/tiers.ts:5` [PR: 0.0007]
- **ModelTier** (type) — `packages/core/src/ai/tiers.ts:3` [PR: 0.0005]

---
#### Module: cluster-151 (wiki/modules/cluster-151.md)
# Module: cluster-151

> Auto-generated module article for `cluster-151`.

## Entities

_No entities detected._

---
#### Module: cluster-100 (wiki/modules/cluster-100.md)
# Module: cluster-100

> Auto-generated module article for `cluster-100`.

## Entities

- **captureResult** (function) — `packages/core/src/feedback/capture.ts:55` [PR: 0.0012]
- **getCachedResult** (function) — `packages/core/src/feedback/capture.ts:30` [PR: 0.0009]
- **buildToolCacheKey** (function) — `packages/core/src/feedback/capture.ts:22` [PR: 0.0007]
- **CaptureInput** (interface) — `packages/core/src/feedback/capture.ts:12` [PR: 0.0005]

---
#### Module: ticket (wiki/modules/ticket.md)
# Module: ticket

> Auto-generated module article for `ticket`.

## Entities

- **createTicket** (function) — `packages/core/src/ticket/index.ts:141` [PR: 0.0016]
- **buildIssueBody** (function) — `packages/core/src/ticket/index.ts:129` [PR: 0.0011]
- **detectModules** (function) — `packages/core/src/ticket/index.ts:69` [PR: 0.0009]
- **SpawnDeps** (interface) — `packages/core/src/ticket/index.ts:28` [PR: 0.0007]
- **TicketResult** (interface) — `packages/core/src/ticket/index.ts:22` [PR: 0.0006]
- **TicketOptions** (interface) — `packages/core/src/ticket/index.ts:14` [PR: 0.0005]

---
#### Module: hooks (wiki/modules/hooks.md)
# Module: hooks

> Auto-generated module article for `hooks`.

## Entities

- **runHooks** (function) — `packages/core/src/hooks/runner.ts:100` [PR: 0.0016]
- **executeHook** (function) — `packages/core/src/hooks/runner.ts:50` [PR: 0.0011]
- **scanHooks** (function) — `packages/core/src/hooks/runner.ts:30` [PR: 0.0009]
- **HookResult** (type) — `packages/core/src/hooks/runner.ts:21` [PR: 0.0007]
- **HookContext** (interface) — `packages/core/src/hooks/runner.ts:12` [PR: 0.0006]
- **HookEvent** (type) — `packages/core/src/hooks/runner.ts:4` [PR: 0.0005]

---
#### Module: cluster-120 (wiki/modules/cluster-120.md)
# Module: cluster-120

> Auto-generated module article for `cluster-120`.

## Entities

- **generateLinks** (function) — `packages/core/src/wiki/linker.ts:69` [PR: 0.0008]
- **LinkResult** (interface) — `packages/core/src/wiki/linker.ts:13` [PR: 0.0005]

---
#### Module: cluster-171 (wiki/modules/cluster-171.md)
# Module: cluster-171

> Auto-generated module article for `cluster-171`.

## Entities

_No entities detected._

---
#### Module: git (wiki/modules/git.md)
# Module: git

> Auto-generated module article for `git`.

## Entities

- **getRepoSlug** (function) — `packages/core/src/git/index.ts:118` [PR: 0.0026]
- **getChangedFiles (packages)** (function) — `packages/core/src/wiki/state.ts:68` [PR: 0.0019]
- **getChangedFiles (packages)** (function) — `packages/core/src/git/index.ts:63` [PR: 0.0019]
- **getTrackedFiles** (function) — `packages/core/src/git/index.ts:103` [PR: 0.0018]
- **getStagedFiles** (function) — `packages/core/src/git/index.ts:97` [PR: 0.0014]
- **getDiff** (function) — `packages/core/src/git/index.ts:82` [PR: 0.0012]
- **getRecentCommits** (function) — `packages/core/src/git/index.ts:41` [PR: 0.0008]
- **getRepoRoot** (function) — `packages/core/src/git/index.ts:36` [PR: 0.0007]
- **getBranchName** (function) — `packages/core/src/git/index.ts:32` [PR: 0.0006]
- **getCurrentBranch** (function) — `packages/core/src/git/index.ts:27` [PR: 0.0006]
- **Commit** (interface) — `packages/core/src/git/index.ts:1` [PR: 0.0005]

---
#### Module: cluster-68 (wiki/modules/cluster-68.md)
# Module: cluster-68

> Auto-generated module article for `cluster-68`.

## Entities

- **statsCommand** (function) — `packages/cli/src/commands/stats.ts:364` [PR: 0.0020]
- **statsAction** (function) — `packages/cli/src/commands/stats.ts:154` [PR: 0.0014]
- **StatsDeps** (interface) — `packages/cli/src/commands/stats.ts:60` [PR: 0.0011]
- **StatsActionResult** (interface) — `packages/cli/src/commands/stats.ts:50` [PR: 0.0009]
- **WikiMetrics** (interface) — `packages/cli/src/commands/stats.ts:39` [PR: 0.0008]
- **SpecsResult** (interface) — `packages/cli/src/commands/stats.ts:33` [PR: 0.0007]
- **SpecScore** (interface) — `packages/cli/src/commands/stats.ts:28` [PR: 0.0006]
- **StatsActionOptions** (interface) — `packages/cli/src/commands/stats.ts:20` [PR: 0.0005]

---
#### Module: cluster-39 (wiki/modules/cluster-39.md)
# Module: cluster-39

> Auto-generated module article for `cluster-39`.

## Entities

- **mapToArticles** (function) — `packages/core/src/wiki/graph.ts:388` [PR: 0.0016]
- **computePageRank** (function) — `packages/core/src/wiki/graph.ts:315` [PR: 0.0011]
- **buildKnowledgeGraph** (function) — `packages/core/src/wiki/graph.ts:291` [PR: 0.0009]
- **KnowledgeGraph** (interface) — `packages/core/src/wiki/graph.ts:33` [PR: 0.0007]
- **GraphEdge** (interface) — `packages/core/src/wiki/graph.ts:26` [PR: 0.0006]
- **GraphNode** (interface) — `packages/core/src/wiki/graph.ts:18` [PR: 0.0005]

---
#### Module: cluster-145 (wiki/modules/cluster-145.md)
# Module: cluster-145

> Auto-generated module article for `cluster-145`.

## Entities

_No entities detected._

---
#### Module: cluster-104 (wiki/modules/cluster-104.md)
# Module: cluster-104

> Auto-generated module article for `cluster-104`.

## Entities

- **promptVersions** (variable) — `packages/core/src/db/schema.ts:75` [PR: 0.0018]
- **commitSnapshots** (variable) — `packages/core/src/db/schema.ts:54` [PR: 0.0013]
- **feedback** (variable) — `packages/core/src/db/schema.ts:45` [PR: 0.0010]
- **cacheEntries** (variable) — `packages/core/src/db/schema.ts:34` [PR: 0.0008]
- **dependencyEdges** (variable) — `packages/core/src/db/schema.ts:26` [PR: 0.0007]
- **semanticEntities** (variable) — `packages/core/src/db/schema.ts:14` [PR: 0.0006]
- **episodicEntries** (variable) — `packages/core/src/db/schema.ts:3` [PR: 0.0005]

---
#### Module: cluster-155 (wiki/modules/cluster-155.md)
# Module: cluster-155

> Auto-generated module article for `cluster-155`.

## Entities

_No entities detected._

---
#### Module: cluster-29 (wiki/modules/cluster-29.md)
# Module: cluster-29

> Auto-generated module article for `cluster-29`.

## Entities

- **validateArticleStructure** (function) — `packages/core/src/wiki/schema.ts:81` [PR: 0.0018]
- **getLinkSyntax** (function) — `packages/core/src/wiki/schema.ts:72` [PR: 0.0013]
- **getArticleMaxLength** (function) — `packages/core/src/wiki/schema.ts:68` [PR: 0.0010]
- **DEFAULT_SCHEMA** (variable) — `packages/core/src/wiki/schema.ts:30` [PR: 0.0008]
- **ValidationResult** (interface) — `packages/core/src/wiki/schema.ts:23` [PR: 0.0007]
- **WikiSchema** (interface) — `packages/core/src/wiki/schema.ts:18` [PR: 0.0006]
- **ArticleRule** (interface) — `packages/core/src/wiki/schema.ts:12` [PR: 0.0005]

---
#### Module: cluster-78 (wiki/modules/cluster-78.md)
# Module: cluster-78

> Auto-generated module article for `cluster-78`.

## Entities

- **traceFeature** (function) — `packages/core/src/features/traceability.ts:201` [PR: 0.0012]
- **TraceDeps** (interface) — `packages/core/src/features/traceability.ts:33` [PR: 0.0009]
- **TraceabilityReport** (interface) — `packages/core/src/features/traceability.ts:22` [PR: 0.0007]
- **TaskTrace** (interface) — `packages/core/src/features/traceability.ts:14` [PR: 0.0005]

---
#### Module: cluster-161 (wiki/modules/cluster-161.md)
# Module: cluster-161

> Auto-generated module article for `cluster-161`.

## Entities

_No entities detected._

---
#### Module: cluster-130 (wiki/modules/cluster-130.md)
# Module: cluster-130

> Auto-generated module article for `cluster-130`.

## Entities

- **noContent** (function) — `examples/todo-api/src/response.ts:17` [PR: 0.0011]
- **err** (function) — `examples/todo-api/src/response.ts:12` [PR: 0.0008]
- **ok** (function) — `examples/todo-api/src/response.ts:7` [PR: 0.0006]

---
#### Module: db (wiki/modules/db.md)
# Module: db

> Auto-generated module article for `db`.

## Entities

- **getStatsDb** (function) — `packages/core/src/db/index.ts:221` [PR: 0.0018]
- **getFeedbackDb** (function) — `packages/core/src/db/index.ts:213` [PR: 0.0013]
- **getCacheDb** (function) — `packages/core/src/db/index.ts:205` [PR: 0.0010]
- **getContextDb** (function) — `packages/core/src/db/index.ts:194` [PR: 0.0008]
- **initDatabase** (function) — `packages/core/src/db/index.ts:172` [PR: 0.0007]
- **Result** (type) — `packages/core/src/db/index.ts:12` [PR: 0.0006]
- **DbHandle** (type) — `packages/core/src/db/index.ts:7` [PR: 0.0005]

---
#### Module: cluster-57 (wiki/modules/cluster-57.md)
# Module: cluster-57

> Auto-generated module article for `cluster-57`.

## Entities

- **reviewDesignCommand** (function) — `packages/cli/src/commands/review-design.ts:165` [PR: 0.0014]
- **reviewDesignAction** (function) — `packages/cli/src/commands/review-design.ts:53` [PR: 0.0010]
- **ReviewDesignDeps** (interface) — `packages/cli/src/commands/review-design.ts:33` [PR: 0.0008]
- **ReviewDesignActionResult** (interface) — `packages/cli/src/commands/review-design.ts:22` [PR: 0.0006]
- **ReviewDesignActionOptions** (interface) — `packages/cli/src/commands/review-design.ts:17` [PR: 0.0005]

---
#### Module: cluster-90 (wiki/modules/cluster-90.md)
# Module: cluster-90

> Auto-generated module article for `cluster-90`.

## Entities

- **wikiStatusCommand** (function) — `packages/cli/src/commands/wiki/status.ts:171` [PR: 0.0012]
- **wikiStatusAction** (function) — `packages/cli/src/commands/wiki/status.ts:77` [PR: 0.0009]
- **WikiStatusOptions** (interface) — `packages/cli/src/commands/wiki/status.ts:26` [PR: 0.0007]
- **WikiStatusResult** (interface) — `packages/cli/src/commands/wiki/status.ts:17` [PR: 0.0005]

---
#### Module: features (wiki/modules/features.md)
# Module: features

> Auto-generated module article for `features`.

## Entities

- **scaffoldFeatureWithContext** (function) — `packages/core/src/features/numbering.ts:379` [PR: 0.0014]
- **scaffoldFeature** (function) — `packages/core/src/features/numbering.ts:254` [PR: 0.0010]
- **DesignChoices** (interface) — `packages/core/src/features/numbering.ts:110` [PR: 0.0008]
- **createFeatureDir** (function) — `packages/core/src/features/numbering.ts:75` [PR: 0.0006]
- **generateTestStubs** (function) — `packages/core/src/features/test-stubs.ts:93` [PR: 0.0005]
- **getNextFeatureNumber** (function) — `packages/core/src/features/numbering.ts:30` [PR: 0.0005]

---
#### Module: cluster-7 (wiki/modules/cluster-7.md)
# Module: cluster-7

> Auto-generated module article for `cluster-7`.

## Entities

_No entities detected._

---
#### Module: design (wiki/modules/design.md)
# Module: design

> Auto-generated module article for `design`.

## Entities

- **runTwoStageReview** (function) — `packages/core/src/review/index.ts:388` [PR: 0.0018]
- **reviewDesign** (function) — `packages/core/src/design/review.ts:228` [PR: 0.0015]
- **reviewCodeQualityWithAI** (function) — `packages/core/src/review/index.ts:333` [PR: 0.0012]
- **findAdrByNumber** (function) — `packages/core/src/design/review.ts:187` [PR: 0.0010]
- **reviewCodeQuality** (function) — `packages/core/src/review/index.ts:254` [PR: 0.0010]
- **ReviewResult (packages)** (interface) — `packages/core/src/design/review.ts:34` [PR: 0.0009]
- **ReviewResult (packages)** (interface) — `packages/core/src/review/index.ts:33` [PR: 0.0009]
- **buildReviewContext** (function) — `packages/core/src/design/review.ts:121` [PR: 0.0008]
- **reviewSpecCompliance** (function) — `packages/core/src/review/index.ts:171` [PR: 0.0008]
- **ReviewOptions (packages)** (interface) — `packages/core/src/design/review.ts:24` [PR: 0.0007]
- **ReviewFinding (packages)** (interface) — `packages/core/src/design/review.ts:28` [PR: 0.0007]
- **ReviewFinding (packages)** (interface) — `packages/core/src/review/index.ts:18` [PR: 0.0007]
- **ReviewOptions (packages)** (interface) — `packages/core/src/review/index.ts:26` [PR: 0.0007]
- **ReviewContext** (interface) — `packages/core/src/design/review.ts:18` [PR: 0.0005]
- **ReviewStageResult** (interface) — `packages/core/src/review/index.ts:12` [PR: 0.0005]

---
#### Module: cache (wiki/modules/cache.md)
# Module: cache

> Auto-generated module article for `cache`.

## Entities

- **getAllRules** (function) — `packages/core/src/cache/ttl.ts:75` [PR: 0.0014]
- **isExpired** (function) — `packages/core/src/cache/ttl.ts:68` [PR: 0.0010]
- **getTtl** (function) — `packages/core/src/cache/ttl.ts:64` [PR: 0.0008]
- **TtlRule** (interface) — `packages/core/src/cache/ttl.ts:11` [PR: 0.0006]
- **TaskType** (type) — `packages/core/src/cache/ttl.ts:1` [PR: 0.0005]

---
#### Module: cluster-73 (wiki/modules/cluster-73.md)
# Module: cluster-73

> Auto-generated module article for `cluster-73`.

## Entities

- **teamCommand** (function) — `packages/cli/src/commands/team.ts:89` [PR: 0.0014]
- **inviteAction** (function) — `packages/cli/src/commands/team.ts:68` [PR: 0.0010]
- **InviteActionResult** (interface) — `packages/cli/src/commands/team.ts:63` [PR: 0.0008]
- **teamAction** (function) — `packages/cli/src/commands/team.ts:22` [PR: 0.0006]
- **TeamActionResult** (interface) — `packages/cli/src/commands/team.ts:17` [PR: 0.0005]

---
#### Module: cluster-80 (wiki/modules/cluster-80.md)
# Module: cluster-80

> Auto-generated module article for `cluster-80`.

## Entities

- **runTrivy** (function) — `packages/core/src/verify/trivy.ts:126` [PR: 0.0012]
- **parseTrivyJson** (function) — `packages/core/src/verify/trivy.ts:66` [PR: 0.0009]
- **TrivyResult** (interface) — `packages/core/src/verify/trivy.ts:21` [PR: 0.0007]
- **TrivyOptions** (interface) — `packages/core/src/verify/trivy.ts:14` [PR: 0.0005]

---
#### Module: cluster-36 (wiki/modules/cluster-36.md)
# Module: cluster-36

> Auto-generated module article for `cluster-36`.

## Entities

- **generateFixes** (function) — `packages/core/src/verify/fix.ts:253` [PR: 0.0016]
- **parseFixResponse** (function) — `packages/core/src/verify/fix.ts:134` [PR: 0.0011]
- **hashFinding** (function) — `packages/core/src/verify/fix.ts:55` [PR: 0.0009]
- **FixOptions** (interface) — `packages/core/src/verify/fix.ts:43` [PR: 0.0007]
- **FixResult** (interface) — `packages/core/src/verify/fix.ts:37` [PR: 0.0006]
- **FixSuggestion** (interface) — `packages/core/src/verify/fix.ts:30` [PR: 0.0005]

---
#### Module: cluster-67 (wiki/modules/cluster-67.md)
# Module: cluster-67

> Auto-generated module article for `cluster-67`.

## Entities

- **specCommand** (function) — `packages/cli/src/commands/spec.ts:272` [PR: 0.0014]
- **specAction** (function) — `packages/cli/src/commands/spec.ts:111` [PR: 0.0010]
- **SpecDeps** (interface) — `packages/cli/src/commands/spec.ts:38` [PR: 0.0008]
- **SpecActionResult** (interface) — `packages/cli/src/commands/spec.ts:28` [PR: 0.0006]
- **SpecActionOptions** (interface) — `packages/cli/src/commands/spec.ts:20` [PR: 0.0005]

---
#### Module: cluster-53 (wiki/modules/cluster-53.md)
# Module: cluster-53

> Auto-generated module article for `cluster-53`.

## Entities

- **planCommand** (function) — `packages/cli/src/commands/plan.ts:397` [PR: 0.0021]
- **planAction** (function) — `packages/cli/src/commands/plan.ts:269` [PR: 0.0015]
- **collectDesignChoices** (function) — `packages/cli/src/commands/plan.ts:152` [PR: 0.0011]
- **gitCommit (packages)** (function) — `packages/cli/src/commands/commit.ts:89` [PR: 0.0010]
- **gitCommit (packages)** (function) — `packages/cli/src/commands/plan.ts:78` [PR: 0.0010]
- **PlanDeps** (interface) — `packages/cli/src/commands/plan.ts:97` [PR: 0.0009]
- **gitAdd** (function) — `packages/cli/src/commands/plan.ts:64` [PR: 0.0007]
- **gitCheckout** (function) — `packages/cli/src/commands/plan.ts:48` [PR: 0.0007]
- **PlanActionResult** (interface) — `packages/cli/src/commands/plan.ts:38` [PR: 0.0006]
- **PlanActionOptions** (interface) — `packages/cli/src/commands/plan.ts:29` [PR: 0.0005]

---
#### Module: prompts (wiki/modules/prompts.md)
# Module: prompts

> Auto-generated module article for `prompts`.

## Entities

- **resolveABTests** (function) — `packages/core/src/prompts/evolution.ts:307` [PR: 0.0031]
- **retire** (function) — `packages/core/src/prompts/evolution.ts:285` [PR: 0.0022]
- **promote** (function) — `packages/core/src/prompts/evolution.ts:270` [PR: 0.0017]
- **abTest** (function) — `packages/core/src/prompts/evolution.ts:238` [PR: 0.0014]
- **createCandidate** (function) — `packages/core/src/prompts/evolution.ts:196` [PR: 0.0012]
- **analyseWorkflowRuns** (function) — `packages/core/src/prompts/evolution.ts:156` [PR: 0.0011]
- **analyseWorkflowFeedback** (function) — `packages/core/src/prompts/evolution.ts:117` [PR: 0.0009]
- **analyseFeedback** (function) — `packages/core/src/prompts/evolution.ts:79` [PR: 0.0008]
- **WorkflowRunSummary** (interface) — `packages/core/src/prompts/evolution.ts:40` [PR: 0.0008]
- **WorkflowStepAnalysis** (interface) — `packages/core/src/prompts/evolution.ts:33` [PR: 0.0007]
- **ABResolution** (interface) — `packages/core/src/prompts/evolution.ts:25` [PR: 0.0007]
- **AbTestResult** (interface) — `packages/core/src/prompts/evolution.ts:20` [PR: 0.0006]
- **CandidatePrompt** (interface) — `packages/core/src/prompts/evolution.ts:13` [PR: 0.0006]
- **FeedbackAnalysis** (interface) — `packages/core/src/prompts/evolution.ts:6` [PR: 0.0005]

---
#### Module: cluster-3 (wiki/modules/cluster-3.md)
# Module: cluster-3

> Auto-generated module article for `cluster-3`.

## Entities

_No entities detected._

---
#### Module: cluster-43 (wiki/modules/cluster-43.md)
# Module: cluster-43

> Auto-generated module article for `cluster-43`.

## Entities

- **runLighthouse** (function) — `packages/core/src/verify/lighthouse.ts:132` [PR: 0.0012]
- **parseLighthouseJson** (function) — `packages/core/src/verify/lighthouse.ts:74` [PR: 0.0009]
- **LighthouseResult** (interface) — `packages/core/src/verify/lighthouse.ts:24` [PR: 0.0007]
- **LighthouseOptions** (interface) — `packages/core/src/verify/lighthouse.ts:15` [PR: 0.0005]

---
#### Module: cluster-77 (wiki/modules/cluster-77.md)
# Module: cluster-77

> Auto-generated module article for `cluster-77`.

## Entities

- **formatVerificationProof** (function) — `packages/core/src/verify/proof.ts:181` [PR: 0.0014]
- **gatherVerificationProof** (function) — `packages/core/src/verify/proof.ts:94` [PR: 0.0010]
- **ProofOptions** (interface) — `packages/core/src/verify/proof.ts:42` [PR: 0.0008]
- **VerificationProof** (interface) — `packages/core/src/verify/proof.ts:26` [PR: 0.0006]
- **ToolProof** (interface) — `packages/core/src/verify/proof.ts:19` [PR: 0.0005]

---
#### Module: cluster-26 (wiki/modules/cluster-26.md)
# Module: cluster-26

> Auto-generated module article for `cluster-26`.

## Entities

- **assembleContext** (function) — `packages/core/src/context/engine.ts:332` [PR: 0.0012]
- **ContextOptions** (interface) — `packages/core/src/context/engine.ts:44` [PR: 0.0009]
- **AssembledContext** (interface) — `packages/core/src/context/engine.ts:36` [PR: 0.0007]
- **LayerReport** (interface) — `packages/core/src/context/engine.ts:29` [PR: 0.0005]

---
#### Module: cluster-84 (wiki/modules/cluster-84.md)
# Module: cluster-84

> Auto-generated module article for `cluster-84`.

## Entities

- **verifyPlan** (function) — `packages/core/src/features/checklist.ts:313` [PR: 0.0010]
- **CheckResult** (interface) — `packages/core/src/features/checklist.ts:20` [PR: 0.0007]
- **VerificationReport** (interface) — `packages/core/src/features/checklist.ts:15` [PR: 0.0005]

---
#### Module: cluster-95 (wiki/modules/cluster-95.md)
# Module: cluster-95

> Auto-generated module article for `cluster-95`.

## Entities

- **persistSemanticContext** (function) — `packages/core/src/context/semantic.ts:282` [PR: 0.0017]
- **assembleSemanticText** (function) — `packages/core/src/context/semantic.ts:205` [PR: 0.0012]
- **getTopEntities** (function) — `packages/core/src/context/semantic.ts:192` [PR: 0.0009]
- **buildSemanticContext** (function) — `packages/core/src/context/semantic.ts:135` [PR: 0.0008]
- **loadCustomContext** (function) — `packages/core/src/context/semantic.ts:103` [PR: 0.0007]
- **loadConstitution (packages)** (function) — `packages/core/src/context/semantic.ts:86` [PR: 0.0006]
- **loadConstitution (packages)** (function) — `packages/core/src/prompts/loader.ts:7` [PR: 0.0006]
- **SemanticContext** (interface) — `packages/core/src/context/semantic.ts:12` [PR: 0.0005]

---
#### Module: cluster-66 (wiki/modules/cluster-66.md)
# Module: cluster-66

> Auto-generated module article for `cluster-66`.

## Entities

- **runSonar** (function) — `packages/core/src/verify/sonar.ts:106` [PR: 0.0012]
- **parseSonarReport** (function) — `packages/core/src/verify/sonar.ts:62` [PR: 0.0009]
- **SonarResult** (interface) — `packages/core/src/verify/sonar.ts:19` [PR: 0.0007]
- **SonarOptions** (interface) — `packages/core/src/verify/sonar.ts:13` [PR: 0.0005]

---
#### Module: cluster-52 (wiki/modules/cluster-52.md)
# Module: cluster-52

> Auto-generated module article for `cluster-52`.

## Entities

- **runPipeline** (function) — `packages/core/src/verify/pipeline.ts:101` [PR: 0.0012]
- **PipelineOptions** (interface) — `packages/core/src/verify/pipeline.ts:62` [PR: 0.0009]
- **PipelineResult** (interface) — `packages/core/src/verify/pipeline.ts:49` [PR: 0.0007]
- **ToolReport** (interface) — `packages/core/src/verify/pipeline.ts:42` [PR: 0.0005]

---
#### Module: cluster-2 (wiki/modules/cluster-2.md)
# Module: cluster-2

> Auto-generated module article for `cluster-2`.

## Entities

_No entities detected._

---
#### Module: feedback (wiki/modules/feedback.md)
# Module: feedback

> Auto-generated module article for `feedback`.

## Entities

- **getNoisyRules** (function) — `packages/core/src/feedback/preferences.ts:102` [PR: 0.0018]
- **acknowledgeFinding** (function) — `packages/core/src/feedback/preferences.ts:89` [PR: 0.0013]
- **dismissFinding** (function) — `packages/core/src/feedback/preferences.ts:76` [PR: 0.0010]
- **savePreferences** (function) — `packages/core/src/feedback/preferences.ts:51` [PR: 0.0008]
- **loadPreferences** (function) — `packages/core/src/feedback/preferences.ts:28` [PR: 0.0007]
- **Preferences** (interface) — `packages/core/src/feedback/preferences.ts:11` [PR: 0.0006]
- **RulePreference** (interface) — `packages/core/src/feedback/preferences.ts:4` [PR: 0.0005]

---
#### Module: cluster-13 (wiki/modules/cluster-13.md)
# Module: cluster-13

> Auto-generated module article for `cluster-13`.

## Entities

- **analyze** (function) — `packages/core/src/features/analyzer.ts:391` [PR: 0.0010]
- **AnalysisFinding** (interface) — `packages/core/src/features/analyzer.ts:29` [PR: 0.0007]
- **AnalysisReport** (interface) — `packages/core/src/features/analyzer.ts:23` [PR: 0.0005]

---
#### Module: cluster-27 (wiki/modules/cluster-27.md)
# Module: cluster-27

> Auto-generated module article for `cluster-27`.

## Entities

- **runCoverage** (function) — `packages/core/src/verify/coverage.ts:98` [PR: 0.0012]
- **parseDiffCoverJson** (function) — `packages/core/src/verify/coverage.ts:47` [PR: 0.0009]
- **CoverageResult** (interface) — `packages/core/src/verify/coverage.ts:22` [PR: 0.0007]
- **CoverageOptions** (interface) — `packages/core/src/verify/coverage.ts:14` [PR: 0.0005]

---
#### Module: cluster-85 (wiki/modules/cluster-85.md)
# Module: cluster-85

> Auto-generated module article for `cluster-85`.

## Entities

- **verifyCommand** (function) — `packages/cli/src/commands/verify.ts:481` [PR: 0.0016]
- **verifyAction** (function) — `packages/cli/src/commands/verify.ts:315` [PR: 0.0011]
- **cloudVerifyAction** (function) — `packages/cli/src/commands/verify.ts:163` [PR: 0.0009]
- **CloudVerifyResult** (interface) — `packages/cli/src/commands/verify.ts:148` [PR: 0.0007]
- **VerifyActionResult** (interface) — `packages/cli/src/commands/verify.ts:40` [PR: 0.0006]
- **VerifyActionOptions** (interface) — `packages/cli/src/commands/verify.ts:29` [PR: 0.0005]

---
#### Module: cluster-56 (wiki/modules/cluster-56.md)
# Module: cluster-56

> Auto-generated module article for `cluster-56`.

## Entities

- **reviewCommand** (function) — `packages/cli/src/commands/review.ts:179` [PR: 0.0014]
- **reviewAction** (function) — `packages/cli/src/commands/review.ts:134` [PR: 0.0010]
- **ReviewDeps** (interface) — `packages/cli/src/commands/review.ts:29` [PR: 0.0008]
- **ReviewActionResult** (interface) — `packages/cli/src/commands/review.ts:23` [PR: 0.0006]
- **ReviewActionOptions** (interface) — `packages/cli/src/commands/review.ts:16` [PR: 0.0005]

---
#### Module: cluster-91 (wiki/modules/cluster-91.md)
# Module: cluster-91

> Auto-generated module article for `cluster-91`.

## Entities

- **assembleWorkingText** (function) — `packages/core/src/context/working.ts:159` [PR: 0.0020]
- **resetWorkingContext** (function) — `packages/core/src/context/working.ts:150` [PR: 0.0014]
- **setVerificationResult** (function) — `packages/core/src/context/working.ts:134` [PR: 0.0011]
- **trackFile** (function) — `packages/core/src/context/working.ts:117` [PR: 0.0009]
- **saveWorkingContext** (function) — `packages/core/src/context/working.ts:98` [PR: 0.0008]
- **loadWorkingContext** (function) — `packages/core/src/context/working.ts:63` [PR: 0.0007]
- **WorkingContext** (interface) — `packages/core/src/context/working.ts:14` [PR: 0.0006]
- **VerificationResult** (interface) — `packages/core/src/context/working.ts:8` [PR: 0.0005]

---
#### Module: cluster-62 (wiki/modules/cluster-62.md)
# Module: cluster-62

> Auto-generated module article for `cluster-62`.

## Entities

- **runSemgrep** (function) — `packages/core/src/verify/semgrep.ts:132` [PR: 0.0012]
- **parseSarif** (function) — `packages/core/src/verify/semgrep.ts:53` [PR: 0.0009]
- **SemgrepResult** (interface) — `packages/core/src/verify/semgrep.ts:23` [PR: 0.0007]
- **SemgrepOptions** (interface) — `packages/core/src/verify/semgrep.ts:14` [PR: 0.0005]

---
#### Module: cluster-33 (wiki/modules/cluster-33.md)
# Module: cluster-33

> Auto-generated module article for `cluster-33`.

## Entities

- **explainCommand** (function) — `packages/cli/src/commands/explain.ts:215` [PR: 0.0014]
- **explainAction** (function) — `packages/cli/src/commands/explain.ts:110` [PR: 0.0010]
- **ExplainDeps** (interface) — `packages/cli/src/commands/explain.ts:33` [PR: 0.0008]
- **ExplainActionResult** (interface) — `packages/cli/src/commands/explain.ts:21` [PR: 0.0006]
- **ExplainActionOptions** (interface) — `packages/cli/src/commands/explain.ts:14` [PR: 0.0005]

---
#### Module: cluster-6 (wiki/modules/cluster-6.md)
# Module: cluster-6

> Auto-generated module article for `cluster-6`.

## Entities

_No entities detected._

---
#### Module: ai (wiki/modules/ai.md)
# Module: ai

> Auto-generated module article for `ai`.

## Entities

- **generate** (function) — `packages/core/src/ai/index.ts:95` [PR: 0.0012]
- **callModel** (function) — `packages/core/src/ai/index.ts:39` [PR: 0.0009]
- **GenerateResult** (interface) — `packages/core/src/ai/index.ts:21` [PR: 0.0007]
- **generateCommitMessage** (function) — `packages/core/src/ai/commit-msg.ts:9` [PR: 0.0005]
- **generatePrSummary** (function) — `packages/core/src/ai/pr-summary.ts:9` [PR: 0.0005]
- **GenerateOptions** (interface) — `packages/core/src/ai/index.ts:13` [PR: 0.0005]

---
#### Module: tools (wiki/modules/tools.md)
# Module: tools

> Auto-generated module article for `tools`.

## Entities

- **registerWikiTools** (function) — `packages/mcp/src/tools/wiki.ts:134` [PR: 0.0005]
- **registerExplainTools** (function) — `packages/mcp/src/tools/explain.ts:9` [PR: 0.0005]
- **registerVerifyTools** (function) — `packages/mcp/src/tools/verify.ts:9` [PR: 0.0005]
- **registerContextTools** (function) — `packages/mcp/src/tools/context.ts:22` [PR: 0.0005]
- **registerReviewTools** (function) — `packages/mcp/src/tools/review.ts:9` [PR: 0.0005]
- **registerFeatureTools** (function) — `packages/mcp/src/tools/features.ts:9` [PR: 0.0005]

---
#### Module: cluster-23 (wiki/modules/cluster-23.md)
# Module: cluster-23

> Auto-generated module article for `cluster-23`.

## Entities

- **getWikiEffectivenessReport** (function) — `packages/core/src/wiki/signals.ts:263` [PR: 0.0022]
- **recordArticlesLoaded** (function) — `packages/core/src/wiki/signals.ts:224` [PR: 0.0015]
- **calculateEbbinghausScore** (function) — `packages/core/src/wiki/signals.ts:193` [PR: 0.0012]
- **getPromptEffectiveness** (function) — `packages/core/src/wiki/signals.ts:139` [PR: 0.0010]
- **recordWikiUsage** (function) — `packages/core/src/wiki/signals.ts:106` [PR: 0.0008]
- **WikiEffectivenessReport** (interface) — `packages/core/src/wiki/signals.ts:38` [PR: 0.0007]
- **ArticleLoadSignal** (interface) — `packages/core/src/wiki/signals.ts:32` [PR: 0.0007]
- **CompilationPromptSignal** (interface) — `packages/core/src/wiki/signals.ts:26` [PR: 0.0006]
- **WikiEffectivenessSignal** (interface) — `packages/core/src/wiki/signals.ts:19` [PR: 0.0005]

---
#### Module: cluster-72 (wiki/modules/cluster-72.md)
# Module: cluster-72

> Auto-generated module article for `cluster-72`.

## Entities

- **scoreRelevance** (function) — `packages/core/src/context/relevance.ts:315` [PR: 0.0014]
- **pageRank** (function) — `packages/core/src/context/relevance.ts:179` [PR: 0.0010]
- **buildGraph** (function) — `packages/core/src/context/relevance.ts:122` [PR: 0.0008]
- **TaskContext** (interface) — `packages/core/src/context/relevance.ts:9` [PR: 0.0006]
- **DependencyGraph** (interface) — `packages/core/src/context/relevance.ts:4` [PR: 0.0005]

---
#### Module: cluster-81 (wiki/modules/cluster-81.md)
# Module: cluster-81

> Auto-generated module article for `cluster-81`.

## Entities

- **tryAIGenerate** (function) — `packages/core/src/ai/try-generate.ts:29` [PR: 0.0010]
- **TryAIResult** (interface) — `packages/core/src/ai/try-generate.ts:11` [PR: 0.0007]
- **DelegationPrompt** (interface) — `packages/core/src/ai/try-generate.ts:4` [PR: 0.0005]

---
#### Module: cluster-46 (wiki/modules/cluster-46.md)
# Module: cluster-46

> Auto-generated module article for `cluster-46`.

## Entities

- **getBudgetMode** (function) — `packages/core/src/context/selector.ts:111` [PR: 0.0014]
- **needsLayer** (function) — `packages/core/src/context/selector.ts:100` [PR: 0.0010]
- **getContextNeeds** (function) — `packages/core/src/context/selector.ts:96` [PR: 0.0008]
- **ContextNeeds** (interface) — `packages/core/src/context/selector.ts:15` [PR: 0.0006]
- **MainaCommand** (type) — `packages/core/src/context/selector.ts:3` [PR: 0.0005]

---
#### Module: cluster-17 (wiki/modules/cluster-17.md)
# Module: cluster-17

> Auto-generated module article for `cluster-17`.

## Entities

- **brainstormCommand** (function) — `packages/cli/src/commands/brainstorm.ts:262` [PR: 0.0018]
- **brainstormAction** (function) — `packages/cli/src/commands/brainstorm.ts:129` [PR: 0.0013]
- **generateMinimalIssueBody** (function) — `packages/cli/src/commands/brainstorm.ts:107` [PR: 0.0010]
- **generateIssueBody** (function) — `packages/cli/src/commands/brainstorm.ts:66` [PR: 0.0008]
- **BrainstormDeps** (interface) — `packages/cli/src/commands/brainstorm.ts:27` [PR: 0.0007]
- **BrainstormActionResult** (interface) — `packages/cli/src/commands/brainstorm.ts:20` [PR: 0.0006]
- **BrainstormActionOptions** (interface) — `packages/cli/src/commands/brainstorm.ts:14` [PR: 0.0005]

---
#### Entity: comprehensiveReview (wiki/entities/comprehensiveReview.md)
# Entity: comprehensiveReview

> function in `packages/core/src/review/comprehensive.ts:101`

## Details

- **Kind:** function
- **File:** `packages/core/src/review/comprehensive.ts`
- **Line:** 101
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: planCommand (wiki/entities/planCommand.md)
# Entity: planCommand

> function in `packages/cli/src/commands/plan.ts:397`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/plan.ts`
- **Line:** 397
- **Exported:** yes
- **PageRank:** 0.0021

---
#### Entity: generateFixes (wiki/entities/generateFixes.md)
# Entity: generateFixes

> function in `packages/core/src/verify/fix.ts:253`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/fix.ts`
- **Line:** 253
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: detectTools (wiki/entities/detectTools.md)
# Entity: detectTools

> function in `packages/core/src/verify/detect.ts:298`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/detect.ts`
- **Line:** 298
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: statusCommand (wiki/entities/statusCommand.md)
# Entity: statusCommand

> function in `packages/cli/src/commands/status.ts:141`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/status.ts`
- **Line:** 141
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: generateModuleSummary (wiki/entities/generateModuleSummary.md)
# Entity: generateModuleSummary

> function in `packages/core/src/explain/index.ts:102`

## Details

- **Kind:** function
- **File:** `packages/core/src/explain/index.ts`
- **Line:** 102
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: FeedbackEvent (wiki/entities/FeedbackEvent.md)
# Entity: FeedbackEvent

> interface in `packages/core/src/cloud/types.ts:210`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 210
- **Exported:** yes
- **PageRank:** 0.0024

---
#### Entity: getNoisyRules (wiki/entities/getNoisyRules.md)
# Entity: getNoisyRules

> function in `packages/core/src/feedback/preferences.ts:102`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/preferences.ts`
- **Line:** 102
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: deleteTodo (wiki/entities/deleteTodo.md)
# Entity: deleteTodo

> function in `examples/todo-api/src/repo.ts:65`

## Details

- **Kind:** function
- **File:** `examples/todo-api/src/repo.ts`
- **Line:** 65
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: acknowledgeFinding (wiki/entities/acknowledgeFinding.md)
# Entity: acknowledgeFinding

> function in `packages/core/src/feedback/preferences.ts:89`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/preferences.ts`
- **Line:** 89
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: reviewCodeQualityWithAI (wiki/entities/reviewCodeQualityWithAI.md)
# Entity: reviewCodeQualityWithAI

> function in `packages/core/src/review/index.ts:333`

## Details

- **Kind:** function
- **File:** `packages/core/src/review/index.ts`
- **Line:** 333
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: scoreRelevance (wiki/entities/scoreRelevance.md)
# Entity: scoreRelevance

> function in `packages/core/src/context/relevance.ts:315`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/relevance.ts`
- **Line:** 315
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: WikiLintCheck (wiki/entities/WikiLintCheck.md)
# Entity: WikiLintCheck

> type in `packages/core/src/wiki/types.ts:130`

## Details

- **Kind:** type
- **File:** `packages/core/src/wiki/types.ts`
- **Line:** 130
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: teamCommand (wiki/entities/teamCommand.md)
# Entity: teamCommand

> function in `packages/cli/src/commands/team.ts:89`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/team.ts`
- **Line:** 89
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: generateHldLld (wiki/entities/generateHldLld.md)
# Entity: generateHldLld

> function in `packages/core/src/design/index.ts:260`

## Details

- **Kind:** function
- **File:** `packages/core/src/design/index.ts`
- **Line:** 260
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runTrivy (wiki/entities/runTrivy.md)
# Entity: runTrivy

> function in `packages/core/src/verify/trivy.ts:126`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/trivy.ts`
- **Line:** 126
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: search (wiki/entities/search.md)
# Entity: search

> function in `packages/core/src/context/retrieval.ts:274`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/retrieval.ts`
- **Line:** 274
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: runAIReview (wiki/entities/runAIReview.md)
# Entity: runAIReview

> function in `packages/core/src/verify/ai-review.ts:182`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/ai-review.ts`
- **Line:** 182
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: Tier3Results (wiki/entities/Tier3Results.md)
# Entity: Tier3Results

> interface in `packages/core/src/benchmark/types.ts:82`

## Details

- **Kind:** interface
- **File:** `packages/core/src/benchmark/types.ts`
- **Line:** 82
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: VerifyStatusResponse (wiki/entities/VerifyStatusResponse.md)
# Entity: VerifyStatusResponse

> interface in `packages/core/src/cloud/types.ts:124`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 124
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: runPipeline (wiki/entities/runPipeline.md)
# Entity: runPipeline

> function in `packages/core/src/verify/pipeline.ts:101`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/pipeline.ts`
- **Line:** 101
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: logoutCommand (wiki/entities/logoutCommand.md)
# Entity: logoutCommand

> function in `packages/cli/src/commands/login.ts:190`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/login.ts`
- **Line:** 190
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: runLighthouse (wiki/entities/runLighthouse.md)
# Entity: runLighthouse

> function in `packages/core/src/verify/lighthouse.ts:132`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/lighthouse.ts`
- **Line:** 132
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: traceFeature (wiki/entities/traceFeature.md)
# Entity: traceFeature

> function in `packages/core/src/features/traceability.ts:201`

## Details

- **Kind:** function
- **File:** `packages/core/src/features/traceability.ts`
- **Line:** 201
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: getFeedbackDb (wiki/entities/getFeedbackDb.md)
# Entity: getFeedbackDb

> function in `packages/core/src/db/index.ts:213`

## Details

- **Kind:** function
- **File:** `packages/core/src/db/index.ts`
- **Line:** 213
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: resolveModel (wiki/entities/resolveModel.md)
# Entity: resolveModel

> function in `packages/core/src/ai/tiers.ts:41`

## Details

- **Kind:** function
- **File:** `packages/core/src/ai/tiers.ts`
- **Line:** 41
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: getWikiEffectivenessReport (wiki/entities/getWikiEffectivenessReport.md)
# Entity: getWikiEffectivenessReport

> function in `packages/core/src/wiki/signals.ts:263`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/signals.ts`
- **Line:** 263
- **Exported:** yes
- **PageRank:** 0.0022

---
#### Entity: statsCommand (wiki/entities/statsCommand.md)
# Entity: statsCommand

> function in `packages/cli/src/commands/stats.ts:364`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/stats.ts`
- **Line:** 364
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: detectSlop (wiki/entities/detectSlop.md)
# Entity: detectSlop

> function in `packages/core/src/verify/slop.ts:434`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/slop.ts`
- **Line:** 434
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: getBudgetMode (wiki/entities/getBudgetMode.md)
# Entity: getBudgetMode

> function in `packages/core/src/context/selector.ts:111`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/selector.ts`
- **Line:** 111
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: analyzeWorkflowTrace (wiki/entities/analyzeWorkflowTrace.md)
# Entity: analyzeWorkflowTrace

> function in `packages/core/src/feedback/trace-analysis.ts:138`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/trace-analysis.ts`
- **Line:** 138
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: validateArticleStructure (wiki/entities/validateArticleStructure.md)
# Entity: validateArticleStructure

> function in `packages/core/src/wiki/schema.ts:81`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/schema.ts`
- **Line:** 81
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: specCommand (wiki/entities/specCommand.md)
# Entity: specCommand

> function in `packages/cli/src/commands/spec.ts:272`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/spec.ts`
- **Line:** 272
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: statsAction (wiki/entities/statsAction.md)
# Entity: statsAction

> function in `packages/cli/src/commands/stats.ts:154`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/stats.ts`
- **Line:** 154
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: reviewCommand (wiki/entities/reviewCommand.md)
# Entity: reviewCommand

> function in `packages/cli/src/commands/review.ts:179`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/review.ts`
- **Line:** 179
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: EpisodicCloudEntry (wiki/entities/EpisodicCloudEntry.md)
# Entity: EpisodicCloudEntry

> interface in `packages/core/src/cloud/types.ts:182`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 182
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: SubmitVerifyPayload (wiki/entities/SubmitVerifyPayload.md)
# Entity: SubmitVerifyPayload

> interface in `packages/core/src/cloud/types.ts:115`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 115
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: commitSnapshots (wiki/entities/commitSnapshots.md)
# Entity: commitSnapshots

> variable in `packages/core/src/db/schema.ts:54`

## Details

- **Kind:** variable
- **File:** `packages/core/src/db/schema.ts`
- **Line:** 54
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: resolveABTests (wiki/entities/resolveABTests.md)
# Entity: resolveABTests

> function in `packages/core/src/prompts/evolution.ts:307`

## Details

- **Kind:** function
- **File:** `packages/core/src/prompts/evolution.ts`
- **Line:** 307
- **Exported:** yes
- **PageRank:** 0.0031

---
#### Entity: decayAllEntries (wiki/entities/decayAllEntries.md)
# Entity: decayAllEntries

> function in `packages/core/src/context/episodic.ts:212`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/episodic.ts`
- **Line:** 212
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: reviewDesignCommand (wiki/entities/reviewDesignCommand.md)
# Entity: reviewDesignCommand

> function in `packages/cli/src/commands/review-design.ts:165`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/review-design.ts`
- **Line:** 165
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: PROFILES (wiki/entities/PROFILES.md)
# Entity: PROFILES

> variable in `packages/core/src/language/profile.ts:159`

## Details

- **Kind:** variable
- **File:** `packages/core/src/language/profile.ts`
- **Line:** 159
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: formatTier3Comparison (wiki/entities/formatTier3Comparison.md)
# Entity: formatTier3Comparison

> function in `packages/core/src/benchmark/reporter.ts:250`

## Details

- **Kind:** function
- **File:** `packages/core/src/benchmark/reporter.ts`
- **Line:** 250
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: isToolAvailable (wiki/entities/isToolAvailable.md)
# Entity: isToolAvailable

> function in `packages/core/src/context/retrieval.ts:19`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/retrieval.ts`
- **Line:** 19
- **Exported:** yes
- **PageRank:** 0.0023

---
#### Entity: designCommand (wiki/entities/designCommand.md)
# Entity: designCommand

> function in `packages/cli/src/commands/design.ts:318`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/design.ts`
- **Line:** 318
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: initCommand (wiki/entities/initCommand.md)
# Entity: initCommand

> function in `packages/cli/src/commands/init.ts:368`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/init.ts`
- **Line:** 368
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: formatVerificationProof (wiki/entities/formatVerificationProof.md)
# Entity: formatVerificationProof

> function in `packages/core/src/verify/proof.ts:181`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/proof.ts`
- **Line:** 181
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runTwoStageReview (wiki/entities/runTwoStageReview.md)
# Entity: runTwoStageReview

> function in `packages/core/src/review/index.ts:388`

## Details

- **Kind:** function
- **File:** `packages/core/src/review/index.ts`
- **Line:** 388
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: getAllRules (wiki/entities/getAllRules.md)
# Entity: getAllRules

> function in `packages/core/src/cache/ttl.ts:75`

## Details

- **Kind:** function
- **File:** `packages/core/src/cache/ttl.ts`
- **Line:** 75
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: WikiState (wiki/entities/WikiState.md)
# Entity: WikiState

> interface in `packages/core/src/wiki/types.ts:120`

## Details

- **Kind:** interface
- **File:** `packages/core/src/wiki/types.ts`
- **Line:** 120
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: CloudEpisodicEntry (wiki/entities/CloudEpisodicEntry.md)
# Entity: CloudEpisodicEntry

> interface in `packages/core/src/cloud/types.ts:195`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 195
- **Exported:** yes
- **PageRank:** 0.0021

---
#### Entity: createCacheManager (wiki/entities/createCacheManager.md)
# Entity: createCacheManager

> function in `packages/core/src/cache/manager.ts:69`

## Details

- **Kind:** function
- **File:** `packages/core/src/cache/manager.ts`
- **Line:** 69
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: assembleWorkingText (wiki/entities/assembleWorkingText.md)
# Entity: assembleWorkingText

> function in `packages/core/src/context/working.ts:159`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/working.ts`
- **Line:** 159
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: checkAnyType (wiki/entities/checkAnyType.md)
# Entity: checkAnyType

> function in `packages/core/src/verify/builtin.ts:296`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/builtin.ts`
- **Line:** 296
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: exitCodeFromResult (wiki/entities/exitCodeFromResult.md)
# Entity: exitCodeFromResult

> function in `packages/cli/src/json.ts:27`

## Details

- **Kind:** function
- **File:** `packages/cli/src/json.ts`
- **Line:** 27
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: abTest (wiki/entities/abTest.md)
# Entity: abTest

> function in `packages/core/src/prompts/evolution.ts:238`

## Details

- **Kind:** function
- **File:** `packages/core/src/prompts/evolution.ts`
- **Line:** 238
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: CloudPromptImprovement (wiki/entities/CloudPromptImprovement.md)
# Entity: CloudPromptImprovement

> interface in `packages/core/src/cloud/types.ts:230`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 230
- **Exported:** yes
- **PageRank:** 0.0034

---
#### Entity: prCommand (wiki/entities/prCommand.md)
# Entity: prCommand

> function in `packages/cli/src/commands/pr.ts:338`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/pr.ts`
- **Line:** 338
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: trackToolUsage (wiki/entities/trackToolUsage.md)
# Entity: trackToolUsage

> function in `packages/core/src/stats/tracker.ts:512`

## Details

- **Kind:** function
- **File:** `packages/core/src/stats/tracker.ts`
- **Line:** 512
- **Exported:** yes
- **PageRank:** 0.0024

---
#### Entity: runZap (wiki/entities/runZap.md)
# Entity: runZap

> function in `packages/core/src/verify/zap.ts:149`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/zap.ts`
- **Line:** 149
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: startDeviceFlow (wiki/entities/startDeviceFlow.md)
# Entity: startDeviceFlow

> function in `packages/core/src/cloud/auth.ts:127`

## Details

- **Kind:** function
- **File:** `packages/core/src/cloud/auth.ts`
- **Line:** 127
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: explainCommand (wiki/entities/explainCommand.md)
# Entity: explainCommand

> function in `packages/cli/src/commands/explain.ts:215`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/explain.ts`
- **Line:** 215
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: shouldDelegateToHost (wiki/entities/shouldDelegateToHost.md)
# Entity: shouldDelegateToHost

> function in `packages/core/src/config/index.ts:191`

## Details

- **Kind:** function
- **File:** `packages/core/src/config/index.ts`
- **Line:** 191
- **Exported:** yes
- **PageRank:** 0.0022

---
#### Entity: assembleBudget (wiki/entities/assembleBudget.md)
# Entity: assembleBudget

> function in `packages/core/src/context/budget.ts:55`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/budget.ts`
- **Line:** 55
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: truncateToFit (wiki/entities/truncateToFit.md)
# Entity: truncateToFit

> function in `packages/core/src/context/budget.ts:88`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/budget.ts`
- **Line:** 88
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: syntaxGuard (wiki/entities/syntaxGuard.md)
# Entity: syntaxGuard

> function in `packages/core/src/verify/syntax-guard.ts:122`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/syntax-guard.ts`
- **Line:** 122
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: retire (wiki/entities/retire.md)
# Entity: retire

> function in `packages/core/src/prompts/evolution.ts:285`

## Details

- **Kind:** function
- **File:** `packages/core/src/prompts/evolution.ts`
- **Line:** 285
- **Exported:** yes
- **PageRank:** 0.0022

---
#### Entity: getToolUsageStats (wiki/entities/getToolUsageStats.md)
# Entity: getToolUsageStats

> function in `packages/core/src/stats/tracker.ts:536`

## Details

- **Kind:** function
- **File:** `packages/core/src/stats/tracker.ts`
- **Line:** 536
- **Exported:** yes
- **PageRank:** 0.0035

---
#### Entity: outputDelegationRequest (wiki/entities/outputDelegationRequest.md)
# Entity: outputDelegationRequest

> function in `packages/core/src/ai/delegation.ts:110`

## Details

- **Kind:** function
- **File:** `packages/core/src/ai/delegation.ts`
- **Line:** 110
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: assembleRetrievalText (wiki/entities/assembleRetrievalText.md)
# Entity: assembleRetrievalText

> function in `packages/core/src/context/retrieval.ts:325`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/retrieval.ts`
- **Line:** 325
- **Exported:** yes
- **PageRank:** 0.0027

---
#### Entity: FeedbackBatchPayload (wiki/entities/FeedbackBatchPayload.md)
# Entity: FeedbackBatchPayload

> interface in `packages/core/src/cloud/types.ts:225`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 225
- **Exported:** yes
- **PageRank:** 0.0028

---
#### Entity: getPromptStats (wiki/entities/getPromptStats.md)
# Entity: getPromptStats

> function in `packages/core/src/prompts/engine.ts:115`

## Details

- **Kind:** function
- **File:** `packages/core/src/prompts/engine.ts`
- **Line:** 115
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: setupCommand (wiki/entities/setupCommand.md)
# Entity: setupCommand

> function in `packages/cli/src/commands/setup.ts:440`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/setup.ts`
- **Line:** 440
- **Exported:** yes
- **PageRank:** 0.0022

---
#### Entity: pollForToken (wiki/entities/pollForToken.md)
# Entity: pollForToken

> function in `packages/core/src/cloud/auth.ts:178`

## Details

- **Kind:** function
- **File:** `packages/core/src/cloud/auth.ts`
- **Line:** 178
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: brainstormAction (wiki/entities/brainstormAction.md)
# Entity: brainstormAction

> function in `packages/cli/src/commands/brainstorm.ts:129`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/brainstorm.ts`
- **Line:** 129
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: resetWorkingContext (wiki/entities/resetWorkingContext.md)
# Entity: resetWorkingContext

> function in `packages/core/src/context/working.ts:150`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/working.ts`
- **Line:** 150
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runBuiltinChecks (wiki/entities/runBuiltinChecks.md)
# Entity: runBuiltinChecks

> function in `packages/core/src/verify/builtin.ts:340`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/builtin.ts`
- **Line:** 340
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: runBenchmark (wiki/entities/runBenchmark.md)
# Entity: runBenchmark

> function in `packages/core/src/benchmark/runner.ts:42`

## Details

- **Kind:** function
- **File:** `packages/core/src/benchmark/runner.ts`
- **Line:** 42
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: scaffoldFeatureWithContext (wiki/entities/scaffoldFeatureWithContext.md)
# Entity: scaffoldFeatureWithContext

> function in `packages/core/src/features/numbering.ts:379`

## Details

- **Kind:** function
- **File:** `packages/core/src/features/numbering.ts`
- **Line:** 379
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: getChangedFiles (wiki/entities/getChangedFiles.md)
# Entity: getChangedFiles

> function in `packages/core/src/wiki/state.ts:68`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/state.ts`
- **Line:** 68
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: generate (wiki/entities/generate.md)
# Entity: generate

> function in `packages/core/src/ai/index.ts:95`

## Details

- **Kind:** function
- **File:** `packages/core/src/ai/index.ts`
- **Line:** 95
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: searchWithRipgrep (wiki/entities/searchWithRipgrep.md)
# Entity: searchWithRipgrep

> function in `packages/core/src/context/retrieval.ts:151`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/retrieval.ts`
- **Line:** 151
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: getStatsDb (wiki/entities/getStatsDb.md)
# Entity: getStatsDb

> function in `packages/core/src/db/index.ts:221`

## Details

- **Kind:** function
- **File:** `packages/core/src/db/index.ts`
- **Line:** 221
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: runHooks (wiki/entities/runHooks.md)
# Entity: runHooks

> function in `packages/core/src/hooks/runner.ts:100`

## Details

- **Kind:** function
- **File:** `packages/core/src/hooks/runner.ts`
- **Line:** 100
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: extractEntities (wiki/entities/extractEntities.md)
# Entity: extractEntities

> function in `packages/core/src/context/treesitter.ts:166`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/treesitter.ts`
- **Line:** 166
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: verifyCommand (wiki/entities/verifyCommand.md)
# Entity: verifyCommand

> function in `packages/cli/src/commands/verify.ts:481`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/verify.ts`
- **Line:** 481
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: detectCommentedCode (wiki/entities/detectCommentedCode.md)
# Entity: detectCommentedCode

> function in `packages/core/src/verify/slop.ts:326`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/slop.ts`
- **Line:** 326
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runTypecheck (wiki/entities/runTypecheck.md)
# Entity: runTypecheck

> function in `packages/core/src/verify/typecheck.ts:106`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/typecheck.ts`
- **Line:** 106
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: getSkipRate (wiki/entities/getSkipRate.md)
# Entity: getSkipRate

> function in `packages/core/src/stats/tracker.ts:466`

## Details

- **Kind:** function
- **File:** `packages/core/src/stats/tracker.ts`
- **Line:** 466
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: getRepoSlug (wiki/entities/getRepoSlug.md)
# Entity: getRepoSlug

> function in `packages/core/src/git/index.ts:118`

## Details

- **Kind:** function
- **File:** `packages/core/src/git/index.ts`
- **Line:** 118
- **Exported:** yes
- **PageRank:** 0.0026

---
#### Entity: runVisualVerification (wiki/entities/runVisualVerification.md)
# Entity: runVisualVerification

> function in `packages/core/src/verify/visual.ts:269`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/visual.ts`
- **Line:** 269
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: analyzeCommand (wiki/entities/analyzeCommand.md)
# Entity: analyzeCommand

> function in `packages/cli/src/commands/analyze.ts:266`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/analyze.ts`
- **Line:** 266
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: captureResult (wiki/entities/captureResult.md)
# Entity: captureResult

> function in `packages/core/src/feedback/capture.ts:55`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/capture.ts`
- **Line:** 55
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: FeedbackImprovementsResponse (wiki/entities/FeedbackImprovementsResponse.md)
# Entity: FeedbackImprovementsResponse

> interface in `packages/core/src/cloud/types.ts:243`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 243
- **Exported:** yes
- **PageRank:** 0.0044

---
#### Entity: HostDelegation (wiki/entities/HostDelegation.md)
# Entity: HostDelegation

> interface in `packages/core/src/config/index.ts:175`

## Details

- **Kind:** interface
- **File:** `packages/core/src/config/index.ts`
- **Line:** 175
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: benchmarkCommand (wiki/entities/benchmarkCommand.md)
# Entity: benchmarkCommand

> function in `packages/cli/src/commands/benchmark.ts:110`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/benchmark.ts`
- **Line:** 110
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: initAction (wiki/entities/initAction.md)
# Entity: initAction

> function in `packages/cli/src/commands/init.ts:115`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/init.ts`
- **Line:** 115
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: mapToArticles (wiki/entities/mapToArticles.md)
# Entity: mapToArticles

> function in `packages/core/src/wiki/graph.ts:388`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/graph.ts`
- **Line:** 388
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: brainstormCommand (wiki/entities/brainstormCommand.md)
# Entity: brainstormCommand

> function in `packages/cli/src/commands/brainstorm.ts:262`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/brainstorm.ts`
- **Line:** 262
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: ToolUsageStats (wiki/entities/ToolUsageStats.md)
# Entity: ToolUsageStats

> interface in `packages/core/src/stats/tracker.ts:502`

## Details

- **Kind:** interface
- **File:** `packages/core/src/stats/tracker.ts`
- **Line:** 502
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: ToolUsageInput (wiki/entities/ToolUsageInput.md)
# Entity: ToolUsageInput

> interface in `packages/core/src/stats/tracker.ts:494`

## Details

- **Kind:** interface
- **File:** `packages/core/src/stats/tracker.ts`
- **Line:** 494
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: bootstrap (wiki/entities/bootstrap.md)
# Entity: bootstrap

> function in `packages/core/src/init/index.ts:1290`

## Details

- **Kind:** function
- **File:** `packages/core/src/init/index.ts`
- **Line:** 1290
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: planAction (wiki/entities/planAction.md)
# Entity: planAction

> function in `packages/cli/src/commands/plan.ts:269`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/plan.ts`
- **Line:** 269
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: filterByDiff (wiki/entities/filterByDiff.md)
# Entity: filterByDiff

> function in `packages/core/src/verify/diff-filter.ts:165`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/diff-filter.ts`
- **Line:** 165
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: searchWithGrep (wiki/entities/searchWithGrep.md)
# Entity: searchWithGrep

> function in `packages/core/src/context/retrieval.ts:219`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/retrieval.ts`
- **Line:** 219
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: exportEpisodicForCloud (wiki/entities/exportEpisodicForCloud.md)
# Entity: exportEpisodicForCloud

> function in `packages/core/src/feedback/sync.ts:130`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/sync.ts`
- **Line:** 130
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: reviewDesign (wiki/entities/reviewDesign.md)
# Entity: reviewDesign

> function in `packages/core/src/design/review.ts:228`

## Details

- **Kind:** function
- **File:** `packages/core/src/design/review.ts`
- **Line:** 228
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: VerifyFinding (wiki/entities/VerifyFinding.md)
# Entity: VerifyFinding

> interface in `packages/core/src/cloud/types.ts:131`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 131
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: createTicket (wiki/entities/createTicket.md)
# Entity: createTicket

> function in `packages/core/src/ticket/index.ts:141`

## Details

- **Kind:** function
- **File:** `packages/core/src/ticket/index.ts`
- **Line:** 141
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: handleDeleteTodo (wiki/entities/handleDeleteTodo.md)
# Entity: handleDeleteTodo

> function in `examples/todo-api/src/routes.ts:73`

## Details

- **Kind:** function
- **File:** `examples/todo-api/src/routes.ts`
- **Line:** 73
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: updateBaselines (wiki/entities/updateBaselines.md)
# Entity: updateBaselines

> function in `packages/core/src/verify/visual.ts:425`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/visual.ts`
- **Line:** 425
- **Exported:** yes
- **PageRank:** 0.0026

---
#### Entity: WikiLintResult (wiki/entities/WikiLintResult.md)
# Entity: WikiLintResult

> interface in `packages/core/src/wiki/types.ts:148`

## Details

- **Kind:** interface
- **File:** `packages/core/src/wiki/types.ts`
- **Line:** 148
- **Exported:** yes
- **PageRank:** 0.0024

---
#### Entity: CloudFeedbackPayload (wiki/entities/CloudFeedbackPayload.md)
# Entity: CloudFeedbackPayload

> interface in `packages/core/src/cloud/types.ts:167`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 167
- **Exported:** yes
- **PageRank:** 0.0017

---
#### Entity: promote (wiki/entities/promote.md)
# Entity: promote

> function in `packages/core/src/prompts/evolution.ts:270`

## Details

- **Kind:** function
- **File:** `packages/core/src/prompts/evolution.ts`
- **Line:** 270
- **Exported:** yes
- **PageRank:** 0.0017

---
#### Entity: assembleContext (wiki/entities/assembleContext.md)
# Entity: assembleContext

> function in `packages/core/src/context/engine.ts:332`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/engine.ts`
- **Line:** 332
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: getWorkflowId (wiki/entities/getWorkflowId.md)
# Entity: getWorkflowId

> function in `packages/core/src/feedback/collector.ts:187`

## Details

- **Kind:** function
- **File:** `packages/core/src/feedback/collector.ts`
- **Line:** 187
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: DECAY_HALF_LIVES (wiki/entities/DECAY_HALF_LIVES.md)
# Entity: DECAY_HALF_LIVES

> variable in `packages/core/src/wiki/types.ts:162`

## Details

- **Kind:** variable
- **File:** `packages/core/src/wiki/types.ts`
- **Line:** 162
- **Exported:** yes
- **PageRank:** 0.0035

---
#### Entity: runSecretlint (wiki/entities/runSecretlint.md)
# Entity: runSecretlint

> function in `packages/core/src/verify/secretlint.ts:133`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/secretlint.ts`
- **Line:** 133
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: promptVersions (wiki/entities/promptVersions.md)
# Entity: promptVersions

> variable in `packages/core/src/db/schema.ts:75`

## Details

- **Kind:** variable
- **File:** `packages/core/src/db/schema.ts`
- **Line:** 75
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: WikiLintFinding (wiki/entities/WikiLintFinding.md)
# Entity: WikiLintFinding

> interface in `packages/core/src/wiki/types.ts:140`

## Details

- **Kind:** interface
- **File:** `packages/core/src/wiki/types.ts`
- **Line:** 140
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: getLinkSyntax (wiki/entities/getLinkSyntax.md)
# Entity: getLinkSyntax

> function in `packages/core/src/wiki/schema.ts:72`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/schema.ts`
- **Line:** 72
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: assembleEpisodicText (wiki/entities/assembleEpisodicText.md)
# Entity: assembleEpisodicText

> function in `packages/core/src/context/episodic.ts:237`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/episodic.ts`
- **Line:** 237
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: getSupportedLanguages (wiki/entities/getSupportedLanguages.md)
# Entity: getSupportedLanguages

> function in `packages/core/src/language/profile.ts:173`

## Details

- **Kind:** function
- **File:** `packages/core/src/language/profile.ts`
- **Line:** 173
- **Exported:** yes
- **PageRank:** 0.0028

---
#### Entity: doctorAction (wiki/entities/doctorAction.md)
# Entity: doctorAction

> function in `packages/cli/src/commands/doctor.ts:365`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/doctor.ts`
- **Line:** 365
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runCoverage (wiki/entities/runCoverage.md)
# Entity: runCoverage

> function in `packages/core/src/verify/coverage.ts:98`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/coverage.ts`
- **Line:** 98
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: Tier3Totals (wiki/entities/Tier3Totals.md)
# Entity: Tier3Totals

> interface in `packages/core/src/benchmark/types.ts:69`

## Details

- **Kind:** interface
- **File:** `packages/core/src/benchmark/types.ts`
- **Line:** 69
- **Exported:** yes
- **PageRank:** 0.0013

---
#### Entity: PHP_PROFILE (wiki/entities/PHP_PROFILE.md)
# Entity: PHP_PROFILE

> variable in `packages/core/src/language/profile.ts:139`

## Details

- **Kind:** variable
- **File:** `packages/core/src/language/profile.ts`
- **Line:** 139
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: ticketCommand (wiki/entities/ticketCommand.md)
# Entity: ticketCommand

> function in `packages/cli/src/commands/ticket.ts:144`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/ticket.ts`
- **Line:** 144
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: VerifyResultResponse (wiki/entities/VerifyResultResponse.md)
# Entity: VerifyResultResponse

> interface in `packages/core/src/cloud/types.ts:146`

## Details

- **Kind:** interface
- **File:** `packages/core/src/cloud/types.ts`
- **Line:** 146
- **Exported:** yes
- **PageRank:** 0.0016

---
#### Entity: parseFile (wiki/entities/parseFile.md)
# Entity: parseFile

> function in `packages/core/src/context/treesitter.ts:207`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/treesitter.ts`
- **Line:** 207
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: getTrackedFiles (wiki/entities/getTrackedFiles.md)
# Entity: getTrackedFiles

> function in `packages/core/src/git/index.ts:103`

## Details

- **Kind:** function
- **File:** `packages/core/src/git/index.ts`
- **Line:** 103
- **Exported:** yes
- **PageRank:** 0.0018

---
#### Entity: runSemgrep (wiki/entities/runSemgrep.md)
# Entity: runSemgrep

> function in `packages/core/src/verify/semgrep.ts:132`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/semgrep.ts`
- **Line:** 132
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: setupAction (wiki/entities/setupAction.md)
# Entity: setupAction

> function in `packages/cli/src/commands/setup.ts:262`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/setup.ts`
- **Line:** 262
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: getStagedFiles (wiki/entities/getStagedFiles.md)
# Entity: getStagedFiles

> function in `packages/core/src/git/index.ts:97`

## Details

- **Kind:** function
- **File:** `packages/core/src/git/index.ts`
- **Line:** 97
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: runSonar (wiki/entities/runSonar.md)
# Entity: runSonar

> function in `packages/core/src/verify/sonar.ts:106`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/sonar.ts`
- **Line:** 106
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: compareImages (wiki/entities/compareImages.md)
# Entity: compareImages

> function in `packages/core/src/verify/visual.ts:222`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/visual.ts`
- **Line:** 222
- **Exported:** yes
- **PageRank:** 0.0014

---
#### Entity: persistSemanticContext (wiki/entities/persistSemanticContext.md)
# Entity: persistSemanticContext

> function in `packages/core/src/context/semantic.ts:282`

## Details

- **Kind:** function
- **File:** `packages/core/src/context/semantic.ts`
- **Line:** 282
- **Exported:** yes
- **PageRank:** 0.0017

---
#### Entity: doctorCommand (wiki/entities/doctorCommand.md)
# Entity: doctorCommand

> function in `packages/cli/src/commands/doctor.ts:442`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/doctor.ts`
- **Line:** 442
- **Exported:** yes
- **PageRank:** 0.0020

---
#### Entity: commitCommand (wiki/entities/commitCommand.md)
# Entity: commitCommand

> function in `packages/cli/src/commands/commit.ts:500`

## Details

- **Kind:** function
- **File:** `packages/cli/src/commands/commit.ts`
- **Line:** 500
- **Exported:** yes
- **PageRank:** 0.0015

---
#### Entity: runMutation (wiki/entities/runMutation.md)
# Entity: runMutation

> function in `packages/core/src/verify/mutation.ts:105`

## Details

- **Kind:** function
- **File:** `packages/core/src/verify/mutation.ts`
- **Line:** 105
- **Exported:** yes
- **PageRank:** 0.0012

---
#### Entity: getProfile (wiki/entities/getProfile.md)
# Entity: getProfile

> function in `packages/core/src/language/profile.ts:169`

## Details

- **Kind:** function
- **File:** `packages/core/src/language/profile.ts`
- **Line:** 169
- **Exported:** yes
- **PageRank:** 0.0019

---
#### Entity: recordArticlesLoaded (wiki/entities/recordArticlesLoaded.md)
# Entity: recordArticlesLoaded

> function in `packages/core/src/wiki/signals.ts:224`

## Details

- **Kind:** function
- **File:** `packages/core/src/wiki/signals.ts`
- **Line:** 224
- **Exported:** yes
- **PageRank:** 0.0015

---
#### External RFC (wiki/raw/test-rfc.md)
# External RFC
This is a test document.

---