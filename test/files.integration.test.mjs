import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { hashPassword } from '../server/config.mjs';

const enabled = process.platform === 'win32' && process.env.WORKSTATION_FILES_TEST === '1';
const largeEnabled = process.env.WORKSTATION_FILES_LARGE_TEST === '1';
const host = '127.0.0.1';
const note = '文件服务预览';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=',
  'base64',
);

async function freeOrigin(exclude) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = randomInt(20_000, 45_000);
    const origin = 'http://' + host + ':' + port;
    if (origin === exclude) continue;
    const server = createServer().listen(port, host);
    try {
      await once(server, 'listening');
    } catch (error) {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') continue;
      throw error;
    }
    await new Promise((done) => server.close(done));
    return origin;
  }
  throw new Error('No high port was available for the browser fixture.');
}

async function login(page, origin, password) {
  await page.goto(origin + '/files');
  await page.getByLabel('账号').fill('owner');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(origin + '/files');
}

async function recordVideo(page) {
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
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
    await new Promise((done) => setTimeout(done, 1600));
    clearInterval(timer);
    recorder.stop();
    await finished;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  }));
}

async function stopProcessTree(child) {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close');
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    await closed;
  }
}

async function waitForBackend(child, fileBackend, diagnostics) {
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    try {
      const response = await fetch(fileBackend.origin + '/storage/C/note.txt', {
        headers: {
          Authorization: 'Basic ' + Buffer.from('workstation:' + fileBackend.password).toString('base64'),
          'X-Forwarded-For': host,
          'X-Forwarded-Host': new URL(fileBackend.origin).host,
          'X-Forwarded-Proto': 'http',
        },
        signal: AbortSignal.timeout(250),
      });
      if (response.ok && (await response.text()) === note) return;
    } catch {
      // The child may still be starting.
    }
    await delay(100);
  }
  throw new Error('copyparty could not serve the test fixture.\n' + diagnostics());
}

function nextBackendOutput(child) {
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { logs = (logs + chunk).slice(-2000); });
  }
  child.on('error', (error) => { logs += error.message; });
  return () => logs;
}

async function prepareLargeFile(path, size) {
  const file = await open(path, 'w');
  const sha = createHash('sha256');
  // Vary each MiB to keep every up2k chunk distinct.
  const part = randomBytes(1024 * 1024);
  try {
    for (let offset = 0; offset < size; offset += part.length) {
      part.writeUInt32LE(offset / part.length);
      await file.writeFile(part);
      sha.update(part);
    }
  } finally {
    await file.close();
  }
  return sha.digest('hex');
}

async function waitForUpload(path, bytes, timeout) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path) || (await stat(path)).size !== bytes) {
    if (Date.now() >= deadline) throw new Error('The resumed upload did not complete.');
    await delay(250);
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}

async function resumeDownload(url, cookie, size) {
  const download = new AbortController();
  const first = await fetch(url, { headers: { Cookie: cookie }, signal: download.signal });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(first.headers.get('content-length')), size);
  const hash = createHash('sha256');
  const reader = first.body.getReader();
  let received = 0;
  while (received < 64 * 1024 * 1024) {
    const { done, value } = await reader.read();
    assert.equal(done, false);
    hash.update(value);
    received += value.byteLength;
  }
  download.abort();
  const offset = received;
  const second = await fetch(url, {
    headers: {
      Cookie: cookie,
      Range: 'bytes=' + offset + '-',
      'If-Range': first.headers.get('etag') || first.headers.get('last-modified'),
    },
  });
  assert.equal(second.status, 206);
  assert.equal(second.headers.get('content-range'), 'bytes ' + offset + '-' + (size - 1) + '/' + size);
  for await (const part of second.body) {
    hash.update(part);
    received += part.byteLength;
  }
  assert.equal(received, size);
  return { offset, sha256: hash.digest('hex') };
}

