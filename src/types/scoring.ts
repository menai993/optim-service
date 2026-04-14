// src/types/scoring.ts
// Shared types for the scoring layer

import { Finding } from './agents';

export interface EffortScore {
  value: 1 | 2 | 3 | 4 | 5;
  label: string;
  reasoning: string;
}

export interface ImpactScore {
  value: 1 | 2 | 3 | 4 | 5;
  label: string;
  reasoning: string;
}

export interface ScoredRecommendation {
  finding: Finding;
  effort: EffortScore;
  impact: ImpactScore;
  roi: number;
  implementationOrder: number;
  estimatedQuerySpeedup?: string;
  estimatedLoadReduction?: string;
}
