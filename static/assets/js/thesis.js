// Преобразует dataURL картинки (base64) в Blob для отправки в FormData
function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], {type: mime});
}

window.thesis = {

  // --- DOM-элементы (инициализируются в init) ---
  thesisModal: null,
  thesisCountSlider: null,
  thesisCountValue: null,
  thesisContainer: null,
  closeThesisModalBtn: null,

  uploadImage: null,
  imagePreview: null,
  uploadAudio: null,
  audioPreview: null,

  cropModal: null,
  closeCropModal: null,
  applyCropBtn: null,
  cropImageBtn: null,
  cropperImage: null,

  cropImageData: {},
  cropper: null,
  currentCropThesis: null,

  

  // --- Методы ---
  renderThesisFields() {
    const count = Math.max(1, Math.min(8, parseInt(this.thesisCountSlider.value) || 1));
    this.thesisCountValue.textContent = count;
    this.thesisCountSlider.style.setProperty('--value', count);
    this.thesisContainer.innerHTML = '';

    for (let i = 1; i <= count; i++) {
      const block = document.createElement('div');
      block.className = 'mb-3';
      block.innerHTML = `
        <label class="form-label">Тезис ${i}</label>
        <input type="text" class="form-control mb-2" name="thesis-title-${i}" placeholder="Заголовок/регалия для тезиса ${i}">
        <textarea class="form-control mb-2" rows="2" name="thesis-text-${i}" placeholder="Текст тезиса ${i}"></textarea>
        
        <label class="form-label mt-2">Фото для тезиса ${i}:</label>
        <input type="file" class="form-control mb-2 thesis-image-input" accept="image/*" data-thesis="${i}">
        <div class="thesis-image-preview-wrap mb-2">
          <img class="preview-image d-none thesis-image-preview" data-thesis="${i}" alt="Фото тезиса ${i}">
          <button type="button" class="btn btn-outline-secondary btn-sm d-none crop-btn" data-thesis="${i}">
            <svg style="width:18px;height:18px;vertical-align:-3px;margin-right:4px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" stroke-linecap="round"/></svg>
            Обрезать
          </button>
        </div>
      `;
      this.thesisContainer.appendChild(block);
    }
    this.setupThesisImageHandlers();
  },

  setupThesisImageHandlers() {
    // Обработчик для каждого input[type=file] после перерисовки
    const imageInputs = this.thesisContainer.querySelectorAll('.thesis-image-input');
    imageInputs.forEach(input => {
      input.onchange = () => {
        const i = input.dataset.thesis;
        const file = input.files && input.files[0];
        const preview = this.thesisContainer.querySelector(`.thesis-image-preview[data-thesis="${i}"]`);
        const cropBtn = this.thesisContainer.querySelector(`.crop-btn[data-thesis="${i}"]`);
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.remove('d-none');
            preview.style.display = 'block';
            preview.style.maxWidth = '100%';
            preview.style.marginTop = '8px';
            cropBtn.classList.remove('d-none');
            cropBtn.style.display = 'inline-flex';
            this.cropImageData[i] = e.target.result;
          };
          reader.readAsDataURL(file);
        } else {
          preview.src = '';
          preview.classList.add('d-none');
          cropBtn.classList.add('d-none');
          cropBtn.style.display = 'none';
          this.cropImageData[i] = null;
        }
      };
    });

    // Обработчик для каждой crop-кнопки
    const cropBtns = this.thesisContainer.querySelectorAll('.crop-btn');
    cropBtns.forEach(btn => {
      btn.onclick = () => {
        const i = btn.dataset.thesis;
        if (!this.cropImageData[i]) return;
        this.currentCropThesis = i;
        this.cropperImage.src = this.cropImageData[i];
        this.cropModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Сброс старого cropper
        if (this.cropper) {
          this.cropper.destroy();
          this.cropper = null;
        }
        setTimeout(() => {
          this.cropper = new Cropper(this.cropperImage, {
            viewMode: 1,
            aspectRatio: 16/9,
            movable: true,
            zoomable: true,
            scalable: true,
            rotatable: false,
            responsive: true,
            background: false,
          });
        }, 100);
      }
    });
  },

  resetThesisModal() {
    this.thesisCountSlider.value = 1;
    this.thesisCountValue.textContent = 1;
    this.renderThesisFields();

    // Сбросить все поля тезисов
    const allInputs = this.thesisContainer.querySelectorAll('input, textarea');
    allInputs.forEach(el => el.value = '');

    // Сбросить превьюшку фото/аудио (общие)
    if (this.imagePreview) {
      this.imagePreview.src = '';
      this.imagePreview.classList.add('d-none');
      this.uploadImage.value = '';
      if (this.cropImageBtn) this.cropImageBtn.classList.add('d-none');
    }
    if (this.audioPreview) {
      this.audioPreview.src = '';
      this.audioPreview.classList.add('d-none');
      this.uploadAudio.value = '';
    }

    // Сбросить cropper
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
    if (this.cropperImage) {
      this.cropperImage.src = '';
    }
    this.cropImageData = {};
    this.currentCropThesis = null;
  },

  openModal() {
    this.thesisModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    this.renderThesisFields();
  },

  closeModal() {
    this.thesisModal.style.display = 'none';
    document.body.style.overflow = '';
    this.resetThesisModal();
  },

  // --- Кроп --- 
  setupCropper() {
    this.applyCropBtn.addEventListener('click', () => {
      if (!this.cropper || !this.currentCropThesis) return;
      const canvas = this.cropper.getCroppedCanvas({
        width: 1920,
        height: 1080
      });
      const croppedDataURL = canvas.toDataURL("image/png");
      // Для нужного тезиса — вставить превью
      const preview = this.thesisContainer.querySelector(`.thesis-image-preview[data-thesis="${this.currentCropThesis}"]`);
      if (preview) {
        preview.src = croppedDataURL;
      }
      this.cropModal.style.display = 'none';
      document.body.style.overflow = '';
      this.cropper.destroy();
      this.cropper = null;
      this.cropImageData[this.currentCropThesis] = croppedDataURL; // сохраняем новое изображение
      this.currentCropThesis = null;
    });

    this.closeCropModal.addEventListener('click', () => {
      this.cropModal.style.display = 'none';
      document.body.style.overflow = '';
      if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
      }
    });
  },

  // --- Аудио превью ---
  setupAudioPreview() {
    this.uploadAudio.addEventListener('change', () => {
      const file = this.uploadAudio.files && this.uploadAudio.files[0];
      if (file && file.type.startsWith('audio/')) {
        const url = URL.createObjectURL(file);
        this.audioPreview.src = url;
        this.audioPreview.classList.remove('d-none');
        this.audioPreview.style.display = 'block';
      } else {
        this.audioPreview.src = '';
        this.audioPreview.classList.add('d-none');
      }
    });
  },

  sendThesisToRender() {
  // Считаем количество тезисов
  const count = Math.max(1, Math.min(8, parseInt(this.thesisCountSlider.value) || 1));
  const theses = [];

  // Собираем текстовые данные и картинки для каждого тезиса
  for (let i = 1; i <= count; i++) {
    const title = this.thesisContainer.querySelector(`[name="thesis-title-${i}"]`).value.trim();
    const text = this.thesisContainer.querySelector(`[name="thesis-text-${i}"]`).value.trim();
    const imgInput = this.thesisContainer.querySelector(`.thesis-image-input[data-thesis="${i}"]`);
    const imageFile = imgInput && imgInput.files && imgInput.files[0] ? imgInput.files[0] : null;
    theses.push({ title, text, imageFile });
  }

  // Аудио
  const audioFile = this.uploadAudio && this.uploadAudio.files && this.uploadAudio.files[0] ? this.uploadAudio.files[0] : null;

  // id шаблона (глобально)
  const templateId = window.selectedTemplateId;

  // Сборка FormData
  const formData = new FormData();
  formData.append('template', templateId);
  formData.append('params', JSON.stringify({
    theses: theses.map(t => ({ title: t.title, text: t.text })),
  }));
  formData.append('type', 'thesis');


  // Картинки (отправляем КРОПНУТЫЕ если есть!)
theses.forEach((t, idx) => {
    const croppedData = window.thesis.cropImageData[idx + 1];
    if (croppedData) {
        formData.append(`thesis_img_${idx + 1}`, dataURLtoBlob(croppedData), `cropped_${idx+1}.png`);
    } else if (t.imageFile) {
        formData.append(`thesis_img_${idx + 1}`, t.imageFile);
    }
});


  // Аудио
  if (audioFile) {
    formData.append('audio', audioFile);
  }

  // Отправка
  fetch('/save-task', {
    method: 'POST',
    body: formData
  })
  .then(r => r.json())
  .then(result => {
    if (result.status === 'render_started') {
      alert('Рендер запущен!');
      this.closeModal();
    } else {
      alert('Ошибка запуска рендера!');
    }
  })
  .catch(e => {
    alert('Ошибка отправки: ' + e.message);
  });
},


  // --- Инициализация слушателей и DOM ---
  init() {
    // Находим все DOM-элементы только здесь!
    this.thesisModal = document.getElementById('thesisModal');
    this.thesisCountSlider = document.getElementById('thesis-count');
    this.thesisCountValue = document.getElementById('thesis-count-value');
    this.thesisContainer = document.getElementById('thesis-container');
    this.closeThesisModalBtn = document.getElementById('closeThesisModal');

    this.uploadImage = document.getElementById('upload-image');
    this.imagePreview = document.getElementById('image-preview');
    this.uploadAudio = document.getElementById('upload-audio');
    this.audioPreview = document.getElementById('audio-preview');

    this.cropModal = document.getElementById('cropModal');
    this.closeCropModal = document.getElementById('closeCropModal');
    this.applyCropBtn = document.getElementById('applyCropBtn');
    this.cropImageBtn = document.getElementById('cropImageBtn');
    this.cropperImage = document.getElementById('cropper-image');

    // Если основной слайдер не найден — модуль не инициализируем
    if (!this.thesisCountSlider) return;

    this.renderThesisFields();
    this.thesisCountSlider.addEventListener('input', () => {
      this.renderThesisFields();
      // image handlers вызываются в renderThesisFields
    });
    if (this.closeThesisModalBtn) {
      this.closeThesisModalBtn.onclick = () => this.closeModal();
    }
    if (this.thesisModal) {
      this.thesisModal.addEventListener('mousedown', (e) => {
        if (e.target === this.thesisModal) this.closeModal();
      });
    }

    // Кроп и аудио
    if (this.applyCropBtn && this.closeCropModal && this.cropperImage) {
      this.setupCropper();
    }
    if (this.uploadAudio && this.audioPreview) {
      this.setupAudioPreview();
    }

    // Закрытие модалки по ESC
    document.addEventListener('keydown', (e) => {
      if (this.thesisModal && this.thesisModal.style.display === 'flex' && e.key === "Escape") {
        this.closeModal();
      }
    });

    const saveBtn = document.getElementById('save-thesis');
    if (saveBtn) {
        saveBtn.onclick = () => this.sendThesisToRender();}

  }
};

// Для глобального доступа
window.openThesisModal = () => window.thesis.openModal();
window.closeThesisModal = () => window.thesis.closeModal();