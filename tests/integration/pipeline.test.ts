// tests/integration/pipeline.test.ts
// Integration test for the full pipeline (mocked Anthropic SDK)

import { runAnalysisPipeline } from '../../src/pipeline';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK so tests do not make real network calls.
// The mock must simulate 4 separate LLM calls:
//   1. buildContext (returns AppContext JSON)
//   2. runSqlSpecialist (returns Finding[] JSON)
//   3. runBackendSpecialist (returns Finding[] JSON)
//   4+ Discussion/orchestrator calls
// ---------------------------------------------------------------------------

const mockAppContext = {
  summary: 'E-commerce app with orders and users',
  tables: [
    { name: 'users', columns: [], primaryKey: ['id'], foreignKeys: [] },
    { name: 'orders', columns: [], primaryKey: ['id'], foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }] },
  ],
  hotTables: ['orders', 'users'],
  endpointQueryMap: { 'getOrders': ['SELECT orders WHERE user_id = ?'] },
  ormRelationships: [],
  trafficProfile: 'read_heavy',
  criticalPaths: ['getOrders'],
};

const mockSqlFindings = [
  {
    id: 'sql-1',
    layer: 'sql',
    severity: 'critical',
    title: 'Missing index on orders.user_id',
    description: 'The orders table has a foreign key to users but no backing index.',
    affectedArtifacts: ['orders'],
    suggestedFix: 'CREATE INDEX idx_orders_user_id ON orders(user_id);',
    sqlExample: 'CREATE INDEX idx_orders_user_id ON orders(user_id);',
    dependsOn: [],
    blocks: [],
    confidence: 0.95,
    agentSource: 'sql_specialist',
  },
];

const mockBackendFindings = [
  {
    id: 'be-1',
    layer: 'backend',
    severity: 'high',
    title: 'N+1 query in getOrders',
    description: 'Items are fetched one-by-one inside a loop.',
    affectedArtifacts: ['service.ts'],
    suggestedFix: 'Use include/eager loading.',
    codeExample: 'prisma.orders.findMany({ include: { items: true } })',
    dependsOn: [],
    blocks: [],
    confidence: 0.9,
    agentSource: 'backend_specialist',
  },
];

const mockReaction = {
  agreements: [],
  conflicts: [],
  additionalFindings: [],
};

const mockResolution = { resolutions: [] };

// All findings merged by orchestrator
const mockOrchestratorOutput = [...mockSqlFindings, ...mockBackendFindings];

let callIndex = 0;

jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockImplementation(() => {
    const idx = callIndex++;
    let data: unknown;
    switch (idx) {
      case 0: data = mockAppContext; break;          // buildContext
      case 1: data = mockSqlFindings; break;         // sqlSpecialist
      case 2: data = mockBackendFindings; break;     // backendSpecialist
      case 3: data = mockReaction; break;            // discussion reaction (sql)
      case 4: data = mockReaction; break;            // discussion reaction (backend)
      case 5: data = mockResolution; break;          // discussion resolution (sql)
      case 6: data = mockResolution; break;          // discussion resolution (backend)
      default: data = mockOrchestratorOutput; break; // orchestrator
    }
    return Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    });
  });

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// ---------------------------------------------------------------------------

describe('runAnalysisPipeline (integration)', () => {
  beforeEach(() => {
    callIndex = 0;
  });

  const sqlFile = {
    filename: 'schema.sql',
    content: `
      CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);
      CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));
    `,
  };

  const codeFile = {
    filename: 'service.ts',
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
  };

  it('runs without throwing and returns a report', async () => {
    const report = await runAnalysisPipeline([sqlFile, codeFile], { mode: 'combined', discussionRounds: 2 });
    expect(report).toBeDefined();
    expect(report.id).toBeDefined();
    expect(report.mode).toBe('combined');
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it('returns totalFindings and criticalFindings counts', async () => {
    const report = await runAnalysisPipeline([sqlFile, codeFile]);
    expect(report.totalFindings).toBeGreaterThanOrEqual(0);
    expect(typeof report.criticalFindings).toBe('number');
  });

  it('returns a generated timestamp', async () => {
    const report = await runAnalysisPipeline([sqlFile, codeFile]);
    expect(report.generatedAt).toBeDefined();
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  it('includes discussion rounds', async () => {
    const report = await runAnalysisPipeline([sqlFile, codeFile], { discussionRounds: 2 });
    expect(Array.isArray(report.discussionRounds)).toBe(true);
  });

  it('handles sql_only mode correctly', async () => {
    const report = await runAnalysisPipeline([sqlFile], { mode: 'sql_only' });
    for (const rec of report.recommendations) {
      expect(['sql', 'both']).toContain(rec.finding.layer);
    }
  });
});
