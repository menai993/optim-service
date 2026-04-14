// tests/unit/ingestion/codeParser.test.ts

import {
  parseCodeFile,
  detectPatterns,
} from '../../../src/ingestion/codeParser';
import * as fs from 'fs';
import * as path from 'path';

const sampleBackend = fs.readFileSync(
  path.join(__dirname, '../../fixtures/sample_backend.ts'),
  'utf8',
);

describe('parseCodeFile – language detection', () => {
  it('detects TypeScript from .ts extension', () => {
    const artifact = parseCodeFile('orderService.ts', 'const x = 1;');
    expect(artifact.language).toBe('typescript');
  });

  it('detects Python from .py extension', () => {
    const artifact = parseCodeFile('main.py', 'x = 1');
    expect(artifact.language).toBe('python');
  });

  it('detects Java from .java extension', () => {
    const artifact = parseCodeFile('App.java', 'class App {}');
    expect(artifact.language).toBe('java');
  });

  it('detects Go from .go extension', () => {
    const artifact = parseCodeFile('main.go', 'package main');
    expect(artifact.language).toBe('go');
  });

  it('detects C# from .cs extension', () => {
    const artifact = parseCodeFile('Service.cs', 'class Service {}');
    expect(artifact.language).toBe('csharp');
  });

  it('detects JavaScript from .js extension', () => {
    const artifact = parseCodeFile('app.js', 'const x = 1;');
    expect(artifact.language).toBe('javascript');
  });
});

describe('parseCodeFile – artifact type detection', () => {
  it('detects controller type', () => {
    expect(parseCodeFile('userController.ts', '').type).toBe('controller');
    expect(parseCodeFile('orderHandler.ts', '').type).toBe('controller');
  });

  it('detects repository type', () => {
    expect(parseCodeFile('userRepository.ts', '').type).toBe('repository');
    expect(parseCodeFile('orderRepo.ts', '').type).toBe('repository');
  });

  it('detects model type', () => {
    expect(parseCodeFile('userModel.ts', '').type).toBe('model');
    expect(parseCodeFile('orderEntity.ts', '').type).toBe('model');
  });

  it('detects job type', () => {
    expect(parseCodeFile('emailJob.ts', '').type).toBe('job');
    expect(parseCodeFile('syncWorker.ts', '').type).toBe('job');
  });

  it('defaults to service for unrecognized filenames', () => {
    expect(parseCodeFile('helpers.ts', '').type).toBe('service');
  });

  it('detects middleware type', () => {
    expect(parseCodeFile('authMiddleware.ts', '').type).toBe('middleware');
  });
});

describe('parseCodeFile – full artifact on sample_backend', () => {
  it('populates all fields from sample_backend.ts', () => {
    const artifact = parseCodeFile('sample_backend.ts', sampleBackend);
    expect(artifact.filename).toBe('sample_backend.ts');
    expect(artifact.language).toBe('typescript');
    expect(artifact.rawContent).toBe(sampleBackend);
  });

  it('detects patterns in sample_backend', () => {
    const artifact = parseCodeFile('sample_backend.ts', sampleBackend);
    expect(artifact.detectedPatterns).toBeDefined();
    expect(artifact.detectedPatterns!.length).toBeGreaterThan(0);
  });
});

describe('detectPatterns – n_plus_one', () => {
  it('detects N+1 in for-of loop with await inside', () => {
    const code = `
async function process(ids) {
  for (const id of ids) {
    const item = await db.findOne({ id });
    console.log(item);
  }
}`;
    const patterns = detectPatterns(code);
    const n1 = patterns.filter((p) => p.type === 'n_plus_one');
    expect(n1.length).toBeGreaterThan(0);
    expect(n1[0].lineRange[0]).toBeGreaterThan(0);
    expect(n1[0].lineRange[1]).toBeGreaterThanOrEqual(n1[0].lineRange[0]);
  });

  it('detects N+1 in sample_backend fixture', () => {
    const patterns = detectPatterns(sampleBackend);
    const n1 = patterns.filter((p) => p.type === 'n_plus_one');
    expect(n1.length).toBeGreaterThan(0);
  });
});

describe('detectPatterns – select_star', () => {
  it('detects SELECT * in string literals', () => {
    const code = `const q = "SELECT * FROM users WHERE active = true";`;
    const patterns = detectPatterns(code);
    const ss = patterns.filter((p) => p.type === 'select_star');
    expect(ss.length).toBe(1);
  });

  it('does not flag SELECT * in comments', () => {
    const code = `// We should avoid SELECT * for performance reasons\nconst x = 1;`;
    const patterns = detectPatterns(code);
    const ss = patterns.filter((p) => p.type === 'select_star');
    // This line has no quote characters so should not match
    expect(ss.length).toBe(0);
  });

  it('detects SELECT * in sample_backend fixture', () => {
    const patterns = detectPatterns(sampleBackend);
    const ss = patterns.filter((p) => p.type === 'select_star');
    expect(ss.length).toBeGreaterThan(0);
  });
});

describe('detectPatterns – missing_pagination', () => {
  it('detects findMany without limit/take', () => {
    const code = `
async function getAllUsers() {
  return prisma.users.findMany({
    where: { active: true },
  });
}`;
    const patterns = detectPatterns(code);
    const mp = patterns.filter((p) => p.type === 'missing_pagination');
    expect(mp.length).toBeGreaterThan(0);
  });

  it('does not flag when take is present', () => {
    const code = `
async function getUsers(take: number) {
  return prisma.users.findMany({ take });
}`;
    const patterns = detectPatterns(code);
    const mp = patterns.filter((p) => p.type === 'missing_pagination');
    expect(mp.length).toBe(0);
  });
});

describe('detectPatterns – unbounded_query', () => {
  it('detects findMany() with no arguments', () => {
    const code = `const all = await prisma.products.findMany();`;
    const patterns = detectPatterns(code);
    const uq = patterns.filter((p) => p.type === 'unbounded_query');
    expect(uq.length).toBe(1);
  });

  it('detects find({}) with empty object', () => {
    const code = `const all = await db.find({});`;
    const patterns = detectPatterns(code);
    const uq = patterns.filter((p) => p.type === 'unbounded_query');
    expect(uq.length).toBe(1);
  });
});

describe('detectPatterns – synchronous_bulk', () => {
  it('detects sequential await in for-of', () => {
    const code = `
async function sendAll(items: string[]) {
  for (const item of items) {
    await sendEmail(item);
  }
}`;
    const patterns = detectPatterns(code);
    const sb = patterns.filter((p) => p.type === 'synchronous_bulk');
    expect(sb.length).toBeGreaterThan(0);
  });
});

describe('detectPatterns – edge cases', () => {
  it('returns empty array for clean code with no patterns', () => {
    const code = `function add(a: number, b: number) { return a + b; }`;
    const patterns = detectPatterns(code);
    expect(patterns).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(detectPatterns('')).toEqual([]);
  });

  it('handles malformed code without crashing', () => {
    const code = `}{}{}{function( async await for of .findMany()`;
    expect(() => detectPatterns(code)).not.toThrow();
  });
});
