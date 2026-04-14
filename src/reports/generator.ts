// src/reports/generator.ts
// Turns ScoredRecommendation[] into an OptimizationReport

import { ScoredRecommendation } from '../types/scoring';
import { OptimizationReport, ReportMode } from '../types/report';

/**
 * Generate an OptimizationReport from a list of scored recommendations.
 */
export function generateReport(
  recommendations: ScoredRecommendation[],
  title: string = 'Optimization Report',
  mode: ReportMode = 'full',
): OptimizationReport {
  const summary = buildSummary(recommendations);

  return {
    generatedAt: new Date().toISOString(),
    title,
    mode,
    recommendations,
    summary,
  };
}

/**
 * Build a brief executive summary from the top findings.
 */
function buildSummary(recommendations: ScoredRecommendation[]): string {
  if (recommendations.length === 0) {
    return 'No optimisation opportunities were identified.';
  }

  const topN = recommendations.slice(0, 3);
  const topTitles = topN.map((r) => r.finding.title).join(', ');
  return (
    `Found ${recommendations.length} optimisation opportunity/ies. ` +
    `Top priorities: ${topTitles}. ` +
    `Review the recommendations below, starting with the highest priority items.`
  );
}
