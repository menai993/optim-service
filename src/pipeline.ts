// src/pipeline.ts
// Main orchestration: wires all agents together end-to-end

import Anthropic from '@anthropic-ai/sdk';
import { RawInput } from './types/ingestion';
import { OptimizationReport, ReportMode } from './types/report';
import { parseSql } from './ingestion/sqlParser';
import { parseCode } from './ingestion/codeParser';
import { parseSlowQueryLog } from './ingestion/metricsParser';
import { buildAppContext } from './agents/contextBuilder';
import { orchestrate } from './agents/orchestrator';
import { scoreFindings } from './scoring/engine';
import { generateReport } from './reports/generator';
import { attachFormats } from './reports/formatter';

export interface PipelineOptions {
  title?: string;
  mode?: ReportMode;
  rounds?: number;
  model?: string;
}

/**
 * Run the full optimisation pipeline on a set of raw input files and
 * return a fully-formed OptimizationReport.
 */
export async function runPipeline(
  client: Anthropic,
  files: Array<Pick<RawInput, 'filePath' | 'content' | 'type'>>,
  options: PipelineOptions = {},
): Promise<OptimizationReport> {
  // 1. Ingest
  const sqlArtifacts = [];
  const codeArtifacts = [];

  for (const file of files) {
    switch (file.type) {
      case 'sql':
        sqlArtifacts.push(parseSql(file));
        break;
      case 'json':
        // Assume JSON files may be slow-query logs — try to parse them
        try {
          const slowQueries = parseSlowQueryLog(file.content);
          sqlArtifacts.push({
            sourceFile: file.filePath,
            tables: [],
            indexes: [],
            migrations: [],
            slowQueries,
          });
        } catch {
          // Not a slow-query log — skip
        }
        break;
      case 'typescript':
      case 'javascript':
        codeArtifacts.push(parseCode(file));
        break;
      default:
        // Try SQL first, then code
        try {
          sqlArtifacts.push(parseSql(file));
        } catch {
          codeArtifacts.push(parseCode(file));
        }
    }
  }

  // 2. Build context
  const context = buildAppContext(sqlArtifacts, codeArtifacts);

  // 3. Run agents
  const { findings } = await orchestrate(client, context, {
    model: options.model,
    rounds: options.rounds ?? 2,
  });

  // 4. Score
  const scored = scoreFindings(findings);

  // 5. Generate and format report
  const report = generateReport(scored, options.title ?? 'Optimization Report', options.mode ?? 'full');
  attachFormats(report);

  return report;
}
