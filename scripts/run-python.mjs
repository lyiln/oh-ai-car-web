#!/usr/bin/env node
import { spawn } from 'node:child_process';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node scripts/run-python.mjs <script.py> [arguments...]');
  process.exit(2);
}

// Windows normally exposes the launcher as `python`; macOS and Linux commonly
// provide only `python3`. Keep npm commands portable while leaving the Python
// implementations unchanged.
const interpreter = process.platform === 'win32' ? 'python' : 'python3';
const child = spawn(interpreter, [script, ...args], { stdio: 'inherit', shell: false });

child.once('error', (error) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') {
    console.error(`Cannot find ${interpreter}. Install Python 3 and ensure it is on PATH.`);
  } else {
    console.error(`Could not start Python: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
