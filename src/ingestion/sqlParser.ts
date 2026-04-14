// src/ingestion/sqlParser.ts
// Parses SQL schema files, migration files, slow-query logs, and explain plans

import {
  SqlArtifact,
  TableDefinition,
  ColumnDefinition,
  ForeignKeyDefinition,
  IndexDefinition,
  SlowQuery,
} from '../types/ingestion';

/**
 * Detect artifact type from filename pattern.
 */
function detectSqlArtifactType(filename: string): SqlArtifact['type'] {
  const lower = filename.toLowerCase();
  if (lower.includes('.migration.') || lower.includes('migrate')) return 'migration';
  if (lower.includes('index_list') || lower.includes('indexes')) return 'index_list';
  if (lower.includes('schema')) return 'schema';
  // Content-based detection is handled in parseSqlFile after reading
  return 'schema';
}

/**
 * Parse a SQL file into a structured SqlArtifact.
 */
export function parseSqlFile(filename: string, content: string): SqlArtifact {
  // Content-based type detection overrides filename heuristics
  let type = detectSqlArtifactType(filename);

  const isSlowQueryLog =
    /duration:\s*\d+(\.\d+)?ms/im.test(content) ||
    /Query_time:\s*\d/im.test(content);

  const isExplainPlan =
    /^\s*EXPLAIN/im.test(content) ||
    /Seq Scan|Index Scan/i.test(content);

  if (isSlowQueryLog) type = 'slow_query_log';
  else if (isExplainPlan && !content.match(/CREATE\s+TABLE/i)) type = 'explain_plan';

  const artifact: SqlArtifact = {
    type,
    filename,
    rawContent: content,
  };

  if (type === 'explain_plan') {
    // Store raw; no further structured parsing
    return artifact;
  }

  if (type === 'slow_query_log') {
    artifact.slowQueries = parseSlowQueryLogContent(content);
    return artifact;
  }

  // For schema / migration / index_list, parse DDL
  const tables = extractTables(content);
  if (tables.length > 0) artifact.parsedTables = tables;

  const indexes = extractIndexes(content);
  if (indexes.length > 0) artifact.parsedIndexes = indexes;

  return artifact;
}

/**
 * Parse slow-query log lines (MySQL / pg style) into SlowQuery[].
 */
function parseSlowQueryLogContent(content: string): SlowQuery[] {
  const results: SlowQuery[] = [];

  // Pattern: "duration: Xms" style (pg)
  const pgPattern = /duration:\s*([\d.]+)ms\s*(?:.*?)\n\s*(.+)/gim;
  let match: RegExpExecArray | null;
  while ((match = pgPattern.exec(content)) !== null) {
    results.push({
      duration_ms: parseFloat(match[1]),
      query: match[2].trim(),
      calls: 1,
    });
  }

  // Pattern: "Query_time: X" style (MySQL slow log)
  const mysqlPattern = /Query_time:\s*([\d.]+)/gim;
  const queryAfterMysql = /(?:Query_time:[^\n]*\n)+\s*(.+?)(?:;|$)/gim;
  if (results.length === 0) {
    while ((match = mysqlPattern.exec(content)) !== null) {
      const durationSec = parseFloat(match[1]);
      const queryMatch = queryAfterMysql.exec(content);
      results.push({
        duration_ms: durationSec * 1000,
        query: queryMatch ? queryMatch[1].trim() : '',
        calls: 1,
      });
    }
  }

  return results;
}

/**
 * Extract CREATE TABLE definitions from SQL content.
 */
export function extractTables(sql: string): TableDefinition[] {
  const results: TableDefinition[] = [];
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([^;]+)\)/gim;

  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];

    const { columns, primaryKey, foreignKeys } = parseTableBody(body, tableName);

    results.push({
      name: tableName,
      columns,
      primaryKey,
      foreignKeys,
    });
  }

  return results;
}

/**
 * Parse the body of a CREATE TABLE to extract columns, PK, and FK constraints.
 */
