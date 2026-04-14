// src/types/index.ts
// Re-export all shared types

export type {
  ColumnDefinition,
  ForeignKeyDefinition,
  TableDefinition,
  IndexDefinition,
  SlowQuery,
  SqlArtifact,
  PatternType,
  DetectedPattern,
  CodeArtifact,
  AppContextInput,
} from './ingestion';

export type {
  FindingLayer,
  FindingSeverity,
  Finding,
  AgentMessage,
  ConflictItem,
  DiscussionRound,
  OrmRelationship,
  AppContext,
} from './agents';

export type {
  EffortScore,
  ImpactScore,
  ScoredRecommendation,
} from './scoring';

export type {
  ReportMode,
  OptimizationReport,
} from './report';
