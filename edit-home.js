if (!window.AppAuth.guardPage("ADMIN")) {
  throw new Error("Acceso restringido.");
}

const form = document.getElementById("site-content-form");
const message = document.getElementById("edit-message");
const carouselEditor = document.getElementById("carousel-editor");

const fields = {
  logoAlt: document.getElementById("logo-alt"),
  logoFile: document.getElementById("logo-file"),
  logoPreview: document.getElementById("logo-preview"),
  popupTitle: document.getElementById("popup-title-input"),
  popupText: document.getElementById("popup-text-input"),
  popupButtonLabel: document.getElementById("popup-button-label"),
  popupFile: document.getElementById("popup-file"),
  popupPreview: document.getElementById("popup-preview"),
  aboutTitle: document.getElementById("about-title-input"),
  aboutText: document.getElementById("about-text-input"),
  contactPhone: document.getElementById("contact-phone-input"),
  contactEmail: document.getElementById("contact-email-input"),
  contactAddress: document.getElementById("contact-address-input")
};

let siteContent = null;

initializeEditor();

async function initializeEditor() {
  await loadContent();
  fields.logoFile.addEventListener("change", () => previewFile(fields.logoFile, fields.logoPreview));
  fields.popupFile.addEventListener("change", () => previewFile(fields.popupFile, fields.popupPreview));
  form.addEventListener("submit", handleSubmit);
}

async function loadContent() {
  const response = await fetch("/api/site-content");
  siteContent = await response.json();
  populateForm(siteContent);
}

function populateForm(content) {
  fields.logoAlt.value = content.brand.logoAlt || "";
  fields.logoPreview.src = content.brand.logoSrc;

  fields.popupTitle.value = content.popup.title || "";
  fields.popupText.value = content.popup.text || "";
  fields.popupButtonLabel.value = content.popup.buttonLabel || "";
  fields.popupPreview.src = content.popup.imageSrc;

  fields.aboutTitle.value = content.about.title || "";
  fields.aboutText.value = content.about.text || "";
  fields.contactPhone.value = content.contact.phone || "";
  fields.contactEmail.value = content.contact.email || "";
  fields.contactAddress.value = content.contact.address || "";

  carouselEditor.innerHTML = "";
  content.carousel.slice(0, 4).forEach((item, index) => {
    const card = document.createElement("section");
    card.className = "slide-edit-card";
    card.innerHTML = `
      <div class="section-headline compact">
        <div>
          <p class="section-label">Slide ${index + 1}</p>
          <h3>Contenido del carrusel</h3>
        </div>
      </div>
      <div class="edit-grid">
        <label class="field">
          <span>Titulo</span>
          <input type="text" data-slide-title="${index}" maxlength="120" value="${escapeAttribute(item.title)}">
        </label>
        <label class="field field-full-grid">
          <span>Texto inferior</span>
          <textarea data-slide-caption="${index}" rows="4" maxlength="240">${escapeText(item.caption)}</textarea>
        </label>
        <label class="field">
          <span>Nueva imagen</span>
          <input type="file" data-slide-file="${index}" accept="image/*">
        </label>
      </div>
      <div class="preview-panel">
        <img data-slide-preview="${index}" src="${item.imageSrc}" alt="Preview slide ${index + 1}">
      </div>
    `;
    carouselEditor.appendChild(card);
  });

  carouselEditor.querySelectorAll("input[type='file']").forEach((input) => {
    input.addEventListener("change", () => {
      const index = input.getAttribute("data-slide-file");
      const preview = carouselEditor.querySelector(`[data-slide-preview="${index}"]`);
      previewFile(input, preview);
    });
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  message.textContent = "Guardando contenido...";
  message.className = "form-message warning";

  const carousel = await Promise.all(
    [...carouselEditor.querySelectorAll(".slide-edit-card")].map(async (_card, index) => ({
      title: carouselEditor.querySelector(`[data-slide-title="${index}"]`).value.trim(),
      caption: carouselEditor.querySelector(`[data-slide-caption="${index}"]`).value.trim(),
      imageUploadDataUrl: await fileToDataUrl(carouselEditor.querySelector(`[data-slide-file="${index}"]`).files[0])
    }))
  );

  const payload = {
    brand: {
      logoAlt: fields.logoAlt.value.trim(),
      logoUploadDataUrl: await fileToDataUrl(fields.logoFile.files[0])
    },
    popup: {
      title: fields.popupTitle.value.trim(),
      text: fields.popupText.value.trim(),
      buttonLabel: fields.popupButtonLabel.value.trim(),
      imageUploadDataUrl: await fileToDataUrl(fields.popupFile.files[0])
    },
    carousel,
    about: {
      title: fields.aboutTitle.value.trim(),
      text: fields.aboutText.value.trim()
    },
    contact: {
      phone: fields.contactPhone.value.trim(),
      email: fields.contactEmail.value.trim(),
      address: fields.contactAddress.value.trim()
    }
  };

  const session = window.AppAuth.getSession();
  const response = await fetch("/api/site-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-role": session?.role || ""
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    message.textContent = result.message || "No se pudo guardar el contenido.";
    message.className = "form-message error";
    return;
  }

  siteContent = result.content;
  populateForm(siteContent);
  clearFileInputs();
  message.textContent = "Contenido actualizado correctamente.";
  message.className = "form-message success";
}

function previewFile(input, previewElement) {
  const [file] = input.files;
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    previewElement.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function fileToDataUrl(file) {
  if (!file) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function clearFileInputs() {
  fields.logoFile.value = "";
  fields.popupFile.value = "";
  carouselEditor.querySelectorAll("input[type='file']").forEach((input) => {
    input.value = "";
  });
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
