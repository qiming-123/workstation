import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import cookies from '@fastify/cookie';
import { matchesPassword } from './config.mjs';
import { loginPage, sendPage, workspacePage } from './pages.mjs';

const cookieName = 'workstation_session';
const permitMissingOrigin = new Set(['GET', 'HEAD', 'OPTIONS']);
const assets = {
  'app.css': 'text/css; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'connections.js': 'text/javascript; charset=utf-8',
};

function isSameOrigin(request, publicOrigin) {
  const { origin, 'sec-fetch-site': site } = request.headers;
  if (origin && origin !== publicOrigin) return false;
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return permitMissingOrigin.has(request.method) || origin === publicOrigin || site === 'same-origin';
}

export async function buildApp(config, options = {}) {
  const { now = Date.now, sessionLifetime = 8 * 60 * 60 * 1000, includeFeatures = true } = options;
  const app = Fastify({ bodyLimit: 64 * 1024 });
  app.addHttpMethod('MKCOL');
  app.addHttpMethod('MOVE');
  await app.register(cookies, { secret: config.cookieSecret });
  app.addHook('onRequest', async (_, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  });
  app.setErrorHandler((error, _, reply) => {
    const status = Number.isInteger(error.statusCode) && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? '请求处理失败' : '请求无效' });
  });

  const sessionOptions = {
    path: '/', httpOnly: true, sameSite: 'strict', signed: true,
    secure: config.publicOrigin.startsWith('https://'),
  };
  const sessions = new Map();
  let failedAttempts = [];
  let activeLogins = 0;

  function currentSession(request) {
    const cookie = request.cookies[cookieName];
    if (!cookie) return null;
    const result = request.unsignCookie(cookie);
    if (!result.valid) return null;
    const expires = sessions.get(result.value);
    if (expires > now()) return result.value;
    sessions.delete(result.value);
    return null;
  }

  app.get('/', async (_, reply) => reply.redirect('/files', 303));
  app.get('/login', async (request, reply) => currentSession(request)
    ? reply.redirect('/files', 303) : sendPage(reply, loginPage()));
  app.get('/assets/:name', async (request, reply) => {
    const { name } = request.params;
    if (!Object.hasOwn(assets, name)) return reply.code(404).send();
    const path = new URL('../web/' + name, import.meta.url);
    return reply.type(assets[name]).send(await readFile(path));
  });
  app.post('/api/login', async (request, reply) => {
    if (!isSameOrigin(request, config.publicOrigin)) return reply.code(403).send({ error: '请求来源无效' });
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || username.length > 128
        || typeof password !== 'string' || password.length > 256) {
      return reply.code(400).send({ error: '请输入账号和密码' });
    }
    failedAttempts = failedAttempts.filter((time) => time > now() - 60_000);
    if (failedAttempts.length >= 8 || activeLogins >= 2) {
      return reply.header('Retry-After', '60').code(429).send({ error: '尝试次数过多，请稍后重试' });
    }
    activeLogins++;
    let matches;
    try {
      matches = await matchesPassword(password, config.passwordHash);
    } finally {
      activeLogins--;
    }
    if (!matches || username !== config.username) {
      failedAttempts.push(now());
      return reply.code(401).send({ error: '账号或密码错误' });
    }
    failedAttempts = [];
    const prior = currentSession(request);
    if (prior) sessions.delete(prior);
    for (const [id, expires] of sessions) {
      if (expires <= now()) sessions.delete(id);
    }
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
    const id = randomBytes(32).toString('base64url');
    sessions.set(id, now() + sessionLifetime);
    return reply.setCookie(cookieName, id, {
      ...sessionOptions, maxAge: Math.max(1, Math.floor(sessionLifetime / 1000)),
    }).code(204).send();
  });

  await app.register(async (authenticated) => {
    authenticated.addHook('onRequest', async (request, reply) => {
      const id = currentSession(request);
      const page = request.routeOptions.config?.page === true;
      if (!id) return page ? reply.redirect('/login', 303) : reply.code(401).send({ error: '请先登录' });
      if (!page && !isSameOrigin(request, config.publicOrigin)) {
        return reply.code(403).send({ error: '请求来源无效' });
      }
    });
    authenticated.post('/api/logout', async (request, reply) => {
      sessions.delete(currentSession(request));
      return reply.clearCookie(cookieName, sessionOptions).code(204).send();
    });
    for (const page of ['files', 'connect', 'settings']) {
      authenticated.get('/' + page, { config: { page: true } }, async (_, reply) =>
        sendPage(reply, workspacePage(page)));
    }
    authenticated.get('/api/rdp', async (_, reply) =>
      reply.code(503).send({ error: '远程桌面仍待计划 005 接入' }));
    if (includeFeatures) {
      const { registerFiles } = await import('./files.mjs');
      const { registerConnections } = await import('./connections.mjs');
      await registerFiles(authenticated, config);
      await registerConnections(authenticated, config);
    } else {
      authenticated.all('/storage/*', async (_, reply) => reply.code(503).send());
    }
    authenticated.all('/api/*', async (_, reply) => reply.code(404).send());
  });
  return app;
}
