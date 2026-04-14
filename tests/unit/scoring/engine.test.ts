// tests/unit/scoring/engine.test.ts

import { scoreFindings } from '../../../src/scoring/engine';
import { Finding } from '../../../src/types/agents';

const makeFind = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'test-1',
  title: 'Test Finding',
  description: 'A test description',
  layer: 'query',
  ...overrides,
});

describe('scoreFindings', () => {
  it('returns an empty array for no input', () => {
    expect(scoreFindings([])).toEqual([]);
  });

  it('scores a single finding and returns one ScoredRecommendation', () => {
    const findings = [makeFind()];
    const scored = scoreFindings(findings);
    expect(scored).toHaveLength(1);
    expect(scored[0].effortScore).toBeGreaterThanOrEqual(1);
    expect(scored[0].impactScore).toBeGreaterThanOrEqual(1);
    expect(scored[0].priorityScore).toBeGreaterThanOrEqual(1);
  });

  it('sorts results by priorityScore descending', () => {
    const findings: Finding[] = [
      makeFind({ id: 'a', title: 'missing index', description: 'missing index on FK column', layer: 'index' }),
      makeFind({ id: 'b', title: 'minor issue', description: 'minor general issue', layer: 'general' }),
    ];
    const scored = scoreFindings(findings);
    expect(scored[0].priorityScore).toBeGreaterThanOrEqual(scored[1].priorityScore);
  });

  it('assigns higher impact to index findings than general findings', () => {
    const indexFinding = makeFind({ id: 'idx', title: 'missing index', description: 'add missing index on FK', layer: 'index' });
    const generalFinding = makeFind({ id: 'gen', title: 'general issue', description: 'general concern', layer: 'general' });

    const scored = scoreFindings([indexFinding, generalFinding]);
    const indexScored = scored.find((s) => s.finding.id === 'idx')!;
    const generalScored = scored.find((s) => s.finding.id === 'gen')!;

    expect(indexScored.impactScore).toBeGreaterThanOrEqual(generalScored.impactScore);
  });

  it('includes the original finding in each ScoredRecommendation', () => {
    const finding = makeFind({ id: 'orig', title: 'N+1 Query', description: 'n+1 pattern detected', layer: 'query' });
    const [scored] = scoreFindings([finding]);
    expect(scored.finding).toBe(finding);
  });

  it('includes a non-empty recommendation string', () => {
    const [scored] = scoreFindings([makeFind()]);
    expect(typeof scored.recommendation).toBe('string');
    expect(scored.recommendation.length).toBeGreaterThan(0);
  });
});
