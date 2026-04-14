// src/pipeline.ts
// Main orchestration: wires all agents together end-to-end

import { AppContextInput } from './types/ingestion';
import { Finding, AppContext, DiscussionRound } from './types/agents';
import { OptimizationReport, ReportMode } from './types/report';
import { ingestFiles } from './ingestion';
import { buildContext } from './agents/contextBuilder';
import { runSqlSpecialist } from './agents/sqlSpecialist';
import { runBackendSpecialist } from './agents/backendSpecialist';
import { runDiscussion } from './discussion/protocol';
import { runOrchestrator } from './agents/orchestrator';
import { scoreFindings } from './scoring/engine';
import { generateReport } from './reports/generator';

export interface PipelineOptions {
  mode?: ReportMode;
  metadata?: AppContextInput['metadata'];
  discussionRounds?: number;
}

/**
 * Run the full analysis pipeline as a library function (no HTTP).
 */
export async function runAnalysisPipeline(
  files: Array<{ filename: string; content: string }>,
  options: PipelineOptions = {},
): Promise<OptimizationReport> {
  const mode = options.mode ?? 'combined';
  const maxRounds = options.discussionRounds ?? 2;

  // 1. Ingest files
  const input: AppContextInput = await ingestFiles(files);
  if (options.metadata) {
    input.metadata = options.metadata;
  }

  // 2. Build context
  const context: AppContext = await buildContext(input);

  // 3. Run specialists in parallel
  const [sqlFindings, backendFindings] = await Promise.all([
    runSqlSpecialist(input, context),
    runBackendSpecialist(input, context),
  ]);

  // 4. Run discussion
  const rounds: DiscussionRound[] = await runDiscussion(
    sqlFindings,
    backendFindings,
    context,
    { maxRounds },
  );

  // 5. Run orchestrator with all findings + discussion
  const allFindings: Finding[] = [...sqlFindings, ...backendFindings];
  const mergedFindings = await runOrchestrator(allFindings, rounds, context);

  // 6. Score findings
  const scored = scoreFindings(mergedFindings, context);

  // 7. Generate report
  return generateReport(scored, rounds, mergedFindings, context, mode);
}
