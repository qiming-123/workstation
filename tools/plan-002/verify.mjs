import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const host = '127.0.0.1';
const text = 'Plan 002: browser file operations';
const secret = () => randomBytes(24).toString('hex');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=',
  'base64',
);

async function availablePort() {
  for (let i = 0; i < 8; i++) {
    // Keep the probe above the ports that browsers reserve for other protocols.
    const port = randomInt(20000, 45000);
    const server = createServer().listen(port, host);
    try {
      await once(server, 'listening');
    } catch (error) {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') continue;
      throw error;
    }
    await new Promise((done) => server.close(done));
    return port;
  }
  throw new Error('Could not reserve a high port for the browser probe');
}

async function startBackend({ python, config, port, cwd }) {
  const child = spawn(
    python, ['-m', 'copyparty', '-c', config, '-i', host, '-p', String(port), '--http-only'],
    {
      cwd, windowsHide: true,
      env: { ...process.env, XDG_CONFIG_HOME: cwd, PYTHONIOENCODING: 'utf-8' },
    },
  );
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  child.once('error', (error) => { diagnostics += error.message; });

  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) break;
    try {
      await fetch('http://' + host + ':' + port + '/', { signal: AbortSignal.timeout(500) });
      return child;
    } catch {
      await delay(100);
    }
  }
  await stopBackend(child);
  throw new Error('copyparty failed to start:\n' + diagnostics);
}

async function stopBackend(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
}

