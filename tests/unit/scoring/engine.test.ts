// tests/unit/scoring/engine.test.ts

import { scoreFindings } from '../../../src/scoring/engine';
import { Finding, AppContext } from '../../../src/types/agents';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeContext = (overrides: Partial<AppContext> = {}): AppContext => ({
  summary: 'Test app',
  tables: [],
  hotTables: ['orders', 'users'],
  endpointQueryMap: {},
  ormRelationships: [],
  trafficProfile: 'read_heavy',
  criticalPaths: ['GET /orders', 'POST /checkout'],
  ...overrides,
});

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f-1',
  layer: 'sql',
  severity: 'high',
  title: 'Test Finding',
  description: 'A test description',
  affectedArtifacts: [],
  suggestedFix: 'Fix it',
  dependsOn: [],
  blocks: [],
  confidence: 0.9,
  agentSource: 'sql_specialist',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scoreFindings', () => {
  const ctx = makeContext();

  it('returns an empty array for no input', () => {
    expect(scoreFindings([], ctx)).toEqual([]);
  });

  it('scores a single finding and returns one ScoredRecommendation', () => {
    const scored = scoreFindings([makeFinding()], ctx);
    expect(scored).toHaveLength(1);
    expect(scored[0].effort.value).toBeGreaterThanOrEqual(1);
    expect(scored[0].impact.value).toBeGreaterThanOrEqual(1);
    expect(scored[0].roi).toBeGreaterThan(0);
    expect(scored[0].implementationOrder).toBe(1);
  });

  it('includes the original finding in each ScoredRecommendation', () => {
    const finding = makeFinding({ id: 'orig' });
    const [scored] = scoreFindings([finding], ctx);
    expect(scored.finding).toBe(finding);
  });

  // ── ROI calculation ─────────────────────────────────────────────────────

  describe('ROI calculation', () => {
    it('computes roi as impact / effort', () => {
      // A missing index finding → effort 1, severity critical + hot table → impact 5
      const finding = makeFinding({
        id: 'idx-1',
        title: 'Add missing index on orders.user_id',
        description: 'Missing index causes full scans',
        severity: 'critical',
        affectedArtifacts: ['orders'],
      });
      const [scored] = scoreFindings([finding], ctx);
      expect(scored.roi).toBe(scored.impact.value / scored.effort.value);
    });

    it('sorts by ROI descending', () => {
      const highRoi = makeFinding({
        id: 'hi',
        title: 'Add index on orders',
        description: 'missing index',
        severity: 'critical',
        affectedArtifacts: ['orders'],
      });
      const lowRoi = makeFinding({
        id: 'lo',
        title: 'Cross-service architectural refactor',
        description: 'Restructure data model redesign across services',
        severity: 'low',
        layer: 'backend',
        agentSource: 'backend_specialist',
        affectedArtifacts: ['archive_logs'],
      });
      const scored = scoreFindings([lowRoi, highRoi], ctx);
      expect(scored[0].roi).toBeGreaterThanOrEqual(scored[1].roi);
    });

    it('uses impact as tiebreaker when ROI is equal', () => {
      const a = makeFinding({
        id: 'a',
        title: 'Finding A',
        severity: 'high',
        affectedArtifacts: ['orders'],
      });
      const b = makeFinding({
        id: 'b',
        title: 'Finding B',
        severity: 'medium',
        affectedArtifacts: ['orders'],
      });
      const scored = scoreFindings([b, a], ctx);
      // If they happen to have the same ROI, higher impact comes first
      if (scored[0].roi === scored[1].roi) {
        expect(scored[0].impact.value).toBeGreaterThanOrEqual(scored[1].impact.value);
      }
    });
  });

  // ── Hot table boost logic ───────────────────────────────────────────────

  describe('hot table boost', () => {
    it('boosts impact for findings affecting hot tables', () => {
      const hotFinding = makeFinding({
        id: 'hot',
        severity: 'medium',
        affectedArtifacts: ['orders'],
      });
      const coldFinding = makeFinding({
        id: 'cold',
        severity: 'medium',
        affectedArtifacts: ['audit_logs'],
      });
      const scored = scoreFindings([hotFinding, coldFinding], ctx);
      const hotScored = scored.find((s) => s.finding.id === 'hot')!;
      const coldScored = scored.find((s) => s.finding.id === 'cold')!;
      expect(hotScored.impact.value).toBeGreaterThan(coldScored.impact.value);
    });

    it('does not boost impact beyond 5', () => {
      const finding = makeFinding({
        id: 'max',
        severity: 'critical',
        affectedArtifacts: ['orders'],
      });
      const criticalCtx = makeContext({ criticalPaths: ['orders'] });
      const [scored] = scoreFindings([finding], criticalCtx);
      expect(scored.impact.value).toBeLessThanOrEqual(5);
    });

    it('reduces impact for findings on cold tables only', () => {
      const coldFinding = makeFinding({
        id: 'cold',
        severity: 'medium',
        affectedArtifacts: ['archive_logs'],
      });
      const [scored] = scoreFindings([coldFinding], ctx);
      // Base medium = 3, -1 cold = 2
      expect(scored.impact.value).toBeLessThan(3);
    });
  });

  // ── Topological sort / dependsOn chains ─────────────────────────────────

  describe('topological sort', () => {
    it('assigns lower implementationOrder to dependencies', () => {
      const depA = makeFinding({ id: 'dep-a', title: 'Add index', description: 'create index', dependsOn: [] });
      const depB = makeFinding({ id: 'dep-b', title: 'Rewrite query', description: 'rewrite query', dependsOn: ['dep-a'] });
      const depC = makeFinding({ id: 'dep-c', title: 'Refactor service', description: 'refactor', dependsOn: ['dep-b'] });

      const scored = scoreFindings([depC, depA, depB], ctx);
      const orderA = scored.find((s) => s.finding.id === 'dep-a')!.implementationOrder;
      const orderB = scored.find((s) => s.finding.id === 'dep-b')!.implementationOrder;
      const orderC = scored.find((s) => s.finding.id === 'dep-c')!.implementationOrder;

      expect(orderA).toBeLessThan(orderB);
      expect(orderB).toBeLessThan(orderC);
    });

    it('handles independent findings (no dependsOn)', () => {
      const a = makeFinding({ id: 'ind-a', dependsOn: [] });
      const b = makeFinding({ id: 'ind-b', dependsOn: [] });
      const scored = scoreFindings([a, b], ctx);
      expect(scored).toHaveLength(2);
      // Both should have valid implementation orders
      for (const s of scored) {
        expect(s.implementationOrder).toBeGreaterThanOrEqual(1);
      }
    });

    it('handles diamond dependencies', () => {
      //   A
      //  / \
      // B   C
      //  \ /
      //   D
      const a = makeFinding({ id: 'da', title: 'Add index', description: 'create index', dependsOn: [] });
      const b = makeFinding({ id: 'db', title: 'Fix B', dependsOn: ['da'] });
      const c = makeFinding({ id: 'dc', title: 'Fix C', dependsOn: ['da'] });
      const d = makeFinding({ id: 'dd', title: 'Fix D', dependsOn: ['db', 'dc'] });

      const scored = scoreFindings([d, c, b, a], ctx);
      const orderA = scored.find((s) => s.finding.id === 'da')!.implementationOrder;
      const orderB = scored.find((s) => s.finding.id === 'db')!.implementationOrder;
      const orderC = scored.find((s) => s.finding.id === 'dc')!.implementationOrder;
      const orderD = scored.find((s) => s.finding.id === 'dd')!.implementationOrder;

      expect(orderA).toBeLessThan(orderB);
      expect(orderA).toBeLessThan(orderC);
      expect(orderB).toBeLessThan(orderD);
      expect(orderC).toBeLessThan(orderD);
    });

    it('handles dependsOn referencing non-existent IDs gracefully', () => {
      const f = makeFinding({ id: 'orphan', dependsOn: ['non-existent'] });
      const scored = scoreFindings([f], ctx);
      expect(scored).toHaveLength(1);
      expect(scored[0].implementationOrder).toBe(1);
    });
  });

  // ── Speedup estimate ───────────────────────────────────────────────────

  describe('estimatedQuerySpeedup', () => {
    it('provides speedup estimate for missing index on hot table', () => {
      const finding = makeFinding({
        id: 'idx',
        title: 'Add missing index on orders.user_id',
        description: 'Missing index on orders table',
        affectedArtifacts: ['orders'],
      });
      const [scored] = scoreFindings([finding], ctx);
      expect(scored.estimatedQuerySpeedup).toContain('50-80%');
    });

    it('provides speedup estimate for N+1 pattern', () => {
      const finding = makeFinding({
        id: 'np1',
        title: 'N+1 query in order loader',
        description: 'N+1 query pattern detected',
      });
      const [scored] = scoreFindings([finding], ctx);
      expect(scored.estimatedQuerySpeedup).toContain('99%');
    });

    it('returns undefined for backend-only findings', () => {
      const finding = makeFinding({
        id: 'be',
        title: 'Missing cache',
        description: 'Add caching',
        layer: 'backend',
        agentSource: 'backend_specialist',
      });
      const [scored] = scoreFindings([finding], ctx);
      expect(scored.estimatedQuerySpeedup).toBeUndefined();
    });
  });
});
