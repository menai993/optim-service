// src/scoring/engine.ts
// Scores findings by effort and impact, returns ScoredRecommendation[]

import { Finding, AppContext } from '../types/agents';
import { ScoredRecommendation } from '../types/scoring';
import { scoreEffort, scoreImpact } from './rubric';

// ── Speedup heuristics ────────────────────────────────────────────────────────

function estimateQuerySpeedup(finding: Finding, context: AppContext): string | undefined {
  if (finding.layer !== 'sql' && finding.layer !== 'both') return undefined;

  const text = `${finding.title} ${finding.description} ${finding.suggestedFix}`.toLowerCase();
  const hitsHotTable = finding.affectedArtifacts.some((a) =>
    context.hotTables.some((ht) => a.toLowerCase().includes(ht.toLowerCase())),
  );

  if ((text.includes('missing index') || text.includes('add index') || text.includes('create index')) && hitsHotTable) {
    return '50-80% query time reduction';
  }
  if (text.includes('n+1') || text.includes('n + 1')) {
    return '~99% reduction in query count for this operation';
  }
  if (text.includes('covering index')) {
    return '30-50% reduction';
  }
  if (text.includes('missing index') || text.includes('add index') || text.includes('create index')) {
    return '30-60% query time reduction';
  }
  if (text.includes('partition')) {
    return '40-70% reduction on range queries';
  }

  return undefined;
}

// ── Topological sort ──────────────────────────────────────────────────────────

/**
 * Topological sort of findings by dependsOn chains. Findings with no dependencies
 * come first. Handles cycles by placing cycle members after non-cycle members.
 */
function topologicalSort(findings: Finding[]): Finding[] {
  const idSet = new Set(findings.map((f) => f.id));
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const f of findings) {
    adjList.set(f.id, []);
    inDegree.set(f.id, 0);
  }

  // Edge: dep → f.id (dep must come before f)
  for (const f of findings) {
    for (const dep of f.dependsOn) {
      if (idSet.has(dep)) {
        adjList.get(dep)!.push(f.id);
        inDegree.set(f.id, (inDegree.get(f.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Append any cycle members that didn't get sorted
  for (const f of findings) {
    if (!sorted.includes(f.id)) sorted.push(f.id);
  }

  const idToFinding = new Map(findings.map((f) => [f.id, f]));
  return sorted.map((id) => idToFinding.get(id)!);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function scoreFindings(findings: Finding[], context: AppContext): ScoredRecommendation[] {
  // 1. Score each finding
  const withScores = findings.map((finding) => {
    const effort = scoreEffort(finding);
    const impact = scoreImpact(finding, context);
    const roi = impact.value / effort.value;
    return { finding, effort, impact, roi };
  });

  // 2. Sort by ROI desc, then impact desc as tiebreaker
  withScores.sort((a, b) => {
    if (b.roi !== a.roi) return b.roi - a.roi;
    return b.impact.value - a.impact.value;
  });

  // 3. Topological sort to respect dependsOn chains for implementation order
  const topoOrder = topologicalSort(withScores.map((s) => s.finding));
  const topoIndex = new Map<string, number>();
  topoOrder.forEach((f, i) => topoIndex.set(f.id, i + 1));

  // 4. Build ScoredRecommendation[]
  return withScores.map((s) => ({
    finding: s.finding,
    effort: s.effort,
    impact: s.impact,
    roi: Math.round(s.roi * 100) / 100,
    implementationOrder: topoIndex.get(s.finding.id) ?? withScores.indexOf(s) + 1,
    estimatedQuerySpeedup: estimateQuerySpeedup(s.finding, context),
  }));
}
