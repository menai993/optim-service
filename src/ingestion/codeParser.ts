// src/ingestion/codeParser.ts
// Extracts structure from backend TypeScript/JavaScript source files

import { RawInput, CodeArtifact, ImportInfo, QueryPattern, OrmCall } from '../types/ingestion';

/**
 * Parse a backend source file into a structured CodeArtifact.
 */
export function parseCode(input: RawInput): CodeArtifact {
  const imports = extractImports(input.content);
  const exports = extractExports(input.content);
  const queryPatterns = detectQueryPatterns(input.content);
  const ormCalls = detectOrmCalls(input.content);

  return {
    sourceFile: input.filePath,
    exports,
    imports,
    queryPatterns,
    ormCalls,
  };
}

/**
 * Extract ES/CommonJS import statements.
 */
export function extractImports(source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  // ES module: import { a, b } from 'module'
  const esImportRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = esImportRegex.exec(source)) !== null) {
    const importedNames = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
    results.push({ moduleSpecifier: match[2], importedNames });
  }

  // ES module: import DefaultExport from 'module'
  const esDefaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = esDefaultImportRegex.exec(source)) !== null) {
    results.push({ moduleSpecifier: match[2], importedNames: [match[1]] });
  }

  // CommonJS: const x = require('module')
  const cjsImportRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  while ((match = cjsImportRegex.exec(source)) !== null) {
    const names = match[1]
      ? match[1].split(',').map((n) => n.trim())
      : [match[2]];
    results.push({ moduleSpecifier: match[3], importedNames: names });
  }

  return results;
}

/**
 * Extract top-level exported symbol names.
 */
export function extractExports(source: string): string[] {
  const results: string[] = [];

  const exportRegex = /^export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(source)) !== null) {
    results.push(match[1]);
  }

  // export { a, b }
  const namedExportRegex = /^export\s*\{([^}]+)\}/gm;
  while ((match = namedExportRegex.exec(source)) !== null) {
    match[1].split(',').forEach((n) => results.push(n.trim()));
  }

  return [...new Set(results)];
}

/**
 * Detect common problematic query patterns such as N+1 queries,
 * missing caches, and raw query strings.
 */
export function detectQueryPatterns(source: string): QueryPattern[] {
  const patterns: QueryPattern[] = [];
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // N+1: a DB call inside a loop
    if (/for\s*\(|\.forEach\s*\(|\.map\s*\(/.test(line)) {
      // Check next few lines for a DB query
      const block = lines.slice(idx, idx + 5).join('\n');
      if (/await\s+\w+\.(find|query|execute|get|fetch)/i.test(block) ||
          /\$query|prisma\.|db\.|orm\./i.test(block)) {
        patterns.push({
          line: lineNum,
          snippet: line.trim(),
          classification: 'n+1',
        });
      }
    }

    // Missing cache: repeated identical fetch without caching
    if ((/await\s+fetch\(|await\s+axios\./i.test(line)) && !/cache/i.test(line)) {
      patterns.push({
        line: lineNum,
        snippet: line.trim(),
        classification: 'missing-cache',
      });
    }

    // Raw query string
    if (/\$\{.*?\}/.test(line) && /SELECT|INSERT|UPDATE|DELETE/i.test(line)) {
      patterns.push({
        line: lineNum,
        snippet: line.trim(),
        classification: 'raw-query',
      });
    }
  });

  return patterns;
}

/**
 * Detect ORM-specific call patterns.
 */
export function detectOrmCalls(source: string): OrmCall[] {
  const ormPatterns: Array<{ orm: string; regex: RegExp }> = [
    { orm: 'prisma', regex: /prisma\.(\w+)\.(findMany|findOne|findFirst|create|update|delete|upsert|aggregate|count)\s*\(/g },
    { orm: 'typeorm', regex: /(?:getRepository|createQueryBuilder|\.find|\.findOne|\.save|\.remove)\s*\(/g },
    { orm: 'sequelize', regex: /\w+\.(?:findAll|findOne|create|update|destroy|bulkCreate)\s*\(/g },
  ];

  const results: OrmCall[] = [];

  for (const { orm, regex } of ormPatterns) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for global regex
    regex.lastIndex = 0;
    while ((match = regex.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      results.push({ line, callSite: match[0].slice(0, 80), orm });
    }
  }

  // Sort by line
  results.sort((a, b) => a.line - b.line);
  return results;
}
