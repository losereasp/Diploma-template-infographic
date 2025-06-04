setTimeout(() => {
  console.log("Скрипт `animation.js` загружен, вешаем обработчики!");
  
  document.querySelectorAll(".clickable-thesis").forEach(img => {
      console.log("Нашли картинку:", img);

      img.addEventListener("click", function () {
          const template = this.getAttribute("data-template");
          console.log("Клик по изображению, редирект на:", `thesis_edit.html?template=${template}`);
          window.location.href = `thesis_edit.html?template=${template}`;
      });
  });
}, 500);
