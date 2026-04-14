// src/types/validators.ts
// Zod runtime validators for key domain types

import { z } from 'zod';

// ── Finding ──────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  id: z.string().uuid(),
  layer: z.enum(['sql', 'backend', 'both']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string().min(1),
  description: z.string().min(1),
  affectedArtifacts: z.array(z.string()),
  suggestedFix: z.string().min(1),
  sqlExample: z.string().optional(),
  codeExample: z.string().optional(),
  dependsOn: z.array(z.string()),
  blocks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  agentSource: z.enum(['sql_specialist', 'backend_specialist', 'orchestrator']),
});

// ── AppContextInput ──────────────────────────────────────────────────────────

const ColumnDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  hasIndex: z.boolean(),
});

const ForeignKeyDefinitionSchema = z.object({
  column: z.string().min(1),
  referencesTable: z.string().min(1),
  referencesColumn: z.string().min(1),
});

const TableDefinitionSchema = z.object({
  name: z.string().min(1),
  columns: z.array(ColumnDefinitionSchema),
  primaryKey: z.array(z.string()),
  foreignKeys: z.array(ForeignKeyDefinitionSchema),
  estimatedRowCount: z.number().int().nonnegative().optional(),
});

const IndexDefinitionSchema = z.object({
  name: z.string().min(1),
  table: z.string().min(1),
  columns: z.array(z.string().min(1)),
  type: z.string().min(1),
  isUnique: z.boolean(),
  sizeEstimate: z.string().optional(),
});

const SlowQuerySchema = z.object({
  duration_ms: z.number().nonnegative(),
  query: z.string().min(1),
  calls: z.number().int().nonnegative(),
  explainOutput: z.string().optional(),
});

const SqlArtifactSchema = z.object({
  type: z.enum(['schema', 'migration', 'slow_query_log', 'explain_plan', 'index_list']),
  filename: z.string().min(1),
  rawContent: z.string(),
  parsedTables: z.array(TableDefinitionSchema).optional(),
  parsedIndexes: z.array(IndexDefinitionSchema).optional(),
  slowQueries: z.array(SlowQuerySchema).optional(),
});

const PatternTypeSchema = z.enum([
  'n_plus_one',
  'missing_cache',
  'orm_lazy_load',
  'select_star',
  'synchronous_bulk',
  'missing_pagination',
  'unbounded_query',
]);

const DetectedPatternSchema = z.object({
  type: PatternTypeSchema,
  lineRange: z.tuple([z.number().int(), z.number().int()]),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const CodeArtifactSchema = z.object({
  type: z.enum(['service', 'controller', 'repository', 'model', 'middleware', 'job']),
  filename: z.string().min(1),
  language: z.enum(['typescript', 'javascript', 'python', 'java', 'csharp', 'go']),
  rawContent: z.string(),
  detectedPatterns: z.array(DetectedPatternSchema).optional(),
});

export const AppContextInputSchema = z.object({
  sqlArtifacts: z.array(SqlArtifactSchema),
  codeArtifacts: z.array(CodeArtifactSchema),
  metadata: z
    .object({
      framework: z.string().optional(),
      orm: z.string().optional(),
      dbEngine: z.enum(['postgresql', 'mysql', 'mssql', 'sqlite']).optional(),
      trafficProfile: z.enum(['read_heavy', 'write_heavy', 'balanced']).optional(),
      description: z.string().optional(),
    })
    .optional(),
});

// ── AppContext (LLM output from context builder) ─────────────────────────────

const OrmRelationshipSchema = z.object({
  entity: z.string().min(1),
  relationType: z.enum(['has_many', 'belongs_to', 'has_one', 'many_to_many']),
  relatedEntity: z.string().min(1),
  isLazyLoaded: z.boolean(),
});

export const AppContextSchema = z.object({
  summary: z.string().min(1),
  tables: z.array(TableDefinitionSchema),
  hotTables: z.array(z.string()),
  endpointQueryMap: z.record(z.string(), z.array(z.string())),
  ormRelationships: z.array(OrmRelationshipSchema),
  trafficProfile: z.string().min(1),
  criticalPaths: z.array(z.string()),
});

// ── OptimizationReport ───────────────────────────────────────────────────────

const EffortScoreSchema = z.object({
  value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  label: z.string().min(1),
  reasoning: z.string().min(1),
});

const ImpactScoreSchema = z.object({
  value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  label: z.string().min(1),
  reasoning: z.string().min(1),
});

const ScoredRecommendationSchema = z.object({
  finding: FindingSchema,
  effort: EffortScoreSchema,
  impact: ImpactScoreSchema,
  roi: z.number(),
  implementationOrder: z.number().int().positive(),
  estimatedQuerySpeedup: z.string().optional(),
  estimatedLoadReduction: z.string().optional(),
});

const AgentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  agentId: z.string().min(1),
  roundNumber: z.number().int().nonnegative(),
  timestamp: z.string(),
});

const ConflictItemSchema = z.object({
  findingIdA: z.string(),
  findingIdB: z.string(),
  description: z.string().min(1),
  resolution: z.string().optional(),
});

const DiscussionRoundSchema = z.object({
  roundNumber: z.number().int().nonnegative(),
  sqlMessage: AgentMessageSchema,
  backendMessage: AgentMessageSchema,
  crossCuttingItems: z.array(z.string()),
  conflicts: z.array(ConflictItemSchema),
});

export const OptimizationReportSchema = z.object({
  id: z.string().uuid(),
  generatedAt: z.string(),
  mode: z.enum(['sql_only', 'backend_only', 'combined']),
  appSummary: z.string().min(1),
  totalFindings: z.number().int().nonnegative(),
  criticalFindings: z.number().int().nonnegative(),
  recommendations: z.array(ScoredRecommendationSchema),
  quickWins: z.array(ScoredRecommendationSchema),
  complexBets: z.array(ScoredRecommendationSchema),
  discussionRounds: z.array(DiscussionRoundSchema),
  rawFindings: z.array(FindingSchema),
});
