import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { hashPassword } from '../server/config.mjs';

test('Edge signs in and out at desktop and phone widths', async (t) => {
  const username = 'browser-test';
  const password = randomBytes(24).toString('hex');
  const port = randomInt(23000, 42000);
  const publicOrigin = 'http://127.0.0.1:' + port;
  let now = Date.now();
  const app = await buildApp({
    username, passwordHash: await hashPassword(password),
    cookieSecret: randomBytes(32).toString('hex'), publicOrigin,
  }, { includeFeatures: false, now: () => now });
  await app.listen({ host: '127.0.0.1', port });
  t.after(() => app.close());
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  await t.test('the login form sends credentials in a POST when JavaScript is disabled', async () => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(publicOrigin + '/login');
    await page.getByLabel('账号').fill(username);
    await page.getByLabel('密码').fill(password);
    const [submitted] = await Promise.all([
      page.waitForRequest((request) => request.isNavigationRequest() && request.frame() === page.mainFrame()),
      page.getByRole('button', { name: '登录', exact: true }).click(),
    ]);
    await page.close();
    assert.equal(submitted.method(), 'POST');
    assert.equal(submitted.url(), publicOrigin + '/api/login');
  });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(publicOrigin + '/settings');
    await page.waitForURL(publicOrigin + '/login');
    await page.getByLabel('账号').fill(username);
    await page.getByLabel('密码').fill('wrong');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '账号或密码错误' }).waitFor();
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(publicOrigin + '/files');
    assert.equal(await page.getByRole('heading', { name: '文件', exact: true }).count(), 1);
    await page.reload();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '连接' }).click();
    await page.waitForURL(publicOrigin + '/connect');
    assert.equal(await page.getByRole('heading', { name: '连接', exact: true }).count(), 1);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL(publicOrigin + '/login');
    await page.goto(publicOrigin + '/files');
    await page.waitForURL(publicOrigin + '/login');
    await page.getByLabel('账号').fill(username);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(publicOrigin + '/files');
    now += 9 * 60 * 60 * 1000;
    await page.reload();
    await page.waitForURL(publicOrigin + '/login');
    await page.close();
  }
});
