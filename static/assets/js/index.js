document.addEventListener("DOMContentLoaded", function() {
  // Инициализация модулей авторизации и тезисов
  window.auth && window.auth.init && window.auth.init();
  window.thesis && window.thesis.init && window.thesis.init();

  // --- Шаблоны ---
  let renderFilteredTemplates = null;

  async function loadTemplates() {
    const res = await fetch("/api/templates");
    const templates = await res.json();
    const container = document.querySelector("#template-container");
    const searchInput = document.getElementById("searchInput");
    const categoryFilter = document.getElementById("categoryFilter");

    let grouped = {};
    templates.forEach(t => {
      const cat = t.category || "Без категории";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    });

    // populate category filter
    categoryFilter.innerHTML = '<option value="all">Все категории</option>';
    Object.keys(grouped).forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      categoryFilter.appendChild(opt);
    });

    renderFilteredTemplates = function() {
      const search = searchInput.value.toLowerCase();
      const selectedCategory = categoryFilter.value;
      container.innerHTML = "";

      Object.entries(grouped).forEach(([category, items]) => {
        if (selectedCategory !== "all" && selectedCategory !== category) return;

        const filtered = items.filter(t =>
          t.name.toLowerCase().includes(search) || t.description.toLowerCase().includes(search)
        );

        if (!filtered.length) return;

        const section = document.createElement("div");
        section.className = "mb-5";

        const title = document.createElement("h4");
        title.className = "mb-3";
        title.textContent = category;
        section.appendChild(title);

        const row = document.createElement("div");
        row.className = "row row-cols-1 row-cols-sm-2 row-cols-md-3 g-3";

        filtered.forEach(t => {
          const col = document.createElement("div");
          col.className = "col";

          let selectBtn = '';
          if (window.auth && window.auth.isAuthorized) {
            selectBtn = `<button class="btn btn-sm btn-dark w-100" onclick="selectTemplate('${t.id}')">Выбрать</button>`;
          }

          col.innerHTML = `
            <div class="card shadow-sm h-100 d-flex flex-column">
              <img class="card-img-top" src="${t.preview_path}" alt="${t.name}" height="225">
              <div class="card-body d-flex flex-column">
                <h5 class="card-title">${t.name}</h5>
                <hr class="hr hr-blurry" />
                <p class="card-text flex-grow-1">${t.description}</p>
                <div class="mt-auto">
                  ${selectBtn}
                </div>
              </div>
            </div>`;
          row.appendChild(col);
        });

        section.appendChild(row);
        container.appendChild(section);
      });
    };

    searchInput.addEventListener("input", renderFilteredTemplates);
    categoryFilter.addEventListener("change", renderFilteredTemplates);

    // Делаем глобальной для обновления после логина/логаута
    window.renderFilteredTemplates = renderFilteredTemplates;
    renderFilteredTemplates();
  }

  window.selectTemplate = function(id) {
    window.selectedTemplateId = id;
    window.thesis && window.thesis.openModal && window.thesis.openModal();
  };

  loadTemplates();

  // --- SEARCH MODAL, SCROLL TO TOP и UI-фичи ---
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

  const searchToggleBtn = document.getElementById('searchToggleBtn');
  const searchModal = document.getElementById('searchModal');
  const searchInputModal = document.getElementById('searchInputModal');
  const categoryFilterModal = document.getElementById('categoryFilterModal');
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const searchModalContent = document.querySelector('.search-modal-content');
  const scrollToTopBtn = document.getElementById('scrollToTopBtn');

  window.addEventListener('scroll', function() {
    if (window.scrollY > 400) {
      scrollToTopBtn.style.display = 'flex';
    } else {
      scrollToTopBtn.style.display = 'none';
    }
  });
  if (scrollToTopBtn) {
    scrollToTopBtn.onclick = function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  if (searchModal) {
    searchModal.addEventListener('mousedown', function(e) {
      if (!searchModalContent.contains(e.target)) {
        searchModal.style.display = 'none';
      }
    });
  }

  window.addEventListener('scroll', function() {
    if (window.scrollY > 200) {
      searchToggleBtn.style.display = 'flex';
    } else {
      searchToggleBtn.style.display = 'none';
    }
  });

  if (searchToggleBtn) {
    searchToggleBtn.onclick = function() {
      searchModal.style.display = 'flex';
      searchInputModal.value = searchInput.value;
      categoryFilterModal.innerHTML = categoryFilter.innerHTML;
      categoryFilterModal.value = categoryFilter.value;
      setTimeout(() => { searchInputModal.focus(); }, 100);
    };
  }

  if (searchInputModal) {
    searchInputModal.addEventListener('input', function() {
      searchInput.value = searchInputModal.value;
      window.renderFilteredTemplates && window.renderFilteredTemplates();
    });
  }
  if (categoryFilterModal) {
    categoryFilterModal.addEventListener('change', function() {
      categoryFilter.value = categoryFilterModal.value;
      window.renderFilteredTemplates && window.renderFilteredTemplates();
    });
  }
});