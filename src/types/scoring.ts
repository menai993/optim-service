// src/types/scoring.ts
// Shared types for the scoring layer

import { Finding } from './agents';

/** Numeric 1-5 effort score: 1 = trivial, 5 = very complex */
export type EffortScore = 1 | 2 | 3 | 4 | 5;

/** Numeric 1-5 impact score: 1 = negligible, 5 = critical */
export type ImpactScore = 1 | 2 | 3 | 4 | 5;

export interface ScoredRecommendation {
  finding: Finding;
  effortScore: EffortScore;
  impactScore: ImpactScore;
  /** Composite priority: higher is better. Derived from impact / effort. */
  priorityScore: number;
  /** Human-readable recommendation text */
  recommendation: string;
  /** Code or SQL example showing the fix */
  exampleFix?: string;
}
