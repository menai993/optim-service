// src/types/ingestion.ts
// Shared types for the data ingestion layer

export interface RawInput {
  /** Absolute or relative path to the source file */
  filePath: string;
  /** File content as a UTF-8 string */
  content: string;
  /** Detected MIME / language type, e.g. "sql", "typescript", "json" */
  type: 'sql' | 'typescript' | 'javascript' | 'json' | 'unknown';
}

export interface SqlArtifact {
  /** Source file path this artifact was derived from */
  sourceFile: string;
  /** Extracted table definitions (DDL snippets) */
  tables: TableDefinition[];
  /** Extracted index definitions */
  indexes: IndexDefinition[];
  /** Migration statements, if any */
  migrations: string[];
  /** Raw slow-query log entries, if present */
  slowQueries: SlowQueryEntry[];
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  /** Raw DDL for the table */
  ddl: string;
}

export interface ColumnDefinition {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string };
}

export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  isUnique: boolean;
  /** Raw DDL */
  ddl: string;
}

export interface SlowQueryEntry {
  durationMs: number;
  query: string;
  explainOutput?: string;
}

export interface CodeArtifact {
  /** Source file path */
  sourceFile: string;
  /** Top-level exported symbols */
  exports: string[];
  /** Import statements */
  imports: ImportInfo[];
  /** Database query patterns found in the file */
  queryPatterns: QueryPattern[];
  /** Detected ORM calls */
  ormCalls: OrmCall[];
}

export interface ImportInfo {
  moduleSpecifier: string;
  importedNames: string[];
}

export interface QueryPattern {
  /** Approximate line number */
  line: number;
  /** Snippet of the pattern */
  snippet: string;
  /** Classification: n+1, missing-cache, raw-query, etc. */
  classification: string;
}

export interface OrmCall {
  line: number;
  callSite: string;
  /** ORM name: prisma, typeorm, sequelize, etc. */
  orm: string;
}

export interface AppContext {
  /** All SQL artifacts ingested */
  sqlArtifacts: SqlArtifact[];
  /** All code artifacts ingested */
  codeArtifacts: CodeArtifact[];
  /** Summary statistics */
  summary: {
    tableCount: number;
    slowQueryCount: number;
    codeFileCount: number;
  };
}
