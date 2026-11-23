import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerFiles } from '../server/files.mjs';

test('the authenticated storage proxy keeps backend and workstation credentials separate', async (t) => {
  const received = [];
  const upstream = createServer((request, response) => {
    received.push({ path: request.url, headers: request.headers });
    response.writeHead(206, {
      'Content-Type': 'text/plain',
      'Content-Range': 'bytes 2-4/5',
      'Accept-Ranges': 'bytes',
      'Set-Cookie': 'cppwd=private',
      'WWW-Authenticate': 'Basic realm="backend"',
      'Access-Control-Allow-Origin': '*',
      'Service-Worker-Allowed': '/',
    });
    response.end('cde');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise((done) => upstream.close(done)));

  const app = Fastify();
  t.after(() => app.close());
  app.addHttpMethod('MKCOL');
  app.addHttpMethod('MOVE');
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      if (request.headers.cookie !== 'workstation=session') {
        return reply.code(401).send('Sign in');
      }
    });
    await registerFiles(scope, {
      publicOrigin: 'https://files.example.test',
      fileBackend: {
        origin: 'http://127.0.0.1:' + upstream.address().port,
        password: 'internal-password-for-test',
      },
    });
  });

  const denied = await app.inject({ url: '/storage/C/note.txt' });
  assert.equal(denied.statusCode, 401);
  assert.equal(received.length, 0);

  const file = await app.inject({
    url: '/storage/C/note.txt',
    headers: {
      cookie: 'workstation=session',
      authorization: 'Basic untrusted',
      pw: 'untrusted',
      'x-forwarded-for': '192.0.2.10',
      'x-forwarded-host': 'untrusted.example',
      range: 'bytes=2-',
    },
  });
  assert.equal(file.statusCode, 206);
  assert.equal(file.body, 'cde');
  assert.equal(file.headers['content-range'], 'bytes 2-4/5');
  assert.equal(file.headers['accept-ranges'], 'bytes');
  assert.match(file.headers['cache-control'], /no-store/);
  for (const key of ['set-cookie', 'www-authenticate', 'access-control-allow-origin', 'service-worker-allowed']) {
    assert.equal(file.headers[key], undefined, key);
  }
  assert.equal(received.length, 1);
  assert.equal(received[0].path, '/storage/C/note.txt');
  assert.equal(received[0].headers.range, 'bytes=2-');
  assert.equal(received[0].headers.authorization,
    'Basic ' + Buffer.from('workstation:internal-password-for-test').toString('base64'));
  assert.equal(received[0].headers.cookie, undefined);
  assert.equal(received[0].headers.pw, undefined);
  assert.equal(received[0].headers['x-forwarded-for'], '127.0.0.1');
  assert.equal(received[0].headers['x-forwarded-host'], 'files.example.test');
  assert.equal(received[0].headers['x-forwarded-proto'], 'https');

  for (const query of ['edit', 'edit2', 'mime=text/html', 'pw=test']) {
    const response = await app.inject({
      url: '/storage/C/note.txt?' + query,
      headers: { cookie: 'workstation=session' },
    });
    assert.equal(response.statusCode, 400, query);
  }
  assert.equal(received.length, 1);
});

test('a deployment without a file backend responds with a useful unavailable status', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  await registerFiles(app, {});
  const response = await app.inject({ url: '/storage/' });
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /文件服务/);
});
