// tests/integration/pipeline.test.ts
// Integration test for the full pipeline (mocked Anthropic client)

import { runPipeline } from '../../src/pipeline';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK so tests do not make real network calls
// ---------------------------------------------------------------------------

jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            id: 'mock-1',
            title: 'Missing index on orders.user_id',
            description: 'The orders table has a foreign key to users but no backing index, causing sequential scans.',
            layer: 'index',
          },
          {
            id: 'mock-2',
            title: 'N+1 query in getOrdersWithItems',
            description: 'Items are fetched one-by-one inside a loop.',
            layer: 'query',
          },
        ]),
      },
    ],
  });

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// ---------------------------------------------------------------------------

describe('runPipeline (integration)', () => {
  const client = new Anthropic({ apiKey: 'test-key' });

  const sqlFile = {
    filePath: 'schema.sql',
    content: `
      CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);
      CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));
    `,
    type: 'sql' as const,
  };

  const codeFile = {
    filePath: 'service.ts',
    content: `
      import { prisma } from './db';
      export async function getOrders(userId: number) {
        const orders = await prisma.orders.findMany({ where: { user_id: userId } });
        for (const order of orders) {
          const items = await prisma.order_items.findMany({ where: { order_id: order.id } });
        }
        return orders;
      }
    `,
    type: 'typescript' as const,
  };

  it('runs without throwing and returns a report', async () => {
    const report = await runPipeline(client, [sqlFile, codeFile], { rounds: 1, title: 'Test Report' });
    expect(report).toBeDefined();
    expect(report.title).toBe('Test Report');
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it('returns a non-empty summary', async () => {
    const report = await runPipeline(client, [sqlFile, codeFile], { rounds: 1 });
    expect(typeof report.summary).toBe('string');
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('attaches markdown and JSON formats', async () => {
    const report = await runPipeline(client, [sqlFile, codeFile], { rounds: 1 });
    expect(typeof report.markdown).toBe('string');
    expect(typeof report.json).toBe('string');
    expect(report.markdown).toContain('#');
  });

  it('handles a JSON slow-query log file', async () => {
    const jsonFile = {
      filePath: 'slow_queries.json',
      content: JSON.stringify([
        { duration_ms: 1000, query: 'SELECT * FROM orders' },
      ]),
      type: 'json' as const,
    };
    const report = await runPipeline(client, [jsonFile], { rounds: 1 });
    expect(report).toBeDefined();
  });
});