test('plan 002 uses Windows copyparty through an authenticated browser', async (t) => {
  const { buildProxy } = await import('./proxy.mjs');
  const run = mkdtempSync(join(tmpdir(), 'plan002-data-'));
  const volume = join(run, 'share');
  mkdirSync(volume);
  writeFileSync(join(volume, 'image.png'), png);
  writeFileSync(join(volume, 'note.txt'), text);

  const config = join(run, 'copyparty.conf');
  const backendPassword = secret();
  const password = secret();
  const port = await availablePort();
  const python = resolve(process.env.PLAN002_PYTHON || '.venv/Scripts/python.exe');
  const backendOptions = { config, port, python, cwd: run };
  writeFileSync(config, [
    '[accounts]', '  probe: ' + backendPassword,
    '[/]', '  ' + volume, '  accs:', '    rwmd: probe', '',
  ].join('\n'));

  let backend;
  let proxy;
  let browser;
  try {
    backend = await startBackend(backendOptions);
    const upstream = 'http://' + host + ':' + port;
    proxy = await buildProxy({ upstream, backendPassword, password, cookieKey: secret() });
    const base = await proxy.listen({ host, port: await availablePort() });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await t.test('anonymous read/write are rejected by Fastify and upstream requires its own credentials', async () => {
      assert.equal((await fetch(base + '/note.txt')).status, 401);
      assert.equal((await fetch(base + '/denied.txt', { method: 'PUT', body: 'denied' })).status, 401);
      assert.equal((await fetch(base + '/note.txt', {
        headers: { Cookie: 'plan002_session=forged' },
      })).status, 401);
      assert.equal((await fetch(base + '/__probe/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      })).status, 401);
      assert.ok((await fetch(upstream + '/note.txt')).status >= 400);
      assert.equal(existsSync(join(volume, 'denied.txt')), false);
    });

    await t.test('login, signed HttpOnly session, and browser listing', async () => {
      await page.goto(base + '/__probe/login');
      await page.getByLabel('Test password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL(base + '/');
      assert.ok((await context.cookies()).some(
        (cookie) => cookie.name === 'plan002_session' && cookie.httpOnly,
      ));
      assert.equal(await page.getByRole('link', { name: 'note.txt', exact: true }).count(), 1);
      assert.equal(await page.getByRole('link', { name: 'image.png', exact: true }).count(), 1);
    });

    await t.test('create folder, upload, download, rename and delete through the browser', async () => {
      const folder = '/' + encodeURIComponent('测试 文件夹') + '/';
      const original = folder + encodeURIComponent('样本 文件.txt');
      const renamed = folder + encodeURIComponent('改名 文件.txt');
      const result = await page.evaluate(async ({ folder, original, renamed, text }) => {
        const create = await fetch(folder, { method: 'MKCOL' });
        const upload = await fetch(original, { method: 'PUT', body: new Blob([text]) });
        const download = await fetch(original);
        const move = await fetch(original, { method: 'MOVE', headers: { Destination: renamed } });
        const moved = await fetch(renamed);
        const old = await fetch(original);
        const remove = await fetch(renamed, { method: 'DELETE' });
        const gone = await fetch(renamed);
        return {
          codes: [create.status, upload.status, download.status, move.status,
            moved.status, old.status, remove.status, gone.status],
          received: Array.from(new Uint8Array(await download.arrayBuffer())),
          moved: await moved.text(),
        };
      }, { folder, original, renamed, text });
      assert.deepEqual(result.codes, [201, 201, 200, 201, 200, 404, 200, 404]);
      assert.equal(sha256(Buffer.from(result.received)), sha256(text));
      assert.equal(result.moved, text);
      assert.equal(existsSync(join(volume, '测试 文件夹', '改名 文件.txt')), false);
      t.diagnostic('Small fixture SHA-256: ' + sha256(text));
    });

    await t.test('browser decodes PNG, displays TXT and plays WebM', async () => {
      const webm = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const drawing = canvas.getContext('2d');
        const stream = canvas.captureStream(20);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const finished = new Promise((done) => { recorder.onstop = done; });
        recorder.start();
        let frame = 0;
        const timer = setInterval(() => {
          drawing.fillStyle = frame++ % 2 ? 'red' : 'blue';
          drawing.fillRect(0, 0, 64, 64);
        }, 55);
        await new Promise((done) => setTimeout(done, 800));
        clearInterval(timer);
        recorder.stop();
        await finished;
        stream.getTracks().forEach((track) => track.stop());
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      });
      writeFileSync(join(volume, 'clip.webm'), Buffer.from(webm));
      await page.goto(base + '/image.png');
      await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
      await page.goto(base + '/note.txt');
      assert.match(await page.locator('body').innerText(), /Plan 002: browser file operations/);
      await page.goto(base + '/clip.webm');
      await page.locator('video').evaluate((video) => { video.muted = true; });
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.15);
    });

    await t.test('restart only copyparty and recheck listing, authenticated fixture and anonymous rejection', async () => {
      await stopBackend(backend);
      assert.equal(await fetch(upstream).then(() => true, () => false), false);
      backend = await startBackend(backendOptions);
      await page.goto(base + '/');
      assert.equal(await page.getByRole('link', { name: 'note.txt', exact: true }).count(), 1);
      const received = await page.request.get(base + '/note.txt');
      assert.equal(received.status(), 200);
      assert.equal(sha256(await received.body()), sha256(text));
      assert.equal((await fetch(base + '/note.txt')).status, 401);
    });

    await t.test('Windows TCP reports only an IPv4 loopback listener on the backend port', () => {
      const report = spawnSync('netstat.exe', ['-ano'], { encoding: 'utf8' });
      assert.equal(report.status, 0, report.stderr);
      const rows = report.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/));
      const endpoints = rows.filter((row) => row[0] === 'TCP'
        && ['0.0.0.0:0', '[::]:0'].includes(row[2]) && row[1].endsWith(':' + port))
        .map((row) => row[1]);
      assert.deepEqual(endpoints, [host + ':' + port]);
    });

    if (process.env.PLAN002_LAN_IP) {
      await t.test('Debian WSL2 can reach the loopback control and cannot reach WLAN address', () => {
        const check = (url) => spawnSync('wsl.exe', [
          '-d', 'Debian', '--exec', '/usr/bin/curl', '--noproxy', '*', '-so', '/dev/null',
          '-w', '%{http_code}', '--connect-timeout', '2', '--max-time', '4', url,
        ], { encoding: 'utf8', timeout: 18000 });
        const loopback = check(upstream + '/note.txt');
        assert.equal(loopback.status, 0, String(loopback.error ?? loopback.stderr));
        assert.match(loopback.stdout, /^4\d\d$/);
        const wlan = check('http://' + process.env.PLAN002_LAN_IP + ':' + port + '/note.txt');
        assert.ok([7, 28].includes(wlan.status), wlan.stderr + wlan.stdout);
        assert.equal(wlan.stdout, '000');
      });
    }
    t.diagnostic('copyparty TCP listener: ' + host + ':' + port);
  } finally {
    await browser?.close();
    await proxy?.close();
    await stopBackend(backend);
    rmSync(run, { recursive: true, force: true });
  }
});
