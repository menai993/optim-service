// src/scoring/engine.ts
// Scores findings by effort and impact, returns ScoredRecommendation[]

import { Finding } from '../types/agents';
import { ScoredRecommendation, EffortScore, ImpactScore } from '../types/scoring';
import { scoreFinding, computePriorityScore } from './rubric';

/**
 * Score all findings and return a list of ScoredRecommendations, sorted by
 * priority (highest first).
 */
export function scoreFindings(findings: Finding[]): ScoredRecommendation[] {
  const scored = findings.map((finding) => {
    const { effort, impact } = scoreFinding(finding);
    const priorityScore = computePriorityScore(effort as EffortScore, impact as ImpactScore);

    return {
      finding,
      effortScore: effort as EffortScore,
      impactScore: impact as ImpactScore,
      priorityScore,
      recommendation: buildRecommendationText(finding),
      exampleFix: finding.snippet,
    } satisfies ScoredRecommendation;
  });

  // Sort descending by priority score
  scored.sort((a, b) => b.priorityScore - a.priorityScore);

  return scored;
}

/**
 * Build a human-readable recommendation string from a Finding.
 */
function buildRecommendationText(finding: Finding): string {
  return `[${finding.layer.toUpperCase()}] ${finding.title}: ${finding.description.slice(0, 200)}${finding.description.length > 200 ? '…' : ''}`;
}