function parseTableBody(
  body: string,
  _tableName: string,
): {
  columns: ColumnDefinition[];
  primaryKey: string[];
  foreignKeys: ForeignKeyDefinition[];
} {
  const columns: ColumnDefinition[] = [];
  const primaryKey: string[] = [];
  const foreignKeys: ForeignKeyDefinition[] = [];

  // Split on commas that are not inside parentheses
  const parts = splitOnTopLevelCommas(body);

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;

    // Standalone PRIMARY KEY constraint
    const pkMatch = /^PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(part);
    if (pkMatch) {
      pkMatch[1].split(',').forEach((c) => primaryKey.push(c.trim().replace(/["'`]/g, '')));
      continue;
    }

    // Standalone FOREIGN KEY constraint
    const fkMatch =
      /^(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["'`]?(\w+)["'`]?\s*\(([^)]+)\)/i.exec(
        part,
      );
    if (fkMatch) {
      foreignKeys.push({
        column: fkMatch[1].trim().replace(/["'`]/g, ''),
        referencesTable: fkMatch[2],
        referencesColumn: fkMatch[3].trim().replace(/["'`]/g, ''),
      });
      continue;
    }

    // Skip other constraints
    if (/^(UNIQUE|CONSTRAINT|CHECK|INDEX|EXCLUDE)/i.test(part)) continue;

    // Column definition
    const tokens = part.split(/\s+/);
    const colName = tokens[0].replace(/["'`]/g, '');
    const colType = tokens[1] ?? 'unknown';
    const nullable = !/NOT\s+NULL/i.test(part);
    const isInlinePK = /PRIMARY\s+KEY/i.test(part);

    if (isInlinePK) {
      primaryKey.push(colName);
    }

    // Inline REFERENCES (FK)
    const inlineFkMatch =
      /REFERENCES\s+["'`]?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)/i.exec(part);
    if (inlineFkMatch) {
      foreignKeys.push({
        column: colName,
        referencesTable: inlineFkMatch[1],
        referencesColumn: inlineFkMatch[2],
      });
    }

    columns.push({
      name: colName,
      type: colType,
      nullable,
      hasIndex: false, // will be updated after index parsing
    });
  }

  return { columns, primaryKey, foreignKeys };
}

/**
 * Split a string on commas, but not commas inside parentheses.
 */
function splitOnTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Extract CREATE INDEX definitions from SQL content.
 */
export function extractIndexes(sql: string): IndexDefinition[] {
  const results: IndexDefinition[] = [];
  const indexRegex =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s+ON\s+["'`]?(\w+)["'`]?\s*(?:USING\s+(\w+)\s*)?\(([^)]+)\)/gim;

  let match: RegExpExecArray | null;
  while ((match = indexRegex.exec(sql)) !== null) {
    const isUnique = Boolean(match[1]);
    const indexName = match[2];
    const tableName = match[3];
    const indexType = match[4] ?? 'btree';
    const columnList = match[5]
      .split(',')
      .map((c) => c.trim().replace(/["'`]/g, ''));

    results.push({
      name: indexName,
      table: tableName,
      columns: columnList,
      type: indexType,
      isUnique,
    });
  }

  return results;
}

/**
 * Enrich columns with hasIndex based on parsed indexes.
 */
export function enrichColumnsWithIndexInfo(
  tables: TableDefinition[],
  indexes: IndexDefinition[],
): void {
  const indexedCols = new Set<string>();
  for (const idx of indexes) {
    for (const col of idx.columns) {
      indexedCols.add(`${idx.table}.${col}`);
    }
  }
  for (const table of tables) {
    for (const col of table.columns) {
      if (indexedCols.has(`${table.name}.${col.name}`)) {
        col.hasIndex = true;
      }
    }
    // PK columns are implicitly indexed
    for (const pkCol of table.primaryKey) {
      const col = table.columns.find((c) => c.name === pkCol);
      if (col) col.hasIndex = true;
    }
  }
}
