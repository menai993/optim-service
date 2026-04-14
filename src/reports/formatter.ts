// src/reports/formatter.ts
// Markdown and JSON report formatters

import { OptimizationReport } from '../types/report';
import { ScoredRecommendation } from '../types/scoring';

// ── Severity badges ───────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<string, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  medium: '🟡 MEDIUM',
  low: '🟢 LOW',
};

// ── Markdown formatter ────────────────────────────────────────────────────────

export function toMarkdown(report: OptimizationReport): string {
  const lines: string[] = [];

  // Header
  lines.push('# Optimization Report');
  lines.push('');
  lines.push(`**App summary:** ${report.appSummary}`);
  lines.push(`**Total findings:** ${report.totalFindings} | **Critical:** ${report.criticalFindings}`);
  lines.push(`**Mode:** ${report.mode} | **Generated:** ${report.generatedAt}`);
  lines.push('');

  // Quick wins table
  if (report.quickWins.length > 0) {
    lines.push('## Quick Wins');
    lines.push('');
    lines.push('| # | Title | Layer | ROI | Effort | Impact | Est. speedup |');
    lines.push('|---|-------|-------|-----|--------|--------|--------------|');
    for (const rec of report.quickWins) {
      lines.push(formatQuickWinRow(rec));
    }
    lines.push('');
  }

  // Complex bets
  if (report.complexBets.length > 0) {
    lines.push('## Complex Bets');
    lines.push('');
    for (const rec of report.complexBets) {
      lines.push(`- **${rec.finding.title}** (effort ${rec.effort.value}/5, impact ${rec.impact.value}/5)`);
    }
    lines.push('');
  }

  // Full recommendations
  lines.push('## Recommendations');
  lines.push('');

  for (const rec of report.recommendations) {
    const { finding } = rec;
    const badge = SEVERITY_BADGE[finding.severity] ?? finding.severity;
    lines.push(`### ${rec.implementationOrder}. ${finding.title}  ${badge}`);
    lines.push('');
    lines.push(`**Layer:** ${finding.layer}`);
    lines.push(`**Effort:** ${rec.effort.value}/5 — ${rec.effort.reasoning}`);
    lines.push(`**Impact:** ${rec.impact.value}/5 — ${rec.impact.reasoning}`);
    if (rec.estimatedQuerySpeedup) {
      lines.push(`**Estimated speedup:** ${rec.estimatedQuerySpeedup}`);
    }
    lines.push('');
    lines.push(finding.description);
    lines.push('');

    if (finding.sqlExample) {
      lines.push('```sql');
      lines.push(finding.sqlExample);
      lines.push('```');
      lines.push('');
    }
    if (finding.codeExample) {
      lines.push('```');
      lines.push(finding.codeExample);
      lines.push('```');
      lines.push('');
    }

    if (finding.dependsOn.length > 0) {
      const depTitles = finding.dependsOn
        .map((depId) => {
          const dep = report.recommendations.find((r) => r.finding.id === depId);
          return dep ? dep.finding.title : depId;
        })
        .join(', ');
      lines.push(`**Dependencies:** ${depTitles}`);
      lines.push('');
    }
  }

  // Discussion summary
  if (report.discussionRounds.length > 0) {
    lines.push('## Discussion Summary');
    lines.push('');
    lines.push(`**Rounds:** ${report.discussionRounds.length}`);

    let totalConflicts = 0;
    let resolvedConflicts = 0;
    const allCrossCutting = new Set<string>();

    for (const round of report.discussionRounds) {
      totalConflicts += round.conflicts.length;
      resolvedConflicts += round.conflicts.filter((c) => c.resolution).length;
      for (const item of round.crossCuttingItems) allCrossCutting.add(item);
    }

    lines.push(`**Conflicts found:** ${totalConflicts} | **Resolved:** ${resolvedConflicts}`);
    lines.push(`**Cross-cutting items:** ${allCrossCutting.size}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatQuickWinRow(rec: ScoredRecommendation): string {
  return `| ${rec.implementationOrder} | ${rec.finding.title} | ${rec.finding.layer} | ${rec.roi} | ${rec.effort.value}/5 | ${rec.impact.value}/5 | ${rec.estimatedQuerySpeedup ?? '-'} |`;
}

// ── JSON formatter ────────────────────────────────────────────────────────────

export function toJson(report: OptimizationReport): string {
  return JSON.stringify(report, null, 2);
}
