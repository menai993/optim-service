// src/types/ingestion.ts
// Shared types for the data ingestion layer

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  hasIndex: boolean;
}

export interface ForeignKeyDefinition {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  foreignKeys: ForeignKeyDefinition[];
  estimatedRowCount?: number;
}

export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  type: string;
  isUnique: boolean;
  sizeEstimate?: string;
}

export interface SlowQuery {
  duration_ms: number;
  query: string;
  calls: number;
  explainOutput?: string;
}

export interface SqlArtifact {
  type: 'schema' | 'migration' | 'slow_query_log' | 'explain_plan' | 'index_list';
  filename: string;
  rawContent: string;
  parsedTables?: TableDefinition[];
  parsedIndexes?: IndexDefinition[];
  slowQueries?: SlowQuery[];
}

export type PatternType =
  | 'n_plus_one'
  | 'missing_cache'
  | 'orm_lazy_load'
  | 'select_star'
  | 'synchronous_bulk'
  | 'missing_pagination'
  | 'unbounded_query';

export interface DetectedPattern {
  type: PatternType;
  lineRange: [number, number];
  description: string;
  confidence: number;
}

export interface CodeArtifact {
  type: 'service' | 'controller' | 'repository' | 'model' | 'middleware' | 'job';
  filename: string;
  language: 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'go';
  rawContent: string;
  detectedPatterns?: DetectedPattern[];
}

export interface AppContextInput {
  sqlArtifacts: SqlArtifact[];
  codeArtifacts: CodeArtifact[];
  metadata?: {
    framework?: string;
    orm?: string;
    dbEngine?: 'postgresql' | 'mysql' | 'mssql' | 'sqlite';
    trafficProfile?: 'read_heavy' | 'write_heavy' | 'balanced';
    description?: string;
  };
}
