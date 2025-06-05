// Загрузка общей статистики
async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error("Не удалось получить статистику");
    const stats = await res.json();
    document.getElementById('totalTemplates').textContent = stats.total_templates;
    document.getElementById('totalRenders').textContent = stats.total_renders;
  } catch (e) {
    document.getElementById('totalTemplates').textContent = '?';
    document.getElementById('totalRenders').textContent = '?';
  }
}

// Загрузка истории рендеров (для админа)
async function loadAdminRenders() {
  const tbody = document.getElementById('renderHistory');
  tbody.innerHTML = `<tr><td colspan="7">Загрузка...</td></tr>`;
  try {
    const res = await fetch('/api/admin/renders');
    if (!res.ok) throw new Error("Ошибка доступа");
    const history = await res.json();
    if (!Array.isArray(history) || history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">Рендеров нет</td></tr>`;
      return;
    }

    tbody.innerHTML = history.map((r, i) => {
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

      // Кнопка скопировать UID (с тултипом, как в истории)
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
          ">
            Скопировано
          </span>
        </div>
      `;

      return `
        <tr>
          <td>${i + 1}</td>
          <td>${r.template_name || '—'}</td>
          <td>${r.user}</td>
          <td>${r.date ? r.date.replace('T', ' ').slice(0, 16) : ''}</td>
          <td>${formatStatus(r.status)}</td>
          <td>${percent}%</td>
          <td style="display:flex;gap:7px;align-items:center;">
            ${downloadBtn}
            ${uidCopyBtn}
          </td>
        </tr>
      `;
    }).join('');

    // После рендера — активируем Lucide для svg-иконок:
    if (window.lucide) lucide.createIcons();

    // Кнопка копирования UID с тултипом (полностью как в истории)
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

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">Ошибка загрузки истории</td></tr>`;
  }
}

// Функция форматирования статуса (можно кастомизировать цвета)
function formatStatus(status) {
  switch (status) {
    case "done": return `<span class="badge badge-status badge-done">Готово</span>`;
    case "error": return `<span class="badge badge-status badge-error">Ошибка</span>`;
    case "queued": return `<span class="badge badge-status badge-queued">В очереди</span>`;
    case "rendering": return `<span class="badge badge-status badge-rendering">В процессе</span>`;
    default: return `<span class="badge badge-status badge-unknown">${status}</span>`;
  }
}

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  loadAdminStats();
  loadAdminRenders();
});

// setInterval(loadAdminRenders, 10000); // обновлять каждые 10 сек
