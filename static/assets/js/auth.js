window.auth = {
  isAuthorized: false,

  // DOM-элементы (будут заполнены в init)
  loginBtn: null,
  loginModal: null,
  loginForm: null,
  doLoginBtn: null,
  closeLoginBtn: null,
  loginError: null,
  userStatus: null,
  adminPanelBtn: null,
  loginUsername: null,
  userBlock: null,
  logoutBtn: null,

  showLogin() {
    if (this.loginModal) {
      this.loginModal.style.display = 'flex';
      this.loginError.textContent = '';
      this.loginUsername.value = '';
      document.getElementById('loginPassword').value = '';
      setTimeout(() => this.loginUsername.focus(), 50);
    }
  },

  hideLogin() {
    if (this.loginModal) this.loginModal.style.display = 'none';
  },

  async login(username, password) {
    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
      });
      if (!resp.ok) return false;
      this.hideLogin();
      await this.updateUserStatus();
      const renderHistoryBtn = document.getElementById('renderHistoryBtn');
      if (renderHistoryBtn) renderHistoryBtn.style.display = this.isAuthorized ? '' : 'none';
      this.isAuthorized = true;
      return true;
    } catch (e) {
      return false;
    }
  },

  async logout() {
    await fetch('/api/logout', {method: 'POST'});
    await this.updateUserStatus();
    // если сейчас на странице истории — редирект на главную
    if (window.location.pathname.includes('history')) {
      window.location.href = 'index.html';
    }
  },

  async updateUserStatus() {
    try {
      const resp = await fetch('/api/whoami');
      const renderHistoryBtn = document.getElementById('renderHistoryBtn');
      if (!resp.ok) {
        if (this.loginBtn) this.loginBtn.style.display = '';
        renderHistoryBtn && (renderHistoryBtn.style.display = 'none');
        this.adminPanelBtn && (this.adminPanelBtn.style.display = 'none');
        // --- Скрыть userBlock ---
        this.userBlock && (this.userBlock.style.display = 'none');
        this.isAuthorized = false;
        window.renderFilteredTemplates && window.renderFilteredTemplates();
        // Если на защищённой странице — редирект
        setTimeout(() => {
          if (window.location.pathname.includes('history')) {
            window.location.href = 'index.html';
          }
        }, 100);
        return;
      }
      const data = await resp.json();
      if (this.loginBtn) this.loginBtn.style.display = 'none';
      renderHistoryBtn && (renderHistoryBtn.style.display = '');

      // --- Показать userBlock и вставить имя пользователя ---
      if (this.userBlock && this.userStatus) {
        this.userBlock.style.display = '';
        this.userStatus.innerHTML = `
          <svg data-lucide="user" width="15" height="15"></svg>
          <span id="usernameText">${data.username} (${data.role})</span>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      }

      // Кнопка выхода только если она есть
      this.logoutBtn && (this.logoutBtn.onclick = async () => { await this.logout(); });

      // Показывать админку только админу
      this.adminPanelBtn && (this.adminPanelBtn.style.display = data.role === "admin" ? "" : "none");
      this.isAuthorized = true;
      window.renderFilteredTemplates && window.renderFilteredTemplates();
    } catch (e) {
      if (this.loginBtn) this.loginBtn.style.display = '';
      const renderHistoryBtn = document.getElementById('renderHistoryBtn');
      renderHistoryBtn && (renderHistoryBtn.style.display = 'none');
      this.adminPanelBtn && (this.adminPanelBtn.style.display = 'none');
      this.userBlock && (this.userBlock.style.display = 'none');
      this.isAuthorized = false;
      window.renderFilteredTemplates && window.renderFilteredTemplates();
      // Если на защищённой странице — редирект
      setTimeout(() => {
        if (window.location.pathname.includes('history')) {
          window.location.href = 'index.html';
        }
      }, 100);
    }
  },

  // Позволяет вызвать из любого скрипта быструю проверку
  redirectIfNotAuthorized() {
    if (!this.isAuthorized) {
      window.location.href = 'index.html';
    }
  },

  // --- Инициализация слушателей и DOM ---
  init() {
    this.loginBtn = document.getElementById('loginBtn');
    this.loginModal = document.getElementById('loginModal');
    this.loginForm = document.getElementById('login-form');
    this.doLoginBtn = document.getElementById('doLogin');
    this.closeLoginBtn = document.getElementById('closeLogin');
    this.loginError = document.getElementById('loginError');
    this.userStatus = document.getElementById('userStatus');
    this.adminPanelBtn = document.getElementById('adminPanelBtn');
    this.loginUsername = document.getElementById('loginUsername');
    this.userBlock = document.getElementById('userBlock');
    this.logoutBtn = document.getElementById('logoutBtn');

    // Если на странице истории — убираем "Войти" и логин-модалку (на всякий случай)
    if (window.location.pathname.includes('history')) {
      if (this.loginBtn) this.loginBtn.style.display = 'none';
      if (this.loginModal) this.loginModal.style.display = 'none';
    } else {
      // Иначе работаем как обычно
      if (this.loginBtn) this.loginBtn.onclick = () => this.showLogin();
      if (this.closeLoginBtn) this.closeLoginBtn.onclick = () => this.hideLogin();

      // Клик вне модалки — закрытие
      if (this.loginModal) {
        this.loginModal.addEventListener('mousedown', (e) => {
          if (e.target === this.loginModal) this.hideLogin();
        });
      }

      // Кнопка "Войти" в модалке
      if (this.doLoginBtn) this.doLoginBtn.onclick = () => this.loginForm.requestSubmit();

      // Закрытие логин-модалки по ESC
      document.addEventListener('keydown', (e) => {
        if (this.loginModal && this.loginModal.style.display === 'flex' && e.key === "Escape") {
          this.hideLogin();
        }
      });

      // Сабмит формы логина
      if (this.loginForm) {
        this.loginForm.onsubmit = async (e) => {
          e.preventDefault();
          const username = this.loginUsername.value.trim();
          const password = document.getElementById('loginPassword').value.trim();
          if (!username || !password) {
            this.loginError.textContent = 'Заполните оба поля!';
            return;
          }
          this.loginError.textContent = '';
          const ok = await this.login(username, password);
          if (!ok) {
            this.loginError.textContent = 'Неверный логин или пароль';
          }
        };
      }
    }
    // Проверить статус пользователя при инициализации
    this.updateUserStatus();
  }
};

// Парольный тогглер оставим универсальным
document.addEventListener("DOMContentLoaded", function() {
  const passwordInput = document.getElementById('loginPassword');
  const togglePasswordBtn = document.getElementById('togglePassword');
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', function() {
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
      } else {
        passwordInput.type = "password";
      }
    });
  }
});
