import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariante 1 de AGENTS.md: el motor es puro. Este test falla si alguien
 * importa infraestructura o usa fuentes de no-determinismo dentro de lib/engine.
 */

const ROOT = 'lib/engine';

const FORBIDDEN = [
  { pattern: /from\s+['"]node:/, label: 'import de node:*' },
  { pattern: /from\s+['"](fs|path|crypto|os)['"]/, label: 'import de módulo del sistema' },
  { pattern: /\bDate\.now\b/, label: 'Date.now()' },
  { pattern: /\bnew Date\b/, label: 'new Date' },
  { pattern: /\bMath\.random\b/, label: 'Math.random' },
  { pattern: /\bcrypto\.randomUUID\b/, label: 'crypto.randomUUID' },
  { pattern: /\bprocess\.env\b/, label: 'process.env' },
  { pattern: /from\s+['"](next|react|@supabase)/, label: 'import de framework o BD' },
  { pattern: /\bfetch\(/, label: 'fetch' },
];

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

function sources(): { file: string; text: string }[] {
  return readdirSync(ROOT)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      file: join(ROOT, name),
      text: stripComments(readFileSync(join(ROOT, name), 'utf8')),
    }));
}

describe('pureza del motor', () => {
  it('lee todos los módulos del motor', () => {
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('ningún módulo usa IO, reloj, azar global ni frameworks', () => {
    const violations: string[] = [];
    for (const { file, text } of sources()) {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) violations.push(`${file}: ${rule.label}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('el motor no importa bots, UI ni base de datos', () => {
    const violations: string[] = [];
    for (const { file, text } of sources()) {
      if (/from\s+['"][^'"]*(bots|narrator|db|app)\//.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
