// tests/unit/ingestion/sqlParser.test.ts

import {
  extractTables,
  extractIndexes,
  extractMigrations,
  extractSlowQueries,
  parseSql,
} from '../../../src/ingestion/sqlParser';
import * as fs from 'fs';
import * as path from 'path';

const sampleSql = fs.readFileSync(
  path.join(__dirname, '../../fixtures/sample.sql'),
  'utf8',
);

const sampleSlowQueriesJson = fs.readFileSync(
  path.join(__dirname, '../../fixtures/sample_slow_queries.json'),
  'utf8',
);

describe('extractTables', () => {
  it('extracts all 5 tables from the sample schema', () => {
    const tables = extractTables(sampleSql);
    expect(tables).toHaveLength(5);
    const names = tables.map((t) => t.name);
    expect(names).toContain('users');
    expect(names).toContain('products');
    expect(names).toContain('orders');
    expect(names).toContain('order_items');
    expect(names).toContain('audit_logs');
  });

  it('parses columns for the users table', () => {
    const tables = extractTables(sampleSql);
    const users = tables.find((t) => t.name === 'users');
    expect(users).toBeDefined();
    expect(users!.columns.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty array for empty SQL', () => {
    expect(extractTables('')).toEqual([]);
  });
});

describe('extractIndexes', () => {
  it('extracts indexes from the sample schema', () => {
    const indexes = extractIndexes(sampleSql);
    expect(indexes.length).toBeGreaterThanOrEqual(4);
  });

  it('marks unique indexes correctly', () => {
    const indexes = extractIndexes(sampleSql);
    const unique = indexes.filter((i) => i.isUnique);
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });

  it('captures table names', () => {
    const indexes = extractIndexes(sampleSql);
    const tables = indexes.map((i) => i.table);
    expect(tables).toContain('users');
  });
});

describe('extractMigrations', () => {
  it('returns empty array for schema-only SQL (no ALTER/DROP)', () => {
    const migrations = extractMigrations(sampleSql);
    expect(migrations).toEqual([]);
  });

  it('extracts ALTER TABLE statements', () => {
    const sql = 'ALTER TABLE users ADD COLUMN phone VARCHAR(20);';
    const migrations = extractMigrations(sql);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toContain('ALTER TABLE');
  });
});

describe('extractSlowQueries', () => {
  it('parses the sample slow-query JSON', () => {
    const entries = extractSlowQueries(sampleSlowQueriesJson);
    expect(entries).toHaveLength(3);
  });

  it('captures durationMs and query fields', () => {
    const entries = extractSlowQueries(sampleSlowQueriesJson);
    expect(entries[0].durationMs).toBe(3421);
    expect(entries[0].query).toContain('SELECT');
  });

  it('returns empty array for non-JSON SQL content', () => {
    const entries = extractSlowQueries(sampleSql);
    expect(entries).toEqual([]);
  });
});

describe('parseSql', () => {
  it('returns a complete SqlArtifact from a SQL file', () => {
    const artifact = parseSql({ filePath: 'sample.sql', content: sampleSql, type: 'sql' });
    expect(artifact.sourceFile).toBe('sample.sql');
    expect(artifact.tables.length).toBeGreaterThan(0);
    expect(artifact.indexes.length).toBeGreaterThan(0);
  });
});
