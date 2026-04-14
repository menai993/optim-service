// src/types/report.ts
// Shared types for the report layer

import { ScoredRecommendation } from './scoring';
import { DiscussionRound, Finding } from './agents';

export type ReportMode = 'sql_only' | 'backend_only' | 'combined';

export interface OptimizationReport {
  id: string;
  generatedAt: string;
  mode: ReportMode;
  appSummary: string;
  totalFindings: number;
  criticalFindings: number;
  recommendations: ScoredRecommendation[];
  quickWins: ScoredRecommendation[];
  complexBets: ScoredRecommendation[];
  discussionRounds: DiscussionRound[];
  rawFindings: Finding[];
}
