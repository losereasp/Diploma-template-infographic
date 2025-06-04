document.addEventListener('DOMContentLoaded', function () {
  const tableBody = document.querySelector('#renderHistoryTable tbody');

  function renderTable(history) {
    if (!history.length) {
      tableBody.innerHTML = '<tr><td colspan="9" class="text-center">История пуста</td></tr>';
      return;
    }
    let rowsHTML = '';
    history.forEach(h => {
      let date = h.submitted_at ? new Date(h.submitted_at).toLocaleString('ru-RU') : '';
      let thesesStr = '';
      if (h.params && Array.isArray(h.params.theses)) {
        thesesStr = h.params.theses.map(t => {
          let txt = t.text || '';
          let title = t.title || '';
          return `${txt}${title ? ' / ' + title : ''}`;
        }).join('; ');
      }
      let uidBtnId = 'copybtn-' + h.uid;

      // Кнопка скачать результат
      let downloadBtn = '';
      if (h.status === 'done' && h.params && h.params.output_path) {
        let relPath = h.params.output_path;
        if (relPath.startsWith('C:') || relPath.startsWith('D:')) {
          relPath = '/output/' + relPath.split(/[/\\]/).pop();
        } else if (!relPath.startsWith('/output/')) {
          relPath = '/output/' + relPath.replace(/^.*[\\\/]/, '');
        }
        downloadBtn = `<a href="${relPath}" class="btn btn-sm btn-outline-info" target="_blank" download>Скачать</a>`;
      }

      // === Прогресс ===
      let progressHTML = '';
      if (h.params && typeof h.params.progress !== 'undefined') {
        let percent = Math.round((h.params.progress || 0) * 100);
        // Приводим к 0-100 (если вдруг там 1.0, а не 100)
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        progressHTML = `
          <div style="min-width:100px;display:flex;align-items:center;gap:6px;">
            <progress value="${percent}" max="100" style="width:60px;"></progress>
            <span style="font-size:13px;">${percent}%</span>
          </div>
        `;
      } else {
        progressHTML = '-';
      }

      rowsHTML += `
        <tr>
          <td>${date}</td>
          <td>${h.params?.template || ''}</td>
          <td>${h.type}</td>
          <td>${thesesStr || '-'}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;position:relative;">
              <span style="font-family:monospace;">${h.uid}</span>
              <button type="button" class="btn btn-sm btn-outline-secondary copy-uid-btn" 
                data-uid="${h.uid}" id="${uidBtnId}" style="transition:.2s;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <span class="copied-tooltip" style="display:none; position:absolute; right:0; top:35px; background:#282; color:#fff; font-size:13px; border-radius:8px; padding:2px 12px; z-index:10;">
                Скопировано!
              </span>
            </div>
          </td>
          <td>${h.status || '-'}</td>
          <td>${progressHTML}</td>
          <td>${h.username}</td>
          <td>${downloadBtn}</td>
        </tr>
      `;
    });
    tableBody.innerHTML = rowsHTML;

    // Копирование UID
    document.querySelectorAll('.copy-uid-btn').forEach(btn => {
      btn.onclick = function () {
        const uid = btn.getAttribute('data-uid');
        const tooltip = btn.parentNode.querySelector('.copied-tooltip');
        const textarea = document.createElement('textarea');
        textarea.value = uid;
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          document.execCommand('copy');
          btn.classList.remove('btn-outline-secondary');
          btn.classList.add('btn-success');
          tooltip.style.display = 'inline-block';
          setTimeout(() => {
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline-secondary');
            tooltip.style.display = 'none';
          }, 1400);
        } catch (err) {
          tooltip.textContent = "Ошибка копирования";
          tooltip.style.background = "#e52";
          tooltip.style.display = 'inline-block';
          setTimeout(() => {
            tooltip.style.display = 'none';
            tooltip.textContent = "Скопировано!";
            tooltip.style.background = "#282";
          }, 2000);
        }
        document.body.removeChild(textarea);
      };
    });
  }

  // --- Авто-обновление каждые 5 секунд ---
  function fetchAndUpdate() {
    fetch('/api/render-history')
      .then(r => r.json())
      .then(renderTable)
      .catch(e => {
        tableBody.innerHTML = `<tr><td colspan="9" style="color:#c44;">Ошибка загрузки: ${e}</td></tr>`;
      });
  }

  fetchAndUpdate();
  setInterval(fetchAndUpdate, 5000); // каждые 5 секунд обновляем

});
