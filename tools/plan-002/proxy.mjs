import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import httpProxy from '@fastify/http-proxy';

const sessionCookie = 'plan002_session';
const login = `<!doctype html><meta charset="utf-8"><title>Plan 002</title>
<form>
  <label>Test password <input name="password" type="password" required></label>
  <button>Sign in</button>
  <output></output>
</form>
<script>
  document.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/__probe/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: new FormData(event.target).get('password') })
    });
    if (response.ok) window.location.replace('/');
    else document.querySelector('output').textContent = 'Sign-in failed';
  });
</script>`;

function matchesPassword(attempt, password) {
  if (typeof attempt !== 'string') return false;
  const left = Buffer.from(attempt);
  const right = Buffer.from(password);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function buildProxy({ upstream, backendPassword, password, cookieKey }) {
  const app = Fastify();
  app.addHttpMethod('MKCOL');
  app.addHttpMethod('MOVE');
  await app.register(cookie, { secret: cookieKey });
  app.get('/__probe/login', async (_, reply) => reply.type('text/html').send(login));
  app.post('/__probe/login', async (request, reply) => {
    if (!matchesPassword(request.body?.password, password)) {
      return reply.code(401).send({ error: 'Invalid test password' });
    }
    return reply.setCookie(sessionCookie, 'probe-user', {
      signed: true, httpOnly: true, sameSite: 'strict', path: '/',
    }).code(204).send();
  });

  const authorization = 'Basic ' + Buffer.from('probe:' + backendPassword).toString('base64');
  await app.register(httpProxy, {
    upstream,
    httpMethods: ['DELETE', 'GET', 'HEAD', 'POST', 'PUT', 'OPTIONS', 'MKCOL', 'MOVE'],
    preHandler: async (request, reply) => {
      const value = request.cookies[sessionCookie];
      const session = value ? request.unsignCookie(value) : null;
      if (!session?.valid || session.value !== 'probe-user') {
        return reply.code(401).send({ error: 'Test login required' });
      }
    },
    replyOptions: {
      rewriteRequestHeaders: (_, { cookie, pw, ...headers }) => ({ ...headers, authorization }),
      rewriteHeaders: ({ 'set-cookie': upstreamCookie, 'www-authenticate': challenge, ...headers }) => headers,
    },
  });
  return app;
}
