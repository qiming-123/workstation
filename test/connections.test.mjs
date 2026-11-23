import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

const presetsUrl = '/api/connections/actions';
const preset = { name: '打开开发目录', distribution: 'Debian', path: '/home/liu/workspace' };

async function start(t, actionsPath, vscodePath) {
  const { registerConnections } = await import('../server/connections.mjs');
  const app = Fastify();
  t.after(() => app.close());
  await app.register(registerConnections, { actionsPath, vscodePath });
  return app;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workstation-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'connections.json');
}

function request(app, method, url, payload) {
  return app.inject({ method, url, payload });
}

test('reloads saved presets and keeps deleted IDs unavailable after restart', async (t) => {
  const actionsPath = await fixture(t);
  const app = await start(t, actionsPath);
  assert.deepEqual((await request(app, 'GET', '/api/connections')).json(), {
    actions: [], clientTarget: null, clientUri: null,
  });
  const created = await request(app, 'POST', presetsUrl, preset);
  assert.equal(created.statusCode, 201);
  const action = created.json();
  assert.deepEqual(action, { id: action.id, ...preset });
  assert.match(action.id, /^[0-9a-f-]{36}$/);
  await app.close();

  const reloaded = await start(t, actionsPath);
  assert.deepEqual((await request(reloaded, 'GET', '/api/connections')).json().actions, [action]);
  assert.equal((await request(reloaded, 'DELETE', `${presetsUrl}/${action.id}`)).statusCode, 204);
  const afterDelete = await start(t, actionsPath);
  assert.deepEqual((await request(afterDelete, 'GET', '/api/connections')).json().actions, []);
  assert.equal((await request(afterDelete, 'POST', `${presetsUrl}/${action.id}/run`)).statusCode, 404);
});

test('accepts only the built-in preset fields and valid absolute WSL targets', async (t) => {
  const app = await start(t, await fixture(t));
  for (const invalid of [
    { ...preset, command: 'not a preset field' },
    { ...preset, distribution: '--other' },
    { ...preset, distribution: 'Debian/path' },
    { ...preset, distribution: 'Debian\n' },
    { ...preset, path: 'home/liu' },
    { ...preset, path: '/home/../liu' },
    { ...preset, path: '/home/./liu' },
    { ...preset, path: '/home/liu\\folder' },
    { ...preset, path: '/home/liu\u0000' },
    { ...preset, path: '/home/liu\uD800' },
    { ...preset, name: '   ' },
  ]) {
    assert.equal((await request(app, 'POST', presetsUrl, invalid)).statusCode, 400);
  }
  assert.deepEqual((await request(app, 'GET', '/api/connections')).json().actions, []);
});

test('saves a current-device target independently and URI-encodes WSL folder paths', async (t) => {
  const actionsPath = await fixture(t);
  const app = await start(t, actionsPath);
  const created = await request(app, 'POST', presetsUrl, preset);
  assert.equal(created.statusCode, 201);
  const clientTarget = { distribution: 'Ubuntu-24.04', path: '/home/liu/项目 #1.folder' };
  const clientUri = 'vscode://vscode-remote/wsl+Ubuntu-24.04/home/liu/%E9%A1%B9%E7%9B%AE%20%231.folder/';
  const response = await request(app, 'PUT', '/api/connections/client', clientTarget);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { clientTarget, clientUri });
  await app.close();
  const reloaded = await start(t, actionsPath);
  assert.deepEqual((await request(reloaded, 'GET', '/api/connections')).json(), {
    actions: [created.json()], clientTarget, clientUri,
  });
});

test('rejects launch overrides and reports an unavailable host launcher', async (t) => {
  const actionsPath = await fixture(t);
  const app = await start(t, actionsPath);
  const { id } = (await request(app, 'POST', presetsUrl, preset)).json();
  assert.equal((await request(app, 'POST', `${presetsUrl}/${id}/run`, { path: '/etc' })).statusCode, 400);
  assert.equal((await request(app, 'POST', `${presetsUrl}/${id}/run`, {})).statusCode, 400);
  assert.equal((await request(app, 'POST', `${presetsUrl}/${id}/run`)).statusCode, 503);
  assert.equal((await request(app, 'POST', `${presetsUrl}/00000000-0000-0000-0000-000000000000/run`)).statusCode, 404);
});

