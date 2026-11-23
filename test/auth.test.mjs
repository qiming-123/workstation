import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/app.mjs';
import { hashPassword, loadConfig } from '../server/config.mjs';

const origin = 'http://127.0.0.1:32100';
const credentials = { username: 'owner', password: 'a test password' };

async function setup(t) {
  let now = 0;
  const app = await buildApp({
    ...credentials,
    passwordHash: await hashPassword(credentials.password),
    cookieSecret: randomBytes(32).toString('hex'),
    publicOrigin: origin,
  }, { now: () => now, sessionLifetime: 1000, includeFeatures: false });
  t.after(() => app.close());
  const post = (url, payload, headers = {}) => app.inject({
    method: 'POST', url, payload, headers: { origin, ...headers },
  });
  async function login() {
    const response = await post('/api/login', credentials);
    assert.equal(response.statusCode, 204);
    const value = response.headers['set-cookie'];
    assert.match(value, /HttpOnly/i);
    assert.match(value, /SameSite=Strict/i);
    return value.split(';')[0];
  }
  return { app, post, login, expire: () => { now = 2000; } };
}

test('missing or malformed settings fail without printing their values', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'workstation-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  await assert.rejects(loadConfig(path), /配置/);
  await writeFile(path, '{"passwordHash":"secret marker"}');
  await assert.rejects(loadConfig(path), (error) => error.message.includes('配置')
    && !error.message.includes('secret marker'));
});

test('login protects pages, APIs, and storage; authenticated users can refresh', async (t) => {
  const { app, login, post } = await setup(t);
  assert.equal((await post('/api/login', { ...credentials, password: 'wrong' })).statusCode, 401);
  for (const url of ['/files', '/settings', '/connect']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, '/login');
  }
  for (const url of ['/api/rdp', '/api/connections', '/storage/sample.txt']) {
    assert.equal((await app.inject(url)).statusCode, 401);
  }
  const cookie = await login();
  for (const url of ['/files', '/settings', '/connect', '/files']) {
    const response = await app.inject({ url, headers: { cookie } });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /退出登录/);
  }
  assert.equal((await app.inject({ url: '/api/rdp', headers: { cookie } })).statusCode, 503);
});

test('tampered, expired, and revoked sessions are denied', async (t) => {
  const { app, login, post, expire } = await setup(t);
  const cookie = await login();
  assert.equal((await app.inject({
    url: '/api/rdp', headers: { cookie: cookie + 'changed' },
  })).statusCode, 401);
  assert.equal((await post('/api/logout', undefined, { cookie })).statusCode, 204);
  assert.equal((await app.inject({ url: '/api/rdp', headers: { cookie } })).statusCode, 401);
  const expiring = await login();
  expire();
  assert.equal((await app.inject({ url: '/api/rdp', headers: { cookie: expiring } })).statusCode, 401);
});

test('other origins cannot mutate with a valid cookie', async (t) => {
  const { app, login, post } = await setup(t);
  const cookie = await login();
  assert.equal((await post('/api/logout', undefined, {
    cookie, origin: 'http://127.0.0.1:32101',
  })).statusCode, 403);
  assert.equal((await app.inject({
    url: '/storage/sample.txt', headers: { cookie, 'sec-fetch-site': 'same-site' },
  })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/rdp', headers: { cookie } })).statusCode, 503);
});
