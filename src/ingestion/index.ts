// src/ingestion/index.ts
// Re-exports all parser functions

export { parseSql, extractTables, extractIndexes, extractMigrations, extractSlowQueries } from './sqlParser';
export { parseCode, extractImports, extractExports, detectQueryPatterns, detectOrmCalls } from './codeParser';
export {
  parsePgStatStatements,
  parseSlowQueryLog,
  parseExplainOutput,
} from './metricsParser';
export type { QueryMetrics, ExplainNode } from './metricsParser';
