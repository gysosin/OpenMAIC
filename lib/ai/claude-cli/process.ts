import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClaudeCLI');

/**
 * Process-wide cap on running CLI children, so outline, agent and scene calls
 * cannot stack up. Shared by every model instance (getModel builds a new one
 * per call).
 */
const slots = { limit: 3, active: 0, waiting: [] as (() => void)[] };

export function setClaudeCliConcurrency(limit: number) {
  slots.limit = Math.max(1, Math.floor(limit));
  while (slots.active < slots.limit && slots.waiting.length) slots.waiting.shift()!();
}

async function acquire(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw signal.reason;
  if (slots.active >= slots.limit) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        slots.waiting.splice(slots.waiting.indexOf(wake), 1);
        reject(signal!.reason);
      };
      slots.waiting.push(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  slots.active++;
  return () => {
    slots.active--;
    if (slots.active < slots.limit) slots.waiting.shift()?.();
  };
}

// Abort ladder, all aimed at the child we spawned and nothing else.
const TERM_AFTER_MS = 500;
const KILL_AFTER_MS = 1200;

export interface RunOptions {
  executablePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdin: string;
  signal?: AbortSignal;
}

/**
 * Spawn the CLI, feed stdin, yield stdout lines. Abort (or the consumer
 * stopping early) kills the child: SIGINT, SIGTERM after 500 ms, SIGKILL after
 * 1.2 s. A non-zero exit or a spawn failure throws.
 */
export async function* runClaude(opts: RunOptions): AsyncGenerator<string> {
  const release = await acquire(opts.signal);
  const child = spawn(opts.executablePath, opts.args, { cwd: opts.cwd, env: opts.env });
  let spawnError: Error | undefined;
  let stderr = '';
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', (e) => {
      spawnError = e;
      resolve(null);
    });
    child.once('close', (code) => resolve(code));
  });
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  child.stdin.on('error', () => {}); // the child may exit before reading everything
  child.stdin.end(opts.stdin);

  let timers: NodeJS.Timeout[] = [];
  const kill = () => {
    if (timers.length || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGINT');
    timers = [
      setTimeout(() => child.kill('SIGTERM'), TERM_AFTER_MS),
      setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS),
    ];
    for (const t of timers) t.unref();
  };
  opts.signal?.addEventListener('abort', kill, { once: true });

  try {
    for await (const line of createInterface({ input: child.stdout })) yield line;
    const code = await exited;
    if (opts.signal?.aborted) throw opts.signal.reason;
    // Paths and stderr stay in the server log; callers (and so clients) get a generic message.
    if (spawnError) {
      log.error('Could not start Claude CLI', { executablePath: opts.executablePath, spawnError });
      throw new Error('Could not start Claude CLI', { cause: spawnError });
    }
    if (code !== 0) {
      const detail = stderr.trim();
      log.error(`Claude CLI exited with code ${code}`, { stderr: detail });
      throw new Error(`Claude CLI failed (exit ${code})`, { cause: detail });
    }
  } finally {
    opts.signal?.removeEventListener('abort', kill);
    kill();
    await exited;
    timers.forEach(clearTimeout);
    release();
  }
}