test('keeps the previous state on a failed atomic replacement and can save again', async (t) => {
  const actionsPath = await fixture(t);
  const app = await start(t, actionsPath);
  const { id } = (await request(app, 'POST', presetsUrl, preset)).json();
  const previous = await readFile(actionsPath, 'utf8');
  const backup = `${actionsPath}.backup`;
  await rename(actionsPath, backup);
  await mkdir(actionsPath);

  const failed = await request(app, 'DELETE', `${presetsUrl}/${id}`);
  assert.equal(failed.statusCode, 500);
  assert.deepEqual((await request(app, 'GET', '/api/connections')).json().actions, [{ id, ...preset }]);
  assert.equal(await readFile(backup, 'utf8'), previous);
  assert.deepEqual((await readdir(join(actionsPath, '..'))).sort(), ['connections.json', 'connections.json.backup']);

  await rm(actionsPath, { recursive: true });
  await rename(backup, actionsPath);
  assert.equal((await request(app, 'DELETE', `${presetsUrl}/${id}`)).statusCode, 204);
});

test('retains both concurrently saved actions', async (t) => {
  const actionsPath = await fixture(t);
  const app = await start(t, actionsPath);
  const operations = await Promise.all([
    request(app, 'POST', presetsUrl, preset),
    request(app, 'POST', presetsUrl, { ...preset, name: '打开文档目录', path: '/home/liu/docs' }),
  ]);
  assert.deepEqual(operations.map((result) => result.statusCode), [201, 201]);
  const afterRestart = await start(t, actionsPath);
  const { actions } = (await request(afterRestart, 'GET', '/api/connections')).json();
  assert.deepEqual(actions.map((action) => action.name).sort(), ['打开文档目录', '打开开发目录'].sort());
});

test('refuses an invalid configuration instead of silently replacing it with an empty list', async (t) => {
  const actionsPath = await fixture(t);
  const original = '{"version":1,"actions":[{"command":"unexpected"}],"clientTarget":null}';
  await writeFile(actionsPath, original);
  await assert.rejects(start(t, actionsPath), /预设动作配置无效/);
  assert.equal(await readFile(actionsPath, 'utf8'), original);
});

test('the application protects stored action launches with session and origin checks', async (t) => {
  const { buildApp } = await import('../server/app.mjs');
  const { hashPassword } = await import('../server/config.mjs');
  const origin = 'http://127.0.0.1:39106';
  const credentials = { username: 'owner', password: 'synthetic plan 006 password' };
  const app = await buildApp({
    actionsPath: await fixture(t),
    username: credentials.username,
    passwordHash: await hashPassword(credentials.password),
    cookieSecret: randomBytes(32).toString('hex'),
    publicOrigin: origin,
  });
  t.after(() => app.close());

  const login = await app.inject({ method: 'POST', url: '/api/login', payload: credentials, headers: { origin } });
  assert.equal(login.statusCode, 204);
  const cookie = login.headers['set-cookie'].split(';')[0];
  const create = await app.inject({ method: 'POST', url: presetsUrl, payload: preset, headers: { origin, cookie } });
  assert.equal(create.statusCode, 201);
  const { id } = create.json();
  const url = `${presetsUrl}/${id}/run`;

  for (const [headers, status] of [
    [{ origin }, 401],
    [{ origin, cookie: cookie + 'tampered' }, 401],
    [{ origin: 'http://127.0.0.1:39107', cookie }, 403],
    [{ origin, cookie }, 503],
  ]) {
    assert.equal((await app.inject({ method: 'POST', url, headers })).statusCode, status);
  }
});
