// Launch the real signed v0.22.0 app and point its native autoUpdater (Squirrel.Mac) at one loopback feed.
// Outcome: Squirrel's own error/downloaded event (download survived) or the process dying mid-download.
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');

const [appBin, feedUrl, root, out] = process.argv.slice(2);
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^(HERMES_|ELECTRON_|NODE_|PYTHON|UV_)/.test(key) && !/(KEY|TOKEN|SECRET|PASSWORD)/.test(key)) env[key] = value;
}
for (const dir of ['home', 'hermes', 'userdata', 'tmp']) fs.mkdirSync(path.join(root, dir), { recursive: true });
Object.assign(env, {
  HOME: path.join(root, 'home'), HERMES_HOME: path.join(root, 'hermes'),
  HERMES_DESKTOP_USER_DATA_DIR: path.join(root, 'userdata'), TMPDIR: path.join(root, 'tmp'),
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
});

(async () => {
  const app = await _electron.launch({ executablePath: appBin, env, timeout: 120_000 });
  const child = app.process();
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ event: 'process-exit', code, signal })));
  const pid = await app.evaluate(() => process.pid);
  const electron = await app.evaluate(() => process.versions.electron);
  const started = Date.now();
  const outcome = await Promise.race([
    app.evaluate(({ autoUpdater }, feed) => new Promise((resolve) => {
      autoUpdater.once('error', (error) => resolve({ event: 'error', message: String((error && error.message) || error) }));
      autoUpdater.once('update-downloaded', () => resolve({ event: 'update-downloaded' }));
      autoUpdater.once('update-not-available', () => resolve({ event: 'update-not-available' }));
      autoUpdater.setFeedURL({ url: feed });
      autoUpdater.checkForUpdates();
    }), feedUrl).catch((error) => ({ event: 'evaluate-rejected', message: String(error.message).slice(0, 200) })),
    exited,
    new Promise((resolve) => setTimeout(() => resolve({ event: 'timeout' }), 300_000)),
  ]);
  const exit = outcome.event === 'process-exit' ? outcome
    : await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 5_000))]);
  const result = { pid, electron, feedUrl, seconds: (Date.now() - started) / 1000, outcome, exit, alive: exit === null };
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  try { await app.close(); } catch { /* already gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  process.exit(0);
})();
