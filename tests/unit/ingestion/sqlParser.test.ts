// tests/unit/ingestion/sqlParser.test.ts

import {
  parseSqlFile,
  extractTables,
  extractIndexes,
  enrichColumnsWithIndexInfo,
} from '../../../src/ingestion/sqlParser';
import * as fs from 'fs';
import * as path from 'path';

const sampleSql = fs.readFileSync(
  path.join(__dirname, '../../fixtures/sample.sql'),
  'utf8',
);

describe('extractTables', () => {
  it('extracts all 5 tables from the sample schema', () => {
    const tables = extractTables(sampleSql);
    expect(tables).toHaveLength(5);
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['users', 'products', 'orders', 'order_items', 'audit_logs']),
    );
  });

  it('parses columns with correct types and nullability for the users table', () => {
    const tables = extractTables(sampleSql);
    const users = tables.find((t) => t.name === 'users')!;
    expect(users.columns.length).toBeGreaterThanOrEqual(4);

    const email = users.columns.find((c) => c.name === 'email')!;
    expect(email.type).toMatch(/VARCHAR/i);
    expect(email.nullable).toBe(false);

    const description = tables
      .find((t) => t.name === 'products')!
      .columns.find((c) => c.name === 'description');
    expect(description).toBeDefined();
    expect(description!.nullable).toBe(true);
  });

  it('extracts inline PRIMARY KEY from column definitions', () => {
    const tables = extractTables(sampleSql);
    const users = tables.find((t) => t.name === 'users')!;
    expect(users.primaryKey).toContain('id');
  });

  it('extracts inline FOREIGN KEY references', () => {
    const tables = extractTables(sampleSql);
    const orders = tables.find((t) => t.name === 'orders')!;
    expect(orders.foreignKeys.length).toBeGreaterThanOrEqual(1);
    const fk = orders.foreignKeys.find((f) => f.column === 'user_id')!;
    expect(fk.referencesTable).toBe('users');
    expect(fk.referencesColumn).toBe('id');
  });

  it('returns empty array for empty SQL', () => {
    expect(extractTables('')).toEqual([]);
  });

  it('handles malformed SQL without crashing', () => {
    expect(extractTables('CREATE TABLE foo (')).toEqual([]);
    expect(extractTables('NOT VALID SQL AT ALL')).toEqual([]);
  });
});

describe('extractIndexes', () => {
  it('extracts all indexes from the sample schema', () => {
    const indexes = extractIndexes(sampleSql);
    expect(indexes.length).toBeGreaterThanOrEqual(6);
  });

  it('marks unique indexes correctly', () => {
    const indexes = extractIndexes(sampleSql);
    const unique = indexes.filter((i) => i.isUnique);
    expect(unique.length).toBeGreaterThanOrEqual(2);
    const names = unique.map((i) => i.name);
    expect(names).toContain('idx_users_email');
    expect(names).toContain('idx_users_username');
  });

  it('captures table and column names', () => {
    const indexes = extractIndexes(sampleSql);
    const idx = indexes.find((i) => i.name === 'idx_products_name')!;
    expect(idx.table).toBe('products');
    expect(idx.columns).toEqual(['name']);
  });

  it('defaults index type to btree when USING is not specified', () => {
    const indexes = extractIndexes(sampleSql);
    for (const idx of indexes) {
      expect(idx.type).toBe('btree');
    }
  });

  it('parses USING clause for index type', () => {
    const sql = 'CREATE INDEX idx_foo ON bar USING hash (col1);';
    const indexes = extractIndexes(sql);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].type).toBe('hash');
  });

  it('returns empty array for content with no indexes', () => {
    expect(extractIndexes('SELECT 1;')).toEqual([]);
  });
});

describe('enrichColumnsWithIndexInfo', () => {
  it('sets hasIndex for indexed columns', () => {
    const tables = extractTables(sampleSql);
    const indexes = extractIndexes(sampleSql);
    enrichColumnsWithIndexInfo(tables, indexes);

    const users = tables.find((t) => t.name === 'users')!;
    const email = users.columns.find((c) => c.name === 'email')!;
    expect(email.hasIndex).toBe(true);

    // PK columns should also be marked
    const id = users.columns.find((c) => c.name === 'id')!;
    expect(id.hasIndex).toBe(true);
  });
});

describe('parseSqlFile', () => {
  it('detects schema type from filename', () => {
    const artifact = parseSqlFile('db_schema.sql', sampleSql);
    expect(artifact.type).toBe('schema');
    expect(artifact.filename).toBe('db_schema.sql');
    expect(artifact.rawContent).toBe(sampleSql);
    expect(artifact.parsedTables!.length).toBeGreaterThan(0);
    expect(artifact.parsedIndexes!.length).toBeGreaterThan(0);
  });

  it('detects migration type from filename', () => {
    const artifact = parseSqlFile('001_add_users.migration.sql', 'ALTER TABLE users ADD COLUMN phone VARCHAR(20);');
    expect(artifact.type).toBe('migration');
  });

  it('detects slow_query_log type from content', () => {
    const content = 'duration: 342ms\nSELECT * FROM users;\nduration: 100ms\nSELECT 1;';
    const artifact = parseSqlFile('queries.sql', content);
    expect(artifact.type).toBe('slow_query_log');
    expect(artifact.slowQueries).toBeDefined();
    expect(artifact.slowQueries!.length).toBeGreaterThan(0);
  });

  it('detects explain_plan type from content', () => {
    const content = 'EXPLAIN ANALYZE SELECT * FROM users;\nSeq Scan on users  (cost=0.00..1.01 rows=1 width=32)';
    const artifact = parseSqlFile('plan.sql', content);
    expect(artifact.type).toBe('explain_plan');
  });

  it('returns valid SqlArtifact for empty SQL', () => {
    const artifact = parseSqlFile('empty.sql', '');
    expect(artifact.type).toBe('schema');
    expect(artifact.parsedTables).toBeUndefined();
    expect(artifact.parsedIndexes).toBeUndefined();
  });

  it('handles a file with only Index Scan notation as explain_plan', () => {
    const content = 'Index Scan using idx_users_email on users (cost=0.28..8.29 rows=1 width=64)';
    const artifact = parseSqlFile('output.sql', content);
    expect(artifact.type).toBe('explain_plan');
  });
});
