const login = document.querySelector('#login');
const logout = document.querySelector('#logout');

async function send(form, endpoint, payload) {
  const button = form.querySelector('button');
  const status = form.querySelector('[role=status]');
  button.disabled = true;
  status.textContent = '';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      ...(payload ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      } : {}),
    });
    if (response.ok || (endpoint === '/api/logout' && response.status === 401)) {
      location.assign(endpoint === '/api/login' ? '/files' : '/login');
      return;
    }
    const result = await response.json();
    status.textContent = result.error ?? '请求失败，请重试';
  } catch {
    status.textContent = '无法连接到 workstation，请重试';
  } finally {
    button.disabled = false;
  }
}

login?.addEventListener('submit', (event) => {
  event.preventDefault();
  send(login, '/api/login', Object.fromEntries(new FormData(login)));
});

logout?.addEventListener('submit', (event) => {
  event.preventDefault();
  send(logout, '/api/logout');
});
