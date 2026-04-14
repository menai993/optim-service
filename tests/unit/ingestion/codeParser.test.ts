// tests/unit/ingestion/codeParser.test.ts

import {
  extractImports,
  extractExports,
  detectQueryPatterns,
  detectOrmCalls,
  parseCode,
} from '../../../src/ingestion/codeParser';
import * as fs from 'fs';
import * as path from 'path';

const sampleBackend = fs.readFileSync(
  path.join(__dirname, '../../fixtures/sample_backend.ts'),
  'utf8',
);

describe('extractImports', () => {
  it('extracts ES imports', () => {
    const source = `import { Router, Request } from 'express';\nimport Anthropic from '@anthropic-ai/sdk';`;
    const imports = extractImports(source);
    expect(imports.length).toBeGreaterThanOrEqual(2);
    const specifiers = imports.map((i) => i.moduleSpecifier);
    expect(specifiers).toContain('express');
    expect(specifiers).toContain('@anthropic-ai/sdk');
  });

  it('extracts CommonJS requires', () => {
    const source = `const { join } = require('path');\nconst fs = require('fs');`;
    const imports = extractImports(source);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('detects import from sample_backend', () => {
    const imports = extractImports(sampleBackend);
    const specifiers = imports.map((i) => i.moduleSpecifier);
    expect(specifiers).toContain('@prisma/client');
  });
});

describe('extractExports', () => {
  it('detects exported async functions', () => {
    const exports = extractExports(sampleBackend);
    expect(exports).toContain('getOrdersWithItems');
    expect(exports).toContain('getProductCatalogue');
  });

  it('returns empty array for file with no exports', () => {
    const exports = extractExports('const x = 1;');
    expect(exports).toEqual([]);
  });
});

describe('detectQueryPatterns', () => {
  it('detects N+1 patterns', () => {
    const patterns = detectQueryPatterns(sampleBackend);
    const n1 = patterns.filter((p) => p.classification === 'n+1');
    expect(n1.length).toBeGreaterThan(0);
  });

  it('includes line numbers', () => {
    const patterns = detectQueryPatterns(sampleBackend);
    for (const p of patterns) {
      expect(p.line).toBeGreaterThan(0);
    }
  });

  it('returns empty array for clean code', () => {
    const source = `function greet(name: string) { return \`Hello \${name}\`; }`;
    const patterns = detectQueryPatterns(source);
    expect(patterns).toEqual([]);
  });
});

describe('detectOrmCalls', () => {
  it('detects Prisma calls in sample_backend', () => {
    const calls = detectOrmCalls(sampleBackend);
    const prismaCalls = calls.filter((c) => c.orm === 'prisma');
    expect(prismaCalls.length).toBeGreaterThan(0);
  });

  it('results are sorted by line number', () => {
    const calls = detectOrmCalls(sampleBackend);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].line).toBeGreaterThanOrEqual(calls[i - 1].line);
    }
  });
});

describe('parseCode', () => {
  it('returns a complete CodeArtifact', () => {
    const artifact = parseCode({ filePath: 'sample.ts', content: sampleBackend, type: 'typescript' });
    expect(artifact.sourceFile).toBe('sample.ts');
    expect(artifact.exports.length).toBeGreaterThan(0);
    expect(artifact.imports.length).toBeGreaterThan(0);
  });
});
