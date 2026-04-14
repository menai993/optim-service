// src/ingestion/sqlParser.ts
// Parses SQL schema files, migration files, and slow-query logs

import { RawInput, SqlArtifact, TableDefinition, IndexDefinition, SlowQueryEntry } from '../types/ingestion';

/**
 * Parse a raw SQL input (schema, migration, or slow-query log) into a
 * structured SqlArtifact.
 */
export function parseSql(input: RawInput): SqlArtifact {
  const tables = extractTables(input.content);
  const indexes = extractIndexes(input.content);
  const migrations = extractMigrations(input.content);
  const slowQueries = extractSlowQueries(input.content);

  return {
    sourceFile: input.filePath,
    tables,
    indexes,
    migrations,
    slowQueries,
  };
}

/**
 * Extract CREATE TABLE definitions from SQL content.
 */
export function extractTables(sql: string): TableDefinition[] {
  const results: TableDefinition[] = [];
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(([^;]+)\)/gim;

  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const ddl = match[0];

    results.push({
      name: tableName,
      columns: extractColumns(body),
      ddl,
    });
  }

  return results;
}

/**
 * Parse column definitions from the body of a CREATE TABLE statement.
 */
function extractColumns(body: string) {
  return body
    .split(',')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|INDEX|CHECK)/i.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      const name = parts[0].replace(/["'`]/g, '');
      const dataType = parts[1] ?? 'unknown';
      const nullable = !/NOT\s+NULL/i.test(line);
      const isPrimaryKey = /PRIMARY\s+KEY/i.test(line);
      const isForeignKey = /REFERENCES/i.test(line);

      let references: { table: string; column: string } | undefined;
      if (isForeignKey) {
        const refMatch = /REFERENCES\s+["']?(\w+)["']?\s*\(\s*["']?(\w+)["']?\s*\)/i.exec(line);
        if (refMatch) {
          references = { table: refMatch[1], column: refMatch[2] };
        }
      }

      return { name, dataType, nullable, isPrimaryKey, isForeignKey, references };
    });
}

/**
 * Extract CREATE INDEX definitions from SQL content.
 */
export function extractIndexes(sql: string): IndexDefinition[] {
  const results: IndexDefinition[] = [];
  const indexRegex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s+ON\s+["']?(\w+)["']?\s*\(([^)]+)\)/gim;

  let match: RegExpExecArray | null;
  while ((match = indexRegex.exec(sql)) !== null) {
    const isUnique = Boolean(match[1]);
    const indexName = match[2];
    const tableName = match[3];
    const columnList = match[4]
      .split(',')
      .map((c) => c.trim().replace(/["'`]/g, ''));

    results.push({
      name: indexName,
      table: tableName,
      columns: columnList,
      isUnique,
      ddl: match[0],
    });
  }

  return results;
}

/**
 * Extract migration statements (ALTER TABLE, DROP, etc.).
 */
export function extractMigrations(sql: string): string[] {
  const migrationRegex = /^\s*(ALTER\s+TABLE|DROP\s+TABLE|RENAME\s+TABLE)[^;]+;/gim;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = migrationRegex.exec(sql)) !== null) {
    results.push(match[0].trim());
  }
  return results;
}

/**
 * Extract slow query entries from a JSON slow-query log embedded in the SQL
 * file content, or return an empty array if none are found.
 */
export function extractSlowQueries(content: string): SlowQueryEntry[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((entry: Record<string, unknown>) => ({
        durationMs: Number(entry['duration_ms'] ?? entry['durationMs'] ?? 0),
        query: String(entry['query'] ?? ''),
        explainOutput: entry['explain'] != null ? String(entry['explain']) : undefined,
      }));
    }
  } catch {
    // Not JSON — not a slow-query log file
  }
  return [];
}
