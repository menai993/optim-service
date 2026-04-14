// src/reports/formatter.ts
// Markdown and JSON report formatters

import { OptimizationReport } from '../types/report';

/**
 * Format an OptimizationReport as GitHub-flavoured Markdown.
 */
export function formatMarkdown(report: OptimizationReport): string {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    `> Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
    '## Recommendations',
    '',
  ];

  report.recommendations.forEach((rec, idx) => {
    const { finding, effortScore, impactScore, priorityScore } = rec;
    lines.push(
      `### ${idx + 1}. ${finding.title}`,
      '',
      `- **Layer**: ${finding.layer}`,
      `- **Impact**: ${impactScore}/5  **Effort**: ${effortScore}/5  **Priority**: ${priorityScore}`,
      '',
      finding.description,
      '',
    );
    if (rec.exampleFix) {
      lines.push('**Example fix:**', '```', rec.exampleFix, '```', '');
    }
  });

  return lines.join('\n');
}

/**
 * Format an OptimizationReport as a JSON string.
 */
export function formatJson(report: OptimizationReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Attach formatted outputs to the report object in-place and return it.
 */
export function attachFormats(report: OptimizationReport): OptimizationReport {
  report.markdown = formatMarkdown(report);
  report.json = formatJson(report);
  return report;
}
