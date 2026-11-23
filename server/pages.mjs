function document(title, body, assets = '') {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · workstation</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" type="module"></script>${assets}
</head><body>${body}</body></html>`;
}

export function loginPage() {
  return document('登录', `<main class="login-wrap"><div class="panel login-card">
    <div class="mark" aria-hidden="true">⌘</div>
    <h1>workstation</h1>
    <form id="login" class="stack" method="post" action="/api/login">
      <label for="username">账号</label>
      <input id="username" name="username" autocomplete="username" required maxlength="128">
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
      <button class="button" type="submit">登录</button>
      <p class="status" role="status"></p>
    </form>
  </div></main>`);
}

const pages = { files: '文件', connect: '连接', settings: '设置' };

export function workspacePage(page) {
  const name = pages[page];
  const links = Object.entries(pages).map(([path, label]) =>
    `<a href="/${path}"${path === page ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const content = page === 'files'
    ? '<iframe src="/storage/" class="files-frame" title="文件管理"></iframe>'
    : `<section id="connections" data-page="${page}" aria-label="${name}"></section>`;
  const assets = page === 'files' ? ''
    : '<script src="/assets/connections.js" type="module"></script>';
  return document(name, `<div class="workspace">
    <aside class="sidebar" aria-label="工作区"><div class="brand"><span class="mark" aria-hidden="true">⌘</span>workstation</div>
      <nav aria-label="主导航">${links}</nav>
      <form id="logout" method="post" action="/api/logout"><button class="logout" type="submit">退出登录</button><p class="status" role="status"></p></form>
    </aside>
    <main class="page"><h1>${name}</h1>${content}</main>
  </div>`, assets);
}

export function sendPage(reply, html) {
  return reply
    .header('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    .header('Referrer-Policy', 'same-origin')
    .type('text/html; charset=utf-8')
    .send(html);
}
