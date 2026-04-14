// src/ingestion/codeParser.ts
// Extracts structure and anti-pattern detection from backend source files

import {
  CodeArtifact,
  DetectedPattern,
  PatternType,
} from '../types/ingestion';

type Language = CodeArtifact['language'];
type ArtifactType = CodeArtifact['type'];

/**
 * Detect language from file extension.
 */
function detectLanguage(filename: string): Language {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const map: Record<string, Language> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.cs': 'csharp',
    '.java': 'java',
    '.go': 'go',
  };
  return map[ext] ?? 'typescript';
}

/**
 * Detect artifact type from filename conventions.
 */
function detectArtifactType(filename: string): ArtifactType {
  const lower = filename.toLowerCase();
  if (/controller|handler/i.test(lower)) return 'controller';
  if (/repositor|repo/i.test(lower)) return 'repository';
  if (/model|entity/i.test(lower)) return 'model';
  if (/job|worker/i.test(lower)) return 'job';
  if (/middleware/i.test(lower)) return 'middleware';
  // default
  return 'service';
}

/**
 * Parse a backend source file into a structured CodeArtifact.
 */
export function parseCodeFile(filename: string, content: string): CodeArtifact {
  const language = detectLanguage(filename);
  const type = detectArtifactType(filename);
  const detectedPatterns = detectPatterns(content);

  return {
    type,
    filename,
    language,
    rawContent: content,
    detectedPatterns: detectedPatterns.length > 0 ? detectedPatterns : undefined,
  };
}

// ── Pattern Detection ─────────────────────────────────────────────────────────

/**
 * Run all pattern detectors against the source code.
 */
export function detectPatterns(source: string): DetectedPattern[] {
  const lines = source.split('\n');
  const patterns: DetectedPattern[] = [];

  patterns.push(...detectNPlusOne(lines));
  patterns.push(...detectMissingCache(lines, source));
  patterns.push(...detectOrmLazyLoad(lines));
  patterns.push(...detectSelectStar(lines));
  patterns.push(...detectSynchronousBulk(lines));
  patterns.push(...detectMissingPagination(lines, source));
  patterns.push(...detectUnboundedQuery(lines));

  // Sort by start line
  patterns.sort((a, b) => a.lineRange[0] - b.lineRange[0]);
  return patterns;
}

/**
 * N+1: loop containing a DB call (.find / .findOne / .findMany / .query / .execute / $query)
 */