test('Windows copyparty serves file operations through the workstation login', {
  skip: !enabled,
  timeout: 600_000,
}, async (t) => {
  const run = await mkdtemp(join(tmpdir(), 'workstation-files-'));
  let child;
  let browser;
  let app;
  t.after(async () => {
    await browser?.close();
    await stopProcessTree(child);
    app?.server.closeAllConnections();
    await app?.close();
    await rm(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  });
  const volume = join(run, 'fixture');
  const second = join(run, 'another-volume');
  await mkdir(volume);
  await mkdir(second);
  await writeFile(join(volume, 'image.png'), png);
  await writeFile(join(volume, 'note.txt'), note);
  await writeFile(join(volume, 'sample.html'), '<!doctype html><title>Local fixture</title>');
  await writeFile(join(volume, 'sample.js'), '/* Local fixture */');
  await writeFile(join(second, 'second.txt'), 'Second mount');

  const publicOrigin = await freeOrigin();
  const fileBackend = { origin: await freeOrigin(publicOrigin), password: randomBytes(32).toString('hex') };
  const backendConfig = join(run, 'config.json');
  await writeFile(backendConfig, JSON.stringify({ fileBackend }));
  const launcher = fileURLToPath(new URL('../tools/start-files.ps1', import.meta.url));
  child = spawn('powershell.exe', [
    '-NoProfile', '-File', launcher, '-ConfigPath', backendConfig,
    '-Python', process.env.WORKSTATION_FILES_PYTHON || 'python',
    '-StateDirectory', join(run, 'state'), '-TestVolumeRoot', volume, '-TestSecondVolumeRoot', second,
  ], { windowsHide: true });
  const diagnostics = nextBackendOutput(child);
  if (process.env.WORKSTATION_FILES_DEBUG === '1') {
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  }
  await waitForBackend(child, fileBackend, diagnostics);

  const password = randomBytes(24).toString('hex');
  app = await buildApp({
    publicOrigin, fileBackend, username: 'owner', passwordHash: await hashPassword(password),
    cookieSecret: randomBytes(32).toString('hex'), actionsPath: join(run, 'actions.json'),
    vscodePath: null,
  });
  await app.listen({ host, port: Number(new URL(publicOrigin).port) });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const desktop = await browser.newContext();
  const page = await desktop.newPage();
  page.setDefaultTimeout(15_000);
  const folder = '/storage/C/';
  const fileUrl = (file) => publicOrigin + folder + encodeURIComponent(file);
  const fileFrame = page.frameLocator('iframe[title="文件管理"]');

  await t.test('require a workstation session for the file, preview, assets and writes', async () => {
    for (const path of [folder, folder + 'note.txt', folder + 'image.png', '/storage/.cpr/w/browser.js']) {
      assert.equal((await fetch(publicOrigin + path)).status, 401, path);
    }
    assert.equal((await fetch(fileUrl('denied.txt'), { method: 'PUT', body: note })).status, 401);
    assert.equal(existsSync(join(volume, 'denied.txt')), false);
    assert.ok((await fetch(fileBackend.origin + folder + 'note.txt')).status >= 400);
  });

  await t.test('navigate both disks in the file workspace', async () => {
    await login(page, publicOrigin, password);
    await fileFrame.locator('a[href="/storage/D/"]').first().click();
    await fileFrame.getByRole('link', { name: 'second.txt', exact: true }).waitFor();
    const denied = await page.evaluate(async () =>
      (await fetch('/storage/D/denied.txt', { method: 'PUT', body: 'denied' })).status);
    assert.ok(denied === 401 || denied === 403);
    assert.equal(existsSync(join(second, 'denied.txt')), false);
    await page.reload();
    await fileFrame.locator('a[href="/storage/C/"]').first().click();
    await fileFrame.getByRole('link', { name: 'note.txt', exact: true }).waitFor();
    const cookie = (await desktop.cookies()).find(({ name }) => name === 'workstation_session');
    assert.ok(cookie?.httpOnly);
    assert.equal((await desktop.cookies()).length, 1);
    const response = await page.request.get(publicOrigin + folder);
    assert.doesNotMatch(await response.text(), new RegExp(fileBackend.password));
  });

  await t.test('create, upload, download, rename and delete Chinese filenames and report collisions', async () => {
    const directory = folder + encodeURIComponent('测试 文件夹') + '/';
    const original = directory + encodeURIComponent('测试 文件.txt');
    const renamed = directory + encodeURIComponent('改名 文件.txt');
    const result = await page.evaluate(async ({ directory, original, renamed, note }) => {
      const send = async (url, options) => {
        try {
          return await fetch(url, { signal: AbortSignal.timeout(8000), ...options });
        } catch (error) {
          throw new Error((options?.method || 'GET') + ' ' + url + ' failed', { cause: error });
        }
      };
      const create = await send(directory, { method: 'MKCOL' });
      const duplicate = await send(directory, { method: 'MKCOL' });
      const upload = await send(original, { method: 'PUT', body: new Blob([note]) });
      const download = await send(original + '?dl');
      const move = await send(original, { method: 'MOVE', headers: { Destination: renamed, Overwrite: 'F' } });
      const moved = await send(renamed);
      const old = await send(original);
      const remove = await send(renamed, { method: 'DELETE' });
      const gone = await send(renamed);
      return {
        codes: [create.status, duplicate.status, upload.status, download.status, move.status,
          moved.status, old.status, remove.status, gone.status],
        downloaded: await download.text(),
        moved: await moved.text(),
      };
    }, { directory, original, renamed, note });
    assert.deepEqual(result.codes, [201, 405, 201, 200, 201, 200, 404, 200, 404]);
    assert.equal(result.downloaded, note);
    assert.equal(result.moved, note);
    assert.equal(existsSync(join(volume, '测试 文件夹', '改名 文件.txt')), false);
  });

  await t.test('preview image, text, and video with seeking while keeping local web files inert', async () => {
    await writeFile(join(volume, 'clip.webm'), await recordVideo(page));
    await page.goto(fileUrl('image.png'));
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1, null, { timeout: 10_000 });
    await page.goto(fileUrl('note.txt'));
    assert.match(await page.locator('body').innerText(), new RegExp(note));
    await page.goto(fileUrl('clip.webm'), { waitUntil: 'domcontentloaded' });
    await page.locator('video').evaluate((video) => {
      video.muted = true;
      void video.play();
      video.currentTime = 0.75;
    });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 0.75, null, { timeout: 10_000 });
    for (const name of ['sample.html', 'sample.js']) {
      const response = await page.request.get(fileUrl(name));
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-security-policy'], /script-src 'none'/);
      assert.doesNotMatch(response.headers()['content-type'], /html|javascript/);
    }
    const missing = await page.goto(fileUrl('不存在的预览.txt'));
    assert.equal(missing.status(), 404);
    assert.match(await page.locator('body').innerText(), /not found|does not exist/i);
  });

  await t.test('upload a selected file from a touch browser at 390 CSS pixels', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const narrow = await mobile.newPage();
      await login(narrow, publicOrigin, password);
      const frame = narrow.frameLocator('iframe[title="文件管理"]');
      await frame.locator('a[href="/storage/C/"]').first().click();
      await frame.getByRole('link', { name: 'note.txt', exact: true }).waitFor();
      await frame.locator('#ops [data-dest="bup"]').click();
      const form = frame.locator('#op_bup form');
      await form.locator('input[type=file]').setInputFiles({
        name: '手机 样本.txt', mimeType: 'text/plain', buffer: Buffer.from(note),
      });
      await form.getByRole('button', { name: 'start upload' }).click();
      for (let attempt = 0; attempt < 60 && !existsSync(join(volume, '手机 样本.txt')); attempt++) {
        await delay(100);
      }
      const uploaded = await readFile(join(volume, '手机 样本.txt'));
      assert.equal(createHash('sha256').update(uploaded).digest('hex'),
        createHash('sha256').update(note).digest('hex'));
    } finally {
      await mobile.close();
    }
  });

  await t.test('resume a 2 GiB browser upload and an interrupted Range download', {
    skip: !largeEnabled,
    timeout: 420_000,
  }, async (large) => {
    const size = 2 * 1024 ** 3;
    const name = '续传 样本.bin';
    const source = join(run, name);
    const uploaded = join(volume, name);
    const expected = await prepareLargeFile(source, size);
    const openUploader = async () => {
      await page.goto(publicOrigin + '/files');
      await fileFrame.locator('a[href="/storage/C/"]').first().click();
      await fileFrame.locator('#ops [data-dest="up2k"]').click();
      return fileFrame.locator('#op_up2k input[type="file"]:not([webkitdirectory])').first();
    };
    const firstInput = await openUploader();
    const isHandshake = (response) => {
      const request = response.request();
      return request.method() === 'POST' && request.url().includes('/storage/C/') &&
        !request.headers()['x-up2k-hash'] && response.ok() &&
        request.postDataJSON()?.name === name;
    };
    const firstHandshake = page.waitForResponse(isHandshake, { timeout: 120_000 });
    const firstChunk = page.waitForResponse((response) =>
      response.ok() && response.request().headers()['x-up2k-hash'], { timeout: 120_000 });
    await firstInput.setInputFiles(source);
    await fileFrame.locator('#modal-ok').click();
    const all = await (await firstHandshake).json();
    await firstChunk;
    await desktop.setOffline(true);
    page.once('dialog', (dialog) => dialog.accept());
    await page.goto('about:blank');
    await desktop.setOffline(false);
    assert.ok(!existsSync(uploaded) || (await stat(uploaded)).size < size);

    const resumedInput = await openUploader();
    const resumeHandshake = page.waitForResponse(isHandshake, { timeout: 120_000 });
    await resumedInput.setInputFiles(source);
    await fileFrame.locator('#modal-ok').click();
    const remaining = await (await resumeHandshake).json();
    assert.ok(remaining.hash.length > 0 && remaining.hash.length < all.hash.length);
    const alreadyStored = (all.hash.length - remaining.hash.length) * (size / all.hash.length);
    await waitForUpload(uploaded, size, 150_000);
    assert.equal((await stat(uploaded)).size, size);
    assert.equal(await hashFile(uploaded), expected);
    large.diagnostic('Upload resumed after ' + alreadyStored + ' committed bytes.');

    const session = (await desktop.cookies()).find(({ name }) => name === 'workstation_session');
    const download = await resumeDownload(fileUrl(name) + '?dl', session.name + '=' + session.value, size);
    assert.equal(download.sha256, expected);
    large.diagnostic('Download resumed at byte ' + download.offset + '. Size ' + size + '. SHA-256 ' + expected);
  });
});
