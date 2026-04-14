// src/scoring/rubric.ts
// Effort / impact rubric definitions and scoring logic

import { Finding, FindingLayer } from '../types/agents';
import { EffortScore, ImpactScore } from '../types/scoring';

interface RubricEntry {
  layer: FindingLayer;
  keywords: string[];
  effortScore: EffortScore;
  impactScore: ImpactScore;
}

/**
 * Heuristic rubric entries used to score findings.
 * The first matching entry (by layer + keyword) wins.
 */
const RUBRIC: RubricEntry[] = [
  // Index additions — low effort, high impact
  { layer: 'index', keywords: ['missing index', 'add index', 'create index'], effortScore: 1, impactScore: 5 },
  { layer: 'index', keywords: ['redundant index', 'duplicate index'], effortScore: 1, impactScore: 2 },

  // Query rewrites — medium effort, high impact
  { layer: 'query', keywords: ['full table scan', 'seq scan', 'sequential scan'], effortScore: 2, impactScore: 4 },
  { layer: 'query', keywords: ['n+1', 'n + 1'], effortScore: 3, impactScore: 5 },
  { layer: 'query', keywords: ['subquery', 'correlated subquery'], effortScore: 2, impactScore: 3 },

  // Schema changes — higher effort
  { layer: 'schema', keywords: ['partition', 'partitioning'], effortScore: 4, impactScore: 4 },
  { layer: 'schema', keywords: ['data type', 'column type'], effortScore: 2, impactScore: 2 },

  // Application — caching
  { layer: 'caching', keywords: ['cache', 'caching', 'redis', 'memcache'], effortScore: 3, impactScore: 4 },

  // ORM
  { layer: 'orm', keywords: ['select *', 'select all columns', 'unbounded'], effortScore: 1, impactScore: 3 },
  { layer: 'orm', keywords: ['eager load', 'eager loading', 'include'], effortScore: 2, impactScore: 4 },

  // Application layer
  { layer: 'application', keywords: ['connection pool', 'pooling'], effortScore: 2, impactScore: 4 },
  { layer: 'application', keywords: ['synchronous', 'blocking'], effortScore: 3, impactScore: 3 },
];

const DEFAULT_EFFORT: EffortScore = 3;
const DEFAULT_IMPACT: ImpactScore = 2;

/**
 * Score a finding by matching it against the rubric.
 */
export function scoreFinding(finding: Finding): { effort: EffortScore; impact: ImpactScore } {
  const haystack = `${finding.title} ${finding.description}`.toLowerCase();

  for (const entry of RUBRIC) {
    if (entry.layer !== finding.layer) continue;
    const matches = entry.keywords.some((kw) => haystack.includes(kw));
    if (matches) {
      return { effort: entry.effortScore, impact: entry.impactScore };
    }
  }

  // Fall back to layer-level defaults
  switch (finding.layer) {
    case 'index':
      return { effort: 1, impact: 3 };
    case 'query':
      return { effort: 2, impact: 3 };
    case 'schema':
      return { effort: 3, impact: 3 };
    case 'caching':
      return { effort: 3, impact: 3 };
    case 'orm':
      return { effort: 2, impact: 2 };
    case 'application':
      return { effort: 3, impact: 2 };
    default:
      return { effort: DEFAULT_EFFORT, impact: DEFAULT_IMPACT };
  }
}

/**
 * Compute a composite priority score from effort and impact.
 * Higher is better. Formula: impact^2 / effort (scale 0-25).
 */
export function computePriorityScore(effort: EffortScore, impact: ImpactScore): number {
  return Math.round((impact * impact) / effort);
}