function detectNPlusOne(lines: string[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const loopPattern = /\bfor\s*\(|\bfor\s+of\b|\.forEach\s*\(|\.map\s*\(/;
  const dbCallPattern =
    /\.(find|findOne|findMany|findFirst|query|execute|\$query|\$queryRaw|fetch|get)\s*\(/i;

  for (let i = 0; i < lines.length; i++) {
    if (loopPattern.test(lines[i])) {
      // Scan ahead up to 10 lines for a DB call
      const scanEnd = Math.min(i + 10, lines.length);
      for (let j = i + 1; j < scanEnd; j++) {
        if (dbCallPattern.test(lines[j])) {
          results.push({
            type: 'n_plus_one',
            lineRange: [i + 1, j + 1],
            description: `Potential N+1: database call inside loop at line ${j + 1}`,
            confidence: 0.85,
          });
          break;
        }
      }
    }
  }
  return results;
}

/**
 * Missing cache: function that fetches data but has no cache/redis/memcached reference nearby.
 */
function detectMissingCache(lines: string[], source: string): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const hasCacheAnywhere =
    /cache\.get|redis\.|memcached|cacheManager|getCache|\.cache\(|@Cacheable/i.test(source);
  if (hasCacheAnywhere) return results;

  const fetchPattern =
    /\.(findMany|findAll|find)\s*\(\s*\)|\.(findMany|findAll|find)\s*\(\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    if (fetchPattern.test(lines[i])) {
      // Check surrounding 5 lines for cache references
      const start = Math.max(0, i - 5);
      const end = Math.min(lines.length, i + 5);
      const context = lines.slice(start, end).join('\n');
      if (!/cache|redis|memcached/i.test(context)) {
        results.push({
          type: 'missing_cache',
          lineRange: [i + 1, i + 1],
          description: `Data fetch without caching at line ${i + 1}`,
          confidence: 0.6,
        });
      }
    }
  }
  return results;
}

/**
 * ORM lazy load: .load() calls, lazy: true config, LazyLoad decorators.
 */
function detectOrmLazyLoad(lines: string[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const lazyPattern = /\.load\s*\(|lazy\s*:\s*true|@LazyLoad|lazy\s*=\s*true/;

  for (let i = 0; i < lines.length; i++) {
    if (lazyPattern.test(lines[i])) {
      results.push({
        type: 'orm_lazy_load',
        lineRange: [i + 1, i + 1],
        description: `Lazy loading detected at line ${i + 1}`,
        confidence: 0.8,
      });
    }
  }
  return results;
}

/**
 * SELECT *: raw "SELECT *" in a string literal.
 */
function detectSelectStar(lines: string[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const selectStarPattern = /SELECT\s+\*/i;

  for (let i = 0; i < lines.length; i++) {
    // Only match inside string literals (look for quotes on the line)
    if (selectStarPattern.test(lines[i]) && /['"`]/.test(lines[i])) {
      results.push({
        type: 'select_star',
        lineRange: [i + 1, i + 1],
        description: `SELECT * found in string literal at line ${i + 1}`,
        confidence: 0.9,
      });
    }
  }
  return results;
}

/**
 * Synchronous bulk: await inside a for-of / forEach over an array that could be batched.
 */
function detectSynchronousBulk(lines: string[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const forOfPattern = /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\b/;
  const forEachPattern = /\.forEach\s*\(\s*async/;

  for (let i = 0; i < lines.length; i++) {
    if (forOfPattern.test(lines[i]) || forEachPattern.test(lines[i])) {
      const scanEnd = Math.min(i + 10, lines.length);
      for (let j = i + 1; j < scanEnd; j++) {
        if (/\bawait\b/.test(lines[j])) {
          results.push({
            type: 'synchronous_bulk',
            lineRange: [i + 1, j + 1],
            description: `Sequential await in loop at line ${i + 1}–${j + 1}; consider batching`,
            confidence: 0.7,
          });
          break;
        }
      }
    }
  }
  return results;
}

/**
 * Missing pagination: query functions with no limit/take/pageSize param.
 */
function detectMissingPagination(lines: string[], source: string): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  // Find function declarations that return queries
  const funcPattern =
    /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)|(\w+)\s*(?::\s*[^=]+)?\s*=\s*async\s*\([^)]*\)/g;

  let match: RegExpExecArray | null;
  while ((match = funcPattern.exec(source)) !== null) {
    const funcName = match[1] ?? match[2];
    if (!funcName) continue;

    const funcStart = source.slice(0, match.index).split('\n').length;
    // Find the function body (next ~30 lines)
    const bodyLines = lines.slice(funcStart - 1, funcStart + 30);
    const bodyText = bodyLines.join('\n');

    const hasQuery = /\.(findMany|findAll|find)\s*\(/.test(bodyText);
    const hasPagination = /\b(limit|take|pageSize|offset|skip|first|last)\b/i.test(bodyText);

    if (hasQuery && !hasPagination) {
      results.push({
        type: 'missing_pagination',
        lineRange: [funcStart, funcStart],
        description: `Function "${funcName}" queries data without pagination`,
        confidence: 0.65,
      });
    }
  }
  return results;
}

/**
 * Unbounded query: .findAll() / .find({}) / .findMany() with no where clause.
 */
function detectUnboundedQuery(lines: string[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const unboundedPattern =
    /\.(findAll|findMany|find)\s*\(\s*\)|\.(findAll|findMany|find)\s*\(\s*\{\s*\}\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    if (unboundedPattern.test(lines[i])) {
      results.push({
        type: 'unbounded_query',
        lineRange: [i + 1, i + 1],
        description: `Unbounded query with no filter at line ${i + 1}`,
        confidence: 0.8,
      });
    }
  }
  return results;
}
