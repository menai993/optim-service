// src/scoring/rubric.ts
// Effort / impact rubric — deterministic, no LLM calls

import { Finding, AppContext } from '../types/agents';
import { EffortScore, ImpactScore } from '../types/scoring';

// ── Effort labels ─────────────────────────────────────────────────────────────

const EFFORT_LABELS: Record<EffortScore['value'], string> = {
  1: 'Trivial',
  2: 'Small',
  3: 'Moderate',
  4: 'Significant',
  5: 'Major',
};

// ── Impact labels ─────────────────────────────────────────────────────────────

const IMPACT_LABELS: Record<ImpactScore['value'], string> = {
  1: 'Minimal',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Critical',
};

// ── Keyword-to-effort mappings ────────────────────────────────────────────────

interface EffortRule {
  keywords: string[];
  value: EffortScore['value'];
  reasoning: string;
}

const EFFORT_RULES: EffortRule[] = [
  // Level 1
  { keywords: ['add index', 'create index', 'drop index', 'missing index', 'query hint', 'one-line'], value: 1, reasoning: 'Single index or one-line change' },
  // Level 2
  { keywords: ['rewrite query', 'cache layer', 'eager', 'lazy', 'select *', 'select all', 'n+1', 'n + 1'], value: 2, reasoning: 'Single query rewrite or ORM flag change' },
  // Level 3
  { keywords: ['refactor', 'pagination', 'paginate', 'covering index', 'migration'], value: 3, reasoning: 'Service refactor or migration with covering index' },
  // Level 4
  { keywords: ['schema migration', 'multiple tables', 'extract service', 'restructure'], value: 4, reasoning: 'Multi-table schema migration or service extraction' },
  // Level 5
  { keywords: ['cross-service', 'architectural', 'data model redesign', 'caching tier', 'new tier'], value: 5, reasoning: 'Cross-service architectural change' },
];

// ── Severity base map ─────────────────────────────────────────────────────────

const SEVERITY_BASE: Record<Finding['severity'], ImpactScore['value']> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function scoreEffort(finding: Finding): EffortScore {
  const haystack = `${finding.title} ${finding.description} ${finding.suggestedFix}`.toLowerCase();

  for (const rule of EFFORT_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return { value: rule.value, label: EFFORT_LABELS[rule.value], reasoning: rule.reasoning };
    }
  }

  // Fallback by layer
  const fallback: EffortScore['value'] = finding.layer === 'sql' ? 2 : finding.layer === 'backend' ? 3 : 3;
  return { value: fallback, label: EFFORT_LABELS[fallback], reasoning: 'Default for layer ' + finding.layer };
}

export function scoreImpact(finding: Finding, context: AppContext): ImpactScore {
  let value = SEVERITY_BASE[finding.severity] as number;
  const reasons: string[] = [`Base from severity "${finding.severity}": ${value}`];

  // Boost if any affected artifact is a hot table
  const touchesHotTable = finding.affectedArtifacts.some((a) =>
    context.hotTables.some((ht) => a.toLowerCase().includes(ht.toLowerCase())),
  );
  if (touchesHotTable) {
    value = Math.min(value + 1, 5);
    reasons.push('+1 hot table boost');
  }

  // Reduce if all affected artifacts are cold (not hot) tables
  const allCold =
    finding.affectedArtifacts.length > 0 &&
    finding.affectedArtifacts.every(
      (a) => !context.hotTables.some((ht) => a.toLowerCase().includes(ht.toLowerCase())),
    );
  if (allCold && !touchesHotTable) {
    value = Math.max(value - 1, 1);
    reasons.push('-1 cold/secondary table');
  }

  // Boost if finding touches a critical path
  const touchesCriticalPath = context.criticalPaths.some((cp) =>
    finding.affectedArtifacts.some(
      (a) => cp.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(cp.toLowerCase()),
    ),
  );
  if (touchesCriticalPath) {
    value = Math.min(value + 1, 5);
    reasons.push('+1 critical path boost');
  }

  const clamped = Math.max(1, Math.min(5, value)) as ImpactScore['value'];
  return { value: clamped, label: IMPACT_LABELS[clamped], reasoning: reasons.join('; ') };
}
