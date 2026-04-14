// src/ingestion/index.ts
// Top-level ingestion entry point and re-exports

import { AppContextInput, SqlArtifact, CodeArtifact } from '../types/ingestion';
import { parseSqlFile, enrichColumnsWithIndexInfo } from './sqlParser';
import { parseCodeFile } from './codeParser';
import { parseMetricsJson } from './metricsParser';

export { parseSqlFile, extractTables, extractIndexes, enrichColumnsWithIndexInfo } from './sqlParser';
export { parseCodeFile, detectPatterns } from './codeParser';
export { parseMetricsJson } from './metricsParser';

/** Extensions recognized as SQL files */
const SQL_EXTENSIONS = new Set(['.sql']);

/** Extensions recognized as code files */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.cs', '.java', '.go']);

/** Extensions recognized as JSON metrics */
const JSON_EXTENSIONS = new Set(['.json']);

/**
 * Route each input file to the right parser and aggregate results into an AppContextInput.
 */
export async function ingestFiles(
  files: Array<{ filename: string; content: string }>,
): Promise<AppContextInput> {
  const sqlArtifacts: SqlArtifact[] = [];
  const codeArtifacts: CodeArtifact[] = [];

  for (const file of files) {
    const ext = file.filename.slice(file.filename.lastIndexOf('.')).toLowerCase();

    if (SQL_EXTENSIONS.has(ext)) {
      const artifact = parseSqlFile(file.filename, file.content);
      if (artifact.parsedTables && artifact.parsedIndexes) {
        enrichColumnsWithIndexInfo(artifact.parsedTables, artifact.parsedIndexes);
      }
      sqlArtifacts.push(artifact);
    } else if (CODE_EXTENSIONS.has(ext)) {
      codeArtifacts.push(parseCodeFile(file.filename, file.content));
    } else if (JSON_EXTENSIONS.has(ext)) {
      // Attempt to parse as metrics JSON → produce a slow_query_log SqlArtifact
      try {
        const parsed = JSON.parse(file.content);
        const slowQueries = parseMetricsJson(parsed);
        if (slowQueries.length > 0) {
          sqlArtifacts.push({
            type: 'slow_query_log',
            filename: file.filename,
            rawContent: file.content,
            slowQueries,
          });
        }
      } catch {
        // Not valid metrics JSON — skip
      }
    }
  }

  return {
    sqlArtifacts,
    codeArtifacts,
  };
}
