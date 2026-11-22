import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// lib/ai/providers.ts is imported by client components (model settings), so the
// claude-cli module it registers must not import Node built-ins at the top level:
// Turbopack then fails the whole page ("does not support external modules").
const DIR = join(process.cwd(), 'lib/ai/claude-cli');

describe('claude-cli module stays safe to bundle for the browser', () => {
  it('has no top-level Node built-in imports', () => {
    const offenders = readdirSync(DIR)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /^import\s[^;]*from\s+['"](node:|child_process|fs|os|path|readline)/m.test(
          readFileSync(join(DIR, file), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
