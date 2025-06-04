document.addEventListener('DOMContentLoaded', function () {
  const historyList = document.getElementById('renderHistoryList');

  function getInitials(name) {
    if (!name) return '';
    return name.split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
  }

  const statusTitles = {
    done: "Выполнено",
    error: "Ошибка",
    queued: "В очереди",
    rendering: "Рендер",
    unknown: "Неизвестно"
  };
  const statusClasses = {
    done: "badge-done",
    error: "badge-error",
    queued: "badge-queued",
    rendering: "badge-rendering",
    unknown: "badge-unknown"
  };

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

  function renderHistoryList(history) {
    if (!history.length) {
      historyList.innerHTML = '<div style="text-align:center;padding:36px;">История пуста</div>';
      return;
    }
    // --- Шапка таблицы
    let headerHTML = `
      <div class="history-header-row">
        <div class="template-block legend">Шаблон</div>
        <div class="user-block legend">Пользователь</div>
        <div class="status-block legend" style="align-items: center;">Статус</div>
        <div class="progress-block legend">Прогресс</div>
        <div class="time-block legend">Время</div>
        <div class="action-block legend">Действия</div>
      </div>
    `;

    // --- Рендер самих строк
    let rowsHTML = history.map(h => {
      let initials = getInitials(h.username || 'U');
      let percent = h.params && typeof h.params.progress !== 'undefined'
        ? Math.round((h.params.progress || 0) * 100)
        : 0;
      if (percent > 100) percent = 100;
      if (percent < 0) percent = 0;

      let statusKey = h.status || 'unknown';
      let statusTitle = statusTitles[statusKey] || statusKey;
      let statusClass = "badge-status " + (statusClasses[statusKey] || "badge-unknown");

      // Добавляем класс к прогресс-блоку для окраски через CSS
      let progressBlockClass = "progress-block " + statusKey;
      let progressHTML = `
        <div class="${progressBlockClass}">
          <progress value="${percent}" max="100"></progress>
          <span>${percent}%</span>
        </div>
      `;

      let timeStr = timeAgo(h.submitted_at);

      let downloadBtn = '';
      if (h.status === 'done' && h.params && h.params.output_path) {
        let relPath = h.params.output_path;
        if (relPath.startsWith('C:') || relPath.startsWith('D:')) {
          relPath = '/output/' + relPath.split(/[/\\]/).pop();
        } else if (!relPath.startsWith('/output/')) {
          relPath = '/output/' + relPath.replace(/^.*[\\\/]/, '');
        }
        downloadBtn = `<a href="${relPath}" class="btn" title="Скачать" target="_blank" download>
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v10"/><path d="M8 13l4 4 4-4"/><path d="M4 19h16"/>
          </svg>
        </a>`;
      }

      // Tooltip для копирования
      let uidCopyBtn = `
        <div style="display:inline-block; position:relative;">
          <button type="button" class="btn copy-uid-btn" data-uid="${h.uid}" title="Скопировать UID">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="10" height="10" rx="2"/>
              <path d="M8 2h8v8"/>
            </svg>
          </button>
          <span class="copied-tooltip" style="
            display:none;
            position:absolute;
            left:50%;
            top:38px;
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

      // SVG-заглушка (иконка шаблона)
      let previewSVG = `
        <span class="template-preview template-preview--simple">
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect x="2" y="2" width="30" height="30" rx="8" fill="#21223a" stroke="#31314a" stroke-width="2"/>
    <rect x="9" y="10" width="16" height="2.5" rx="1.2" fill="#6f7db8"/>
    <rect x="9" y="15" width="10" height="2.2" rx="1.1" fill="#495899"/>
    <rect x="9" y="20" width="13" height="2.2" rx="1.1" fill="#495899" fill-opacity="0.85"/>
  </svg>
</span>
      `;

      return `
        <div class="history-row">
          <div class="template-block">
            ${previewSVG}
            <div class="template-info">
              <span class="template-name">${h.params?.template ? h.params.template : ''}</span>
              <span class="template-type">${h.type}</span>
            </div>
          </div>
          <div class="user-block">
            <div class="user-avatar">${initials}</div>
            <span class="username">${h.username || ''}</span>
          </div>
          <div class="status-block">
            <span class="${statusClass}" style="min-width:96px;white-space:nowrap;">${statusTitle}</span>
          </div>
          ${progressHTML}
          <div class="time-block">${timeStr}</div>
          <div class="action-block">
          ${downloadBtn}
            ${uidCopyBtn}
          </div>
        </div>
      `;
    }).join('');

    historyList.innerHTML = headerHTML + rowsHTML;

    // --- Кнопка копирования UID с фидбеком
    document.querySelectorAll('.copy-uid-btn').forEach(btn => {
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
  }

  function fetchAndUpdate() {
    fetch('/api/render-history')
      .then(r => r.json())
      .then(renderHistoryList)
      .catch(e => {
        historyList.innerHTML = `<div style="color:#c44;padding:2em;">Ошибка загрузки: ${e}</div>`;
      });
  }

  fetchAndUpdate();
  setInterval(fetchAndUpdate, 5000);
});
