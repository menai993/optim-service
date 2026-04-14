// src/agents/contextBuilder.ts
// Builds an AppContext from all ingested artifacts

import { SqlArtifact, CodeArtifact, AppContext } from '../types/ingestion';

/**
 * Combine all ingested SQL and code artifacts into a unified AppContext
 * that agents can query.
 */
export function buildAppContext(
  sqlArtifacts: SqlArtifact[],
  codeArtifacts: CodeArtifact[],
): AppContext {
  const tableCount = sqlArtifacts.reduce((sum, a) => sum + a.tables.length, 0);
  const slowQueryCount = sqlArtifacts.reduce((sum, a) => sum + a.slowQueries.length, 0);

  return {
    sqlArtifacts,
    codeArtifacts,
    summary: {
      tableCount,
      slowQueryCount,
      codeFileCount: codeArtifacts.length,
    },
  };
}
