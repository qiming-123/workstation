import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';

const maximumActions = 100;
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const invalidText = /[\p{Cc}\p{Cs}]/u;

function hasFields(object, fields) {
  return typeof object === 'object' && object !== null && !Array.isArray(object) &&
    Object.keys(object).length === fields.length && fields.every((field) => Object.hasOwn(object, field));
}

function validTarget({ distribution, path }) {
  return typeof distribution === 'string' && !invalidText.test(distribution) &&
    /^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(distribution) &&
    typeof path === 'string' && path.length <= 1024 && path.startsWith('/') &&
    !invalidText.test(path) && !path.includes('\\') && !path.includes('//') &&
    path.split('/').every((part) => part !== '.' && part !== '..');
}

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 80 && !invalidText.test(name);
}

function validatesState(state) {
  return hasFields(state, ['version', 'actions', 'clientTarget']) && state.version === 1 &&
    (state.clientTarget === null || (hasFields(state.clientTarget, ['distribution', 'path']) && validTarget(state.clientTarget))) &&
    Array.isArray(state.actions) && state.actions.length <= maximumActions &&
    state.actions.every((action) => hasFields(action, ['id', 'name', 'distribution', 'path']) &&
      typeof action.id === 'string' && idPattern.test(action.id) && validName(action.name) && validTarget(action)) &&
    new Set(state.actions.map((action) => action.id)).size === state.actions.length;
}

async function loadState(actionsPath) {
  let source;
  try {
    source = await readFile(actionsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, actions: [], clientTarget: null };
    throw error;
  }

  try {
    const state = JSON.parse(source);
    if (validatesState(state)) return state;
  } catch (error) {
    throw new Error('预设动作配置无效', { cause: error });
  }
  throw new Error('预设动作配置无效');
}

async function writeState(actionsPath, state) {
  await mkdir(dirname(actionsPath), { recursive: true });
  const pendingPath = `${actionsPath}.${randomUUID()}.tmp`;
  const pending = await open(pendingPath, 'wx', 0o600);
  try {
    try {
      await pending.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await pending.sync();
    } finally {
      await pending.close();
    }
    await rename(pendingPath, actionsPath);
  } catch (error) {
    await rm(pendingPath, { force: true });
    throw error;
  }
}

function encodedRemotePath({ distribution, path }) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `wsl+${distribution}${encodedPath}`;
}

function clientSettings(clientTarget) {
  if (!clientTarget) return { clientTarget, clientUri: null };
  const remotePath = encodedRemotePath(clientTarget);
  // VS Code uses the final slash to identify the target as a folder.
  const folderPath = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;
  return { clientTarget, clientUri: `vscode://vscode-remote/${folderPath}` };
}

function launchHostCode(vscodePath, action) {
  return new Promise((resolve, reject) => {
    const uri = `vscode-remote://${encodedRemotePath(action)}`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(WORKSTATION_|ELECTRON_RUN_AS_NODE$|VSCODE_IPC_HOOK_CLI$)/i.test(name)));
    const child = spawn(vscodePath, ['--new-window', '--folder-uri', uri], {
      cwd: win32.dirname(vscodePath),
      detached: true,
      env,
      shell: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function registerConnections(app, { actionsPath, vscodePath }) {
  if (vscodePath && (!/^[a-z]:[\\/]/i.test(vscodePath) || win32.basename(vscodePath).toLowerCase() !== 'code.exe')) {
    throw new Error('主机 VS Code 路径必须为 Code.exe 的绝对路径');
  }

  let state = await loadState(actionsPath);
  let writes = Promise.resolve();
  function save(change) {
    const write = writes.then(async () => {
      const next = change(state);
      if (next !== state) {
        await writeState(actionsPath, next);
        state = next;
      }
      return state;
    });
    writes = write.catch(() => {});
    return write;
  }

  function errorResponse(reply, statusCode, message) {
    return reply.code(statusCode).send({ message });
  }

  function saveError(request, reply, error) {
    request.log.error({ err: error }, 'Failed to save connections');
    return errorResponse(reply, 500, '保存失败，原有设置已保留。');
  }

  app.get('/api/connections', () => ({ actions: state.actions, ...clientSettings(state.clientTarget) }));

  app.post('/api/connections/actions', async (request, reply) => {
    const body = request.body;
    if (!hasFields(body, ['name', 'distribution', 'path']) || !validName(body.name) || !validTarget(body)) {
      return errorResponse(reply, 400, '请填写动作名称、WSL 发行版名称和有效的绝对文件夹路径。');
    }
    const action = { id: randomUUID(), name: body.name.trim(), distribution: body.distribution, path: body.path };
    try {
      const updated = await save((current) => current.actions.length >= maximumActions
        ? current
        : { ...current, actions: [...current.actions, action] });
      if (!updated.actions.includes(action)) return errorResponse(reply, 409, '预设动作已达到 100 条上限。');
      return reply.code(201).send(action);
    } catch (error) {
      return saveError(request, reply, error);
    }
  });

  app.delete('/api/connections/actions/:id', async (request, reply) => {
    const { id } = request.params;
    if (request.body !== undefined) return errorResponse(reply, 400, '删除请求只接受预设标识。');
    try {
      let deleted = false;
      await save((current) => {
        const remaining = current.actions.filter((action) => action.id !== id);
        deleted = remaining.length < current.actions.length;
        return deleted ? { ...current, actions: remaining } : current;
      });
      if (!deleted) return errorResponse(reply, 404, '找不到此预设动作。');
      return reply.code(204).send();
    } catch (error) {
      return saveError(request, reply, error);
    }
  });

  app.post('/api/connections/actions/:id/run', async (request, reply) => {
    if (request.body !== undefined) return errorResponse(reply, 400, '运行请求只接受预设标识。');
    const action = state.actions.find(({ id }) => id === request.params.id);
    if (!action) return errorResponse(reply, 404, '找不到此预设动作。');
    if (!vscodePath || process.platform !== 'win32') {
      return errorResponse(reply, 503, 'Windows 主机上的 VS Code 启动路径尚未配置。');
    }
    try {
      await launchHostCode(vscodePath, action);
      return reply.code(202).send({ message: '已向 Windows 主机发出打开请求，请在主机上确认。' });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to launch host VS Code');
      return errorResponse(reply, 502, 'Windows 主机无法启动 VS Code，请检查主机配置。');
    }
  });

  app.put('/api/connections/client', async (request, reply) => {
    const body = request.body;
    if (!hasFields(body, ['distribution', 'path']) || !validTarget(body)) {
      return errorResponse(reply, 400, '请填写 WSL 发行版名称和有效的绝对文件夹路径。');
    }
    const clientTarget = { distribution: body.distribution, path: body.path };
    try {
      await save((current) => ({ ...current, clientTarget }));
      return clientSettings(clientTarget);
    } catch (error) {
      return saveError(request, reply, error);
    }
  });
}
