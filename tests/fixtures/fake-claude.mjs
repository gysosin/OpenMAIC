#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests. No network, no real CLI.
//
//   FAKE_CLAUDE_FIXTURE  NDJSON file to replay on stdout (default mode)
//   FAKE_CLAUDE_MODE     replay | hang | stubborn | crash
//   FAKE_CLAUDE_RECORD   file that receives { argv, env, stdin, systemPrompt } as JSON
//
// hang: print the init line, then wait. stubborn: same, but ignores SIGINT and
// SIGTERM, so only SIGKILL stops it. crash: stderr message and exit code 3.
import { readFileSync, writeFileSync } from 'node:fs';

const { FAKE_CLAUDE_FIXTURE, FAKE_CLAUDE_MODE = 'replay', FAKE_CLAUDE_RECORD } = process.env;

if (FAKE_CLAUDE_MODE === 'stubborn') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
}

let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;

if (FAKE_CLAUDE_RECORD) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--system-prompt-file');
  writeFileSync(
    FAKE_CLAUDE_RECORD,
    JSON.stringify({
      argv,
      env: process.env,
      stdin,
      cwd: process.cwd(),
      systemPrompt: i >= 0 ? readFileSync(argv[i + 1], 'utf8') : undefined,
    }),
  );
}

if (FAKE_CLAUDE_MODE === 'crash') {
  console.error('fake claude: boom');
  process.exit(3);
}

if (FAKE_CLAUDE_MODE === 'hang' || FAKE_CLAUDE_MODE === 'stubborn') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(readFileSync(FAKE_CLAUDE_FIXTURE, 'utf8'));
}
