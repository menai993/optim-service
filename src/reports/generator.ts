// src/reports/generator.ts
// Turns ScoredRecommendation[] into an OptimizationReport

import crypto from 'node:crypto';
import { ScoredRecommendation } from '../types/scoring';
import { Finding, DiscussionRound, AppContext } from '../types/agents';
import { OptimizationReport, ReportMode } from '../types/report';

/**
 * Generate an OptimizationReport from scored recommendations and discussion results.
 */
export function generateReport(
  scoredRecommendations: ScoredRecommendation[],
  rounds: DiscussionRound[],
  rawFindings: Finding[],
  context: AppContext,
  mode: ReportMode,
): OptimizationReport {
  // Filter by mode
  const filtered = scoredRecommendations.filter((r) => {
    switch (mode) {
      case 'sql_only':
        return r.finding.layer === 'sql' || r.finding.layer === 'both';
      case 'backend_only':
        return r.finding.layer === 'backend' || r.finding.layer === 'both';
      case 'combined':
        return true;
    }
  });

  // Sort by implementationOrder
  const sorted = [...filtered].sort((a, b) => a.implementationOrder - b.implementationOrder);

  // Quick wins: roi >= 2.5 AND effort <= 2
  const quickWins = sorted
    .filter((r) => r.roi >= 2.5 && r.effort.value <= 2)
    .sort((a, b) => a.implementationOrder - b.implementationOrder);

  // Complex bets: effort >= 4
  const complexBets = sorted
    .filter((r) => r.effort.value >= 4)
    .sort((a, b) => a.implementationOrder - b.implementationOrder);

  const criticalFindings = sorted.filter((r) => r.finding.severity === 'critical').length;

  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    mode,
    appSummary: context.summary,
    totalFindings: sorted.length,
    criticalFindings,
    recommendations: sorted,
    quickWins,
    complexBets,
    discussionRounds: rounds,
    rawFindings,
  };
}
