let prevStats = { total_templates: null, total_renders: null };
let lastAdminHistory = [];
let lastUserList = [];

// --- Статистика ---
async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error("Не удалось получить статистику");
    const stats = await res.json();
    if (stats.total_templates !== prevStats.total_templates) {
      document.getElementById('totalTemplates').textContent = stats.total_templates;
      prevStats.total_templates = stats.total_templates;
    }
    if (stats.total_renders !== prevStats.total_renders) {
      document.getElementById('totalRenders').textContent = stats.total_renders;
      prevStats.total_renders = stats.total_renders;
    }
  } catch {
    document.getElementById('totalTemplates').textContent = '?';
    document.getElementById('totalRenders').textContent = '?';
    prevStats = { total_templates: null, total_renders: null };
  }
}

// --- Список пользователей (новое!) ---
async function loadUserList() {
  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) throw new Error("Ошибка доступа к списку пользователей");
    const users = await res.json();
    lastUserList = users;
    filterAndRenderUsers();
  } catch {
    document.getElementById('userListBody').innerHTML = `<tr><td colspan="5">Ошибка загрузки</td></tr>`;
  }
}

// Отрисовка таблицы пользователей
function renderUserList(users) {
  const tbody = document.getElementById('userListBody');
  if (!users || !users.length) {
    tbody.innerHTML = `<tr><td colspan="5">Нет пользователей</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map((u, i) => {
    let actions = [];
    if (u.status === 'blocked') {
      actions.push(`<button class="btn btn-sm btn-success unblock-user-btn" data-username="${u.username}" title="Разблокировать"><svg data-lucide="unlock" width="16" height="16"></svg></button>`);
    } else {
      actions.push(`<button class="btn btn-sm btn-warning block-user-btn" data-username="${u.username}" title="Заблокировать"><svg data-lucide="lock" width="16" height="16"></svg></button>`);
    }
    actions.push(`<button class="btn btn-sm btn-danger delete-user-btn" data-username="${u.username}" title="Удалить"><svg data-lucide="user-x" width="16" height="16"></svg></button>`);
    // Тут можно добавить "сменить пароль/логин"

    return `<tr>
      <td>${i+1}</td>
      <td>${u.username}</td>
      <td>${u.role}</td>
      <td>${u.status === 'blocked' ? '<span class="badge badge-error">Заблокирован</span>' : '<span class="badge badge-success">Активен</span>'}</td>
      <td style="display:flex;gap:6px;">${actions.join('')}</td>
    </tr>`;
  }).join('');

  if (window.lucide) lucide.createIcons();

  // События на кнопки
  tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.onclick = async function () {
      const username = btn.getAttribute('data-username');
      if (!confirm(`Удалить пользователя ${username}?`)) return;
      const res = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
      });
      if (res.ok) loadUserList();
      else alert('Ошибка удаления пользователя');
    }
  });
  tbody.querySelectorAll('.block-user-btn').forEach(btn => {
    btn.onclick = async function () {
      const username = btn.getAttribute('data-username');
      if (!confirm(`Заблокировать пользователя ${username}?`)) return;
      const res = await fetch('/api/admin/users/block', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
      });
      if (res.ok) loadUserList();
      else alert('Ошибка блокировки пользователя');
    }
  });
  tbody.querySelectorAll('.unblock-user-btn').forEach(btn => {
    btn.onclick = async function () {
      const username = btn.getAttribute('data-username');
      if (!confirm(`Разблокировать пользователя ${username}?`)) return;
      const res = await fetch('/api/admin/users/unblock', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
      });
      if (res.ok) loadUserList();
      else alert('Ошибка разблокировки пользователя');
    }
  });
}

// --- Фильтрация пользователей по роли и поиску логина ---
function filterAndRenderUsers() {
  let roleValue = document.getElementById('roleUserFilter').value;
  let searchValue = document.getElementById('userSearchInput').value.trim().toLowerCase();

  let filtered = lastUserList.filter(u => {
    let matchesRole = !roleValue || u.role === roleValue;
    let matchesLogin = !searchValue || (u.username && u.username.toLowerCase().includes(searchValue));
    return matchesRole && matchesLogin;
  });

  renderUserList(filtered);
}

// События на фильтр и поиск
document.getElementById('roleUserFilter').addEventListener('change', filterAndRenderUsers);
document.getElementById('userSearchInput').addEventListener('input', filterAndRenderUsers);


// --- История рендеров и фильтры ---
async function loadAdminRenders() {
  const tbody = document.getElementById('renderHistory');
  try {
    const res = await fetch('/api/admin/renders');
    if (!res.ok) throw new Error("Ошибка доступа");
    const history = await res.json();
    lastAdminHistory = history;
    fillUserFilter(history);
    renderFilteredHistory();
  } catch {
    tbody.innerHTML = `<tr><td colspan="7">Ошибка загрузки истории</td></tr>`;
  }
}

// Фильтрация по всем трём полям
function renderFilteredHistory() {
  const tbody = document.getElementById('renderHistory');
  let filtered = lastAdminHistory;

  const uidQ = document.getElementById('uidSearchInput').value.trim().toLowerCase();
  const statusQ = document.getElementById('statusFilter').value;
  const userQ = document.getElementById('userFilter').value;

  if (uidQ) filtered = filtered.filter(r => r.uid && r.uid.toLowerCase().includes(uidQ));
  if (statusQ) filtered = filtered.filter(r => r.status === statusQ);
  if (userQ) filtered = filtered.filter(r => r.user === userQ);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">Рендеров нет</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r, i) => {
    let percent = Math.round((r.progress || 0) * 100);
    if (percent > 100) percent = 100;
    if (percent < 0) percent = 0;

    let downloadBtn = '';
    if (r.status === 'done' && r.output_path) {
      let relPath = r.output_path;
      if (relPath.startsWith('C:') || relPath.startsWith('D:')) {
        relPath = '/output/' + relPath.split(/[/\\]/).pop();
      } else if (!relPath.startsWith('/output/')) {
        relPath = '/output/' + relPath.replace(/^.*[\\\/]/, '');
      }
      downloadBtn = `<a href="${relPath}" class="btn btn-sm btn-success" title="Скачать" target="_blank" download>
        <svg data-lucide="download" width="18" height="18"></svg>
      </a>`;
    }

    let uidCopyBtn = `
      <div style="display:inline-block; position:relative;">
        <button type="button" class="btn btn-sm btn-secondary copy-uid-btn" data-uid="${r.uid}" title="Скопировать UID">
          <svg data-lucide="copy" width="16" height="16"></svg>
        </button>
        <span class="copied-tooltip" style="display:none;position:absolute;left:50%;top:32px;transform:translateX(-50%);background:#1ea97c;color:#fff;font-size:13px;border-radius:8px;padding:2px 14px;z-index:10;white-space:nowrap;box-shadow:0 2px 8px #0002;">Скопировано</span>
      </div>
    `;

    let deleteBtn = `
      <button class="btn btn-sm btn-danger delete-render-btn" data-uid="${r.uid}" title="Удалить">
        <svg data-lucide="trash-2" width="16" height="16"></svg>
      </button>
    `;

    let restartBtn = `
      <button class="btn btn-sm btn-warning restart-render-btn" data-uid="${r.uid}" title="Перезапустить">
        <svg data-lucide="refresh-ccw" width="16" height="16"></svg>
      </button>
    `;

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${r.template_name || '—'}</td>
        <td>${r.user}</td>
        <td>${timeAgo(r.date)}</td>
        <td>${formatStatus(r.status)}</td>
        <td>${percent}%</td>
        <td style="display:flex;gap:7px;align-items:center;">
          ${downloadBtn}
          ${uidCopyBtn}
          ${restartBtn}
          ${deleteBtn}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();

  tbody.querySelectorAll('.copy-uid-btn').forEach(btn => {
    btn.onclick = function (e) {
      e.preventDefault();
      const uid = btn.getAttribute('data-uid');
      const tooltip = btn.parentNode.querySelector('.copied-tooltip');
      const textarea = document.createElement('textarea');
      textarea.value = uid;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        btn.classList.add('btn-success');
        if (tooltip) {
          tooltip.style.display = 'inline-block';
          setTimeout(() => { tooltip.style.display = 'none'; }, 1200);
        }
      } catch {
        alert('Не удалось скопировать UID');
      }
      document.body.removeChild(textarea);
      setTimeout(() => {
        btn.classList.remove('btn-success');
      }, 900);
    };
  });

  tbody.querySelectorAll('.delete-render-btn').forEach(btn => {
    btn.onclick = async function () {
      if (!confirm('Удалить рендер?')) return;
      const uid = btn.getAttribute('data-uid');
      const res = await fetch('/api/admin/renders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid })
      });
      if (res.ok) loadAdminRenders();
      else alert('Ошибка удаления');
    };
  });

  tbody.querySelectorAll('.restart-render-btn').forEach(btn => {
    btn.onclick = async function () {
      if (!confirm('Перезапустить рендер?')) return;
      const uid = btn.getAttribute('data-uid');
      const res = await fetch('/api/admin/renders/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid })
      });
      if (res.ok) loadAdminRenders();
      else alert('Ошибка перезапуска');
    };
  });
}

// Динамическое заполнение фильтра пользователей
function fillUserFilter(history) {
  const userFilter = document.getElementById('userFilter');
  const prev = userFilter.value;
  const users = Array.from(new Set(history.map(r => r.user))).filter(Boolean).sort();
  userFilter.innerHTML = `<option value="">Все пользователи</option>` + users.map(u =>
    `<option value="${u}">${u}</option>`).join('');
  userFilter.value = prev;
}

// --- Поиск, фильтры, обновления ---
document.getElementById('uidSearchBtn').onclick = renderFilteredHistory;
document.getElementById('uidClearBtn').onclick = function() {
  document.getElementById('uidSearchInput').value = "";
  renderFilteredHistory();
};
document.getElementById('uidSearchInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') renderFilteredHistory();
});
document.getElementById('statusFilter').onchange = renderFilteredHistory;
document.getElementById('userFilter').onchange = renderFilteredHistory;

// --- Добавление пользователя ---
document.getElementById('addUserBtn').onclick = async function() {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;
  if (!username || !password) {
    alert('Введите логин и пароль');
    return;
  }
  const res = await fetch('/api/admin/users/create', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, password, role})
  });
  if (res.ok) {
    alert('Пользователь успешно создан');
    document.getElementById('newUserName').value = '';
    document.getElementById('newUserPass').value = '';
    document.getElementById('newUserRole').value = 'user';
    loadUserList();
  } else {
    const data = await res.json();
    alert('Ошибка: ' + (data.error || 'Неизвестная'));
  }
};

// --- Вспомогательные функции ---
function formatStatus(status) {
  switch (status) {
    case "done": return `<span class="badge badge-status badge-done">Готово</span>`;
    case "error": return `<span class="badge badge-status badge-error">Ошибка</span>`;
    case "queued": return `<span class="badge badge-status badge-queued">В очереди</span>`;
    case "rendering": return `<span class="badge badge-status badge-rendering">В процессе</span>`;
    case "deleted": return `<span class="badge badge-status badge-deleted">deleted</span>`;
    case "restarted": return `<span class="badge badge-status badge-restarted">restarted</span>`;
    default: return `<span class="badge badge-status badge-unknown">${status}</span>`;
  }
}
function timeAgo(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "Только что";
  if (diff < 3600) return Math.floor(diff/60) + " мин. назад";
  if (diff < 86400) return Math.floor(diff/3600) + " ч. назад";
  return date.toLocaleDateString("ru-RU") + " " + date.toLocaleTimeString("ru-RU").slice(0,5);
}

// --- При загрузке ---
document.addEventListener('DOMContentLoaded', () => {
  loadAdminStats();
  loadUserList();
  loadAdminRenders();
  setInterval(() => {
    loadAdminStats();
    loadUserList();
    loadAdminRenders();
  }, 5000);
});
