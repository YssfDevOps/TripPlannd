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
import { existsSync, cpSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'server');
const port = process.env.PORT || '3001';
const url = `http://localhost:${port}`;
const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';
const forceRebuild = process.argv.includes('--rebuild');

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: onWindows });
  if (res.status !== 0) {
    console.error(`\n[TREK] "${cmd} ${args.join(' ')}" failed. See the output above.`);
    process.exit(res.status ?? 1);
  }
}

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
// Newest mtime under a tree, skipping build outputs and vendored dirs. Lets the
// launcher notice when a code update (e.g. a git pull) is newer than the last build.
function newestMtime(dir) {
  const skip = new Set(['node_modules', 'dist', 'public', 'data', 'uploads', '.git']);
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    let entries;
    try {
      entries = readdirSync(stack.pop(), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = join(e.parentPath ?? e.path ?? dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else newest = Math.max(newest, mtime(full));
    }
  }
  return newest;
}

// 1. Dependencies: (re)install when missing, or when the lockfile changed since
// the last install (npm records the installed tree in node_modules/.package-lock.json).
const nodeModules = join(root, 'node_modules');
const installStamp = join(nodeModules, '.package-lock.json');
const lockfile = join(root, 'package-lock.json');
if (!existsSync(nodeModules) || mtime(lockfile) > mtime(installStamp)) {
  console.log('[TREK] Installing/updating dependencies. This can take a few minutes...');
  run(npm, ['install'], root);
}

// 2. Build, then stage the built client into server/public for single-port serving.
// Rebuild automatically when the build is missing OR the source is newer than the
// last build (so a code update just works — no need to pass --rebuild).
const buildOutputs = [join(serverDir, 'dist', 'index.js'), join(serverDir, 'public', 'index.html')];
const built = buildOutputs.every(existsSync);
const newestSource = Math.max(
  newestMtime(join(root, 'shared', 'src')),
  newestMtime(join(root, 'server', 'src')),
  newestMtime(join(root, 'client', 'src')),
  mtime(lockfile),
);
const oldestBuild = Math.min(...buildOutputs.map(mtime));
const stale = built && newestSource > oldestBuild;
if (!built || stale || forceRebuild) {
  console.log(
    built && !forceRebuild
      ? '[TREK] Code changed since the last run — rebuilding...'
      : '[TREK] Building the app. This can take a minute...',
  );
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
