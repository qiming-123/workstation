import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashPassword } from '../server/config.mjs';

const username = process.argv[2];
if (!username?.trim() || username.length > 128) {
  console.error('用法：npm run init -- 你的账号');
  process.exitCode = 1;
} else {
  const password = randomBytes(24).toString('base64url');
  const config = {
    username, passwordHash: await hashPassword(password),
    cookieSecret: randomBytes(32).toString('hex'),
    publicOrigin: 'http://127.0.0.1:32100', port: 32100, vscodePath: null,
    fileBackend: {
      origin: 'http://127.0.0.1:32101', password: randomBytes(32).toString('hex'),
    },
  };
  try {
    await writeFile(resolve(process.env.WORKSTATION_CONFIG || 'config.json'),
      JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('已生成本机配置。请保存这次显示的登录密码：' + password);
  } catch {
    console.error('无法创建配置。请确认目标文件不存在且目录可写。');
    process.exitCode = 1;
  }
}
