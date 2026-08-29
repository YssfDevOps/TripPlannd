#!/usr/bin/env node
/*
 * TREK desktop launcher — start TREK without the command line.
 *
 * Double-click TREK.command (macOS), TREK.bat (Windows), or TREK.sh (Linux) in
 * the repo root. The FIRST run installs dependencies and builds the app (a few
 * minutes, one time). Every run after that just starts the server and opens
 * TREK in your default browser. Close the window to stop TREK.
 *
 * Requires Node.js 22+ installed and on your PATH. Nothing else.
 *
 * Options:
 *   --rebuild   Force a fresh build (use after pulling code updates).
 * Env:
 *   PORT        Port to serve on (default 3001).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'server');
const port = process.env.PORT || '3001';
const url = `http://localhost:${port}`;
const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: onWindows });
  if (res.status !== 0) {
    console.error(`\n[TREK] "${cmd} ${args.join(' ')}" failed. See the output above.`);
    process.exit(res.status ?? 1);
  }
}

// 1. Dependencies (first run only).
if (!existsSync(join(root, 'node_modules'))) {
  console.log('[TREK] First run: installing dependencies. This can take a few minutes...');
  run(npm, ['install'], root);
}

// 2. Build once, then stage the built client into server/public for single-port serving.
const alreadyBuilt =
  existsSync(join(serverDir, 'dist', 'index.js')) &&
  existsSync(join(serverDir, 'public', 'index.html'));
if (!alreadyBuilt || process.argv.includes('--rebuild')) {
  console.log('[TREK] Building the app (first run or --rebuild). One moment...');
  run(npm, ['run', 'build'], root);
  const publicDir = join(serverDir, 'public');
  mkdirSync(publicDir, { recursive: true });
  cpSync(join(root, 'client', 'dist'), publicDir, { recursive: true });
  const fonts = join(root, 'client', 'public', 'fonts');
  if (existsSync(fonts)) cpSync(fonts, join(publicDir, 'fonts'), { recursive: true });
}

// 3. Start the server (serves the UI and the API on one port).
console.log(`[TREK] Starting TREK on ${url} ...`);
const child = spawn('node', ['--require', 'tsconfig-paths/register', 'dist/index.js'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: port,
    // Served over plain http://localhost, so the session cookie must NOT be
    // marked Secure or the browser drops it and login fails with "Access token
    // required". This is the documented home-lab setting. Respect an explicit
    // override (e.g. if the user puts TREK behind HTTPS themselves).
    COOKIE_SECURE: process.env.COOKIE_SECURE ?? 'false',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
const stop = () => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// 4. Wait until the server is healthy, then open the browser once.
let opened = false;
function openBrowser() {
  if (opened) return;
  opened = true;
  console.log(`[TREK] Ready. Opening ${url} — first run also prints a one-time admin login above.`);
  const [cmd, args] = onWindows
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, shell: onWindows }).unref();
  } catch {
    console.log(`[TREK] Could not open a browser automatically — open ${url} yourself.`);
  }
}
function pollHealth() {
  const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
    res.resume();
    if (res.statusCode === 200) openBrowser();
    else setTimeout(pollHealth, 800);
  });
  req.on('error', () => setTimeout(pollHealth, 800));
  req.setTimeout(2000, () => req.destroy());
}
setTimeout(pollHealth, 1500);
