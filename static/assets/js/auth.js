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

  showLogin() {
    this.loginModal.style.display = 'flex';
    this.loginError.textContent = '';
    this.loginUsername.value = '';
    document.getElementById('loginPassword').value = '';
    setTimeout(() => this.loginUsername.focus(), 50);
  },

  hideLogin() {
    this.loginModal.style.display = 'none';
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
      this.isAuthorized = true; // и наоборот в блоке catch
      return true;
    } catch (e) {
      return false;
    }
  },

  async logout() {
    await fetch('/api/logout', {method: 'POST'});
    await this.updateUserStatus();
  },

  async updateUserStatus() {
    try {
      const resp = await fetch('/api/whoami');
      if (!resp.ok) {
        this.loginBtn.style.display = '';
        this.userStatus.textContent = '';
        this.adminPanelBtn.style.display = 'none';
        this.isAuthorized = false;
        window.renderFilteredTemplates && window.renderFilteredTemplates();
        return;
      }
      const data = await resp.json();
      this.loginBtn.style.display = 'none';
      this.userStatus.innerHTML = `
        <span style="color:#80ef9c;">${data.username} (${data.role})</span>
        <button class="btn btn-outline-light btn-sm ms-2" id="logoutBtn">Выйти</button>
      `;
      if (data.role === "admin") {
        this.adminPanelBtn.style.display = '';
      } else {
        this.adminPanelBtn.style.display = 'none';
      }
      this.isAuthorized = true;
      window.renderFilteredTemplates && window.renderFilteredTemplates();

      // Привязываем обработчик выхода после обновления DOM
      document.getElementById('logoutBtn').onclick = async () => {
        await this.logout();
      };
    } catch (e) {
      this.loginBtn.style.display = '';
      this.userStatus.textContent = '';
      this.adminPanelBtn.style.display = 'none';
      this.isAuthorized = false;
      window.renderFilteredTemplates && window.renderFilteredTemplates();
    }
  },

  // --- Инициализация слушателей и DOM ---
  init() {
    // Находим элементы только сейчас!
    this.loginBtn = document.getElementById('loginBtn');
    this.loginModal = document.getElementById('loginModal');
    this.loginForm = document.getElementById('login-form');
    this.doLoginBtn = document.getElementById('doLogin');
    this.closeLoginBtn = document.getElementById('closeLogin');
    this.loginError = document.getElementById('loginError');
    this.userStatus = document.getElementById('userStatus');
    this.adminPanelBtn = document.getElementById('adminPanelBtn');
    this.loginUsername = document.getElementById('loginUsername');

    if (!this.loginBtn) return; // Минимальная защита, если что-то не найдено

    this.loginBtn.onclick = () => this.showLogin();
    this.closeLoginBtn.onclick = () => this.hideLogin();

    // Клик вне модалки — закрытие
    this.loginModal.addEventListener('mousedown', (e) => {
      if (e.target === this.loginModal) this.hideLogin();
    });

    // Кнопка "Войти" в модалке
    this.doLoginBtn.onclick = () => this.loginForm.requestSubmit();

    // Закрытие логин-модалки по ESC
    document.addEventListener('keydown', (e) => {
      if (this.loginModal.style.display === 'flex' && e.key === "Escape") {
        this.hideLogin();
      }
    });

    // Сабмит формы логина
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

    // Проверить статус пользователя при инициализации
    this.updateUserStatus();
  }
};

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
