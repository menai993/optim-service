// src/types/report.ts
// Shared types for the report layer

import { ScoredRecommendation } from './scoring';

export type ReportMode = 'full' | 'summary' | 'json';

export interface OptimizationReport {
  /** ISO timestamp of report generation */
  generatedAt: string;
  /** Short title / project name */
  title: string;
  mode: ReportMode;
  /** Ordered list of scored recommendations (highest priority first) */
  recommendations: ScoredRecommendation[];
  /** Executive summary paragraph */
  summary: string;
  /** Raw markdown output, set by the formatter */
  markdown?: string;
  /** Raw JSON output, set by the formatter */
  json?: string;
}
