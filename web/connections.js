const root = document.querySelector('#connections');
const settingsUrl = '/api/connections';
const actionsUrl = `${settingsUrl}/actions`;

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function button(text, type = 'button') {
  const control = element('button', text, 'button');
  control.type = type;
  return control;
}

function link(text, href) {
  const anchor = element('a', text, 'button');
  anchor.href = href;
  return anchor;
}

function panel(title, description) {
  const section = element('section', '', 'panel stack');
  section.append(element('h2', title), element('p', description, 'muted'));
  return section;
}

function feedback() {
  const status = element('p', '', 'status');
  status.setAttribute('role', 'status');
  return status;
}

async function send(url, method = 'GET', data) {
  const options = { method };
  if (data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || detail.error || '请求失败，请重试。');
  }
  if (response.status !== 204) return response.json();
}

async function perform(control, status, operation) {
  control.disabled = true;
  status.textContent = '';
  try {
    await operation();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    control.disabled = false;
  }
}

function describeTarget(target) {
  return `${target.distribution} · ${target.path}`;
}

function actionRow(action, control, status) {
  const row = element('li', '', 'stack');
  row.append(element('strong', action.name), element('p', describeTarget(action), 'muted'), control, status);
  return row;
}

async function downloadRdp(status) {
  const response = await fetch('/api/rdp');
  if (response.status === 503) throw new Error('远程桌面尚未接入。');
  if (response.status === 401 || response.redirected) throw new Error('请先登录。');
  if (!response.ok) throw new Error('无法下载远程桌面连接文件，请重试。');
  const url = URL.createObjectURL(await response.blob());
  const download = document.createElement('a');
  download.href = url;
  download.download = 'workstation.rdp';
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = '请用远程桌面客户端打开下载的连接文件。';
}

function showConnect({ actions, clientTarget, clientUri }) {
  const primaryRdp = actions.length === 0;
  const rdp = panel('远程桌面', primaryRdp ? '未配置主机预设动作时，默认使用远程桌面。' : '连接 Windows 主机桌面。');
  const rdpButton = button('连接桌面');
  const rdpStatus = feedback();
  rdpButton.addEventListener('click', () => perform(rdpButton, rdpStatus, () => downloadRdp(rdpStatus)));
  rdp.append(rdpButton, rdpStatus);

  const application = panel('VS Code (WSL)', '打开当前浏览器所在设备上的 VS Code。');
  if (clientTarget && clientUri?.startsWith('vscode://vscode-remote/wsl+')) {
    application.append(element('p', describeTarget(clientTarget), 'muted'), link('在当前设备打开', clientUri));
  } else {
    application.append(link('设置当前设备的 WSL 目标', '/settings#client-target'));
  }

  const presets = panel('主机预设动作', '在运行 workstation 的 Windows 主机上打开已配置的目标。');
  if (actions.length) {
    const list = element('ul', '', 'stack');
    for (const action of actions) {
      const run = button('在主机上运行');
      const status = feedback();
      run.addEventListener('click', () => perform(run, status, async () => {
        const result = await send(`${actionsUrl}/${action.id}/run`, 'POST');
        status.textContent = result.message;
      }));
      list.append(actionRow(action, run, status));
    }
    presets.append(list);
    root.replaceChildren(presets, rdp, application);
  } else {
    presets.append(link('添加主机预设动作', '/settings#host-presets'));
    root.replaceChildren(rdp, application, presets);
  }
}

function field(name, label, { value = '', maxLength, placeholder }) {
  const control = document.createElement('input');
  control.name = name;
  control.type = 'text';
  control.required = true;
  control.value = value;
  control.maxLength = maxLength;
  control.placeholder = placeholder;
  const wrapper = element('label', label, 'stack');
  wrapper.append(control);
  return wrapper;
}

function addTargetFields(form, { distribution, path } = {}) {
  form.append(
    field('distribution', 'WSL 发行版', { value: distribution, placeholder: 'Debian', maxLength: 80 }),
    field('path', 'WSL 文件夹绝对路径', { value: path, placeholder: '/home/your-name/projects', maxLength: 1024 }),
  );
}

function showSettings({ actions, clientTarget }) {
  const presets = panel('主机预设动作', '添加在 Windows 主机上打开 VS Code (WSL) 的预设。');
  presets.id = 'host-presets';
  const form = element('form', '', 'stack');
  form.append(field('name', '名称', { placeholder: '打开开发目录', maxLength: 80 }));
  addTargetFields(form);
  const add = button('添加预设动作', 'submit');
  const addStatus = feedback();
  form.append(add, addStatus);

  const list = element('ul', '', 'stack');
  const empty = element('p', '还没有预设动作。', 'muted');
  function appendPreset(action) {
    const remove = button('删除');
    remove.setAttribute('aria-label', `删除 ${action.name}`);
    const status = feedback();
    const row = actionRow(action, remove, status);
    remove.addEventListener('click', () => perform(remove, status, async () => {
      await send(`${actionsUrl}/${action.id}`, 'DELETE');
      row.remove();
      empty.hidden = list.childElementCount !== 0;
    }));
    list.append(row);
    empty.hidden = true;
  }
  for (const action of actions) appendPreset(action);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(add, addStatus, async () => {
      const action = await send(actionsUrl, 'POST', Object.fromEntries(new FormData(form)));
      appendPreset(action);
      form.reset();
      addStatus.textContent = '预设动作已添加。';
    });
  });
  presets.append(form, empty, list);

  const client = panel('当前设备的 VS Code (WSL)', '填写浏览器所在设备上已有的 WSL 发行版和文件夹。');
  client.id = 'client-target';
  const clientForm = element('form', '', 'stack');
  addTargetFields(clientForm, clientTarget || undefined);
  const save = button('保存当前设备目标', 'submit');
  const saveStatus = feedback();
  clientForm.append(save, saveStatus);
  clientForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(save, saveStatus, async () => {
      await send(`${settingsUrl}/client`, 'PUT', Object.fromEntries(new FormData(clientForm)));
      saveStatus.textContent = '当前设备的 WSL 目标已保存。';
    });
  });
  client.append(clientForm);
  root.replaceChildren(presets, client);
  const fragment = window.location.hash;
  if (fragment === '#host-presets' || fragment === '#client-target') {
    document.getElementById(fragment.slice(1)).scrollIntoView();
  }
}

if (root) {
  root.classList.add('stack');
  root.append(element('p', '正在读取连接设置…', 'muted'));
  try {
    const state = await send(settingsUrl);
    if (root.dataset.page === 'settings') showSettings(state);
    else showConnect(state);
  } catch (error) {
    root.replaceChildren(element('p', error.message, 'status'));
  }
}
