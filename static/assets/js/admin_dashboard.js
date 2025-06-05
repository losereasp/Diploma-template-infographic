let prevTbodyHTML = "";
let prevStats = { total_templates: null, total_renders: null };
let lastAdminHistory = []; // Хранить последнюю загруженную историю

// Загрузка общей статистики (обновляет только если изменилось)
async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error("Не удалось получить статистику");
    const stats = await res.json();

    // Обновлять только если реально изменилось (чтобы не было "мерцания" цифр)
    if (stats.total_templates !== prevStats.total_templates) {
      document.getElementById('totalTemplates').textContent = stats.total_templates;
      prevStats.total_templates = stats.total_templates;
    }
    if (stats.total_renders !== prevStats.total_renders) {
      document.getElementById('totalRenders').textContent = stats.total_renders;
      prevStats.total_renders = stats.total_renders;
    }
  } catch (e) {
    document.getElementById('totalTemplates').textContent = '?';
    document.getElementById('totalRenders').textContent = '?';
    prevStats = { total_templates: null, total_renders: null };
  }
}


async function loadAdminRenders(filterUid = "") {
  const tbody = document.getElementById('renderHistory');
  try {
    const res = await fetch('/api/admin/renders');
    if (!res.ok) throw new Error("Ошибка доступа");
    const history = await res.json();
    lastAdminHistory = history; // Сохраняем всю историю

    let filtered = history;
    if (filterUid && filterUid.trim().length > 0) {
      const q = filterUid.trim().toLowerCase();
      filtered = history.filter(r => r.uid && r.uid.toLowerCase().includes(q));
    }

    if (!Array.isArray(filtered) || filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">Рендеров нет</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((r, i) => {
      let percent = Math.round((r.progress || 0) * 100);
      if (percent > 100) percent = 100;
      if (percent < 0) percent = 0;

      // Кнопка скачать
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

      // Кнопка скопировать UID (с тултипом)
      let uidCopyBtn = `
        <div style="display:inline-block; position:relative;">
          <button type="button" class="btn btn-sm btn-secondary copy-uid-btn" data-uid="${r.uid}" title="Скопировать UID">
            <svg data-lucide="copy" width="16" height="16"></svg>
          </button>
          <span class="copied-tooltip" style="
            display:none;
            position:absolute;
            left:50%;
            top:32px;
            transform:translateX(-50%);
            background:#1ea97c;
            color:#fff;
            font-size:13px;
            border-radius:8px;
            padding:2px 14px;
            z-index:10;
            white-space:nowrap;
            box-shadow:0 2px 8px #0002;
          ">Скопировано</span>
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

    // После рендера — активируем Lucide для svg-иконок:
    if (window.lucide) lucide.createIcons();

    // Кнопка копирования UID
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
        } catch (err) {
          alert('Не удалось скопировать UID');
        }
        document.body.removeChild(textarea);
        setTimeout(() => {
          btn.classList.remove('btn-success');
        }, 900);
      };
    });

    // Кнопки удаления и перезапуска — без изменений
    tbody.querySelectorAll('.delete-render-btn').forEach(btn => {
      btn.onclick = async function () {
        if (!confirm('Удалить рендер?')) return;
        const uid = btn.getAttribute('data-uid');
        const res = await fetch('/api/admin/renders/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid })
        });
        if (res.ok) {
          loadAdminRenders(document.getElementById('uidSearchInput').value);
        } else {
          alert('Ошибка удаления');
        }
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
        if (res.ok) {
          loadAdminRenders(document.getElementById('uidSearchInput').value);
        } else {
          alert('Ошибка перезапуска');
        }
      };
    });

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">Ошибка загрузки истории</td></tr>`;
  }
}


// Остальные функции оставь без изменений:
function formatStatus(status) {
  switch (status) {
    case "done": return `<span class="badge badge-status badge-done">Готово</span>`;
    case "error": return `<span class="badge badge-status badge-error">Ошибка</span>`;
    case "queued": return `<span class="badge badge-status badge-queued">В очереди</span>`;
    case "rendering": return `<span class="badge badge-status badge-rendering">В процессе</span>`;
    case "deleted": return `<span class="badge badge-status badge-deleted">deleted</span>`; // Добавить это!
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

document.getElementById('uidSearchBtn').onclick = function() {
  const val = document.getElementById('uidSearchInput').value;
  loadAdminRenders(val);
};

document.getElementById('uidClearBtn').onclick = function() {
  document.getElementById('uidSearchInput').value = "";
  loadAdminRenders();
};

// Позволяет искать по Enter
document.getElementById('uidSearchInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    loadAdminRenders(this.value);
  }
});


// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  loadAdminStats();
  loadAdminRenders();
setInterval(() => {
  loadAdminStats();
  loadAdminRenders(document.getElementById('uidSearchInput').value);
}, 5000);
});
