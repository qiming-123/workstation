import httpProxy from '@fastify/http-proxy';

const storage = '/storage';
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'MKCOL', 'MOVE'];
const requestHeaders = [
  'accept', 'accept-encoding', 'content-length', 'content-type', 'destination',
  'if-match', 'if-modified-since', 'if-none-match', 'if-range', 'if-unmodified-since',
  'origin', 'overwrite', 'range', 'referer', 'user-agent',
  'x-up2k-hash', 'x-up2k-subc', 'x-up2k-wark',
];
const responseHeaders = [
  'accept-ranges', 'content-disposition', 'content-encoding', 'content-length',
  'content-range', 'content-security-policy', 'content-type', 'etag', 'last-modified',
  'retry-after', 'vary',
];
const unavailable = '文件服务暂时无法连接。请在 Windows 主机上启动文件服务后重试。';

function selectHeaders(source, allowlist) {
  return Object.fromEntries(
    allowlist.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]),
  );
}

function safeLocation(location, request, origin) {
  if (!location) return;
  let target;
  try {
    target = new URL(location, new URL(request.raw.url, origin));
  } catch {
    return;
  }
  if (target.origin === origin.origin &&
      (target.pathname === storage || target.pathname.startsWith(storage + '/'))) {
    return target.pathname + target.search + target.hash;
  }
}

function responseForBrowser(headers, request, origin) {
  const result = selectHeaders(headers, responseHeaders);
  const location = safeLocation(headers.location, request, origin);
  if (location) result.location = location;
  result['cache-control'] = 'private, no-store';
  result['referrer-policy'] = 'same-origin';
  result['x-content-type-options'] = 'nosniff';
  result['x-frame-options'] = 'SAMEORIGIN';
  result['cross-origin-resource-policy'] = 'same-origin';

  const csp = result['content-security-policy'];
  const framePolicy = "frame-ancestors 'self'; object-src 'none'; base-uri 'none'";
  const mime = result['content-type']?.split(';', 1)[0].toLowerCase();
  const pathname = new URL(request.raw.url, origin).pathname;
  // Only copyparty's bundled assets and nonce-bearing UI can run code here.
  const builtInAsset = /^\/storage\/\.cpr\/w\/(?:[a-z0-9-]+\/)*[a-z0-9][a-z0-9._-]*$/i.test(pathname);
  const builtInPage = mime === 'text/html' && /'nonce-[^']+'/.test(csp || '');
  if (!builtInPage && !builtInAsset) {
    result['content-security-policy'] = framePolicy + "; script-src 'none'; sandbox";
    if (mime && /html|javascript|ecmascript|css|xml|wasm|pdf/.test(mime)) {
      result['content-type'] = 'application/octet-stream';
      result['content-disposition'] ??= 'attachment';
    }
  } else {
    result['content-security-policy'] = csp ? csp + ', ' + framePolicy : framePolicy;
  }
  return result;
}

export async function registerFiles(app, { fileBackend, publicOrigin }) {
  if (!fileBackend) {
    app.get(storage, (_, reply) => reply.code(503).type('text/plain; charset=utf-8').send(unavailable));
    app.get(storage + '/*', (_, reply) => reply.code(503).type('text/plain; charset=utf-8').send(unavailable));
    return;
  }

  const origin = new URL(publicOrigin);
  const authorization = 'Basic ' + Buffer.from('workstation:' + fileBackend.password).toString('base64');
  await app.register(httpProxy, {
    upstream: fileBackend.origin,
    prefix: storage,
    rewritePrefix: storage,
    httpMethods: methods,
    internalRewriteLocationHeader: false,
    preHandler: async (request, reply) => {
      const query = new URL(request.raw.url, origin).searchParams;
      const forbidden = ['edit', 'edit2', 'mime', 'pw'];
      if (request.headers['service-worker'] ||
          [...query.keys()].some((name) => forbidden.includes(name.toLowerCase()))) {
        return reply.code(400).send({ error: '文件服务不支持此操作。' });
      }
    },
    replyOptions: {
      timeout: 120_000,
      rewriteRequestHeaders: (request, headers) => ({
        ...selectHeaders(headers, requestHeaders),
        authorization,
        'x-forwarded-for': request.raw.socket.remoteAddress || '127.0.0.1',
        'x-forwarded-host': origin.host,
        'x-forwarded-proto': origin.protocol.slice(0, -1),
      }),
      rewriteHeaders: (headers, request) => responseForBrowser(headers, request, origin),
      onError: (reply) => reply.code(502).type('text/plain; charset=utf-8').send(unavailable),
    },
  });
}
