import { resolve } from 'node:path';
import { buildApp } from './app.mjs';
import { loadConfig } from './config.mjs';

try {
  const config = await loadConfig(resolve(process.env.WORKSTATION_CONFIG || 'config.json'));
  const app = await buildApp(config);
  const address = await app.listen({ host: '127.0.0.1', port: config.port });
  console.log('workstation：' + address);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await app.close(); });
  }
} catch (error) {
  console.error(error.message.startsWith('配置无效') || error.message === '无法读取配置 JSON'
    ? error.message : 'workstation 启动失败，请检查监听端口及配置');
  process.exitCode = 1;
}
