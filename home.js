const popupOverlay = document.getElementById("popup-overlay");
const popupClose = document.getElementById("popup-close");
const popupImage = document.getElementById("popup-image");
const popupTitle = document.getElementById("popup-title");
const popupText = document.getElementById("popup-text");
const popupButton = document.getElementById("popup-button");
const brandLogo = document.getElementById("brand-logo");
const aboutTitle = document.getElementById("about-title");
const aboutText = document.getElementById("about-text");
const contactPhone = document.getElementById("contact-phone");
const contactEmail = document.getElementById("contact-email");
const contactAddress = document.getElementById("contact-address");
const carouselTrack = document.getElementById("carousel-track");
const carouselDots = document.getElementById("carousel-dots");
const prevButton = document.getElementById("carousel-prev");
const nextButton = document.getElementById("carousel-next");
const loginLink = document.getElementById("login-link");
const roleLinkGroup = document.getElementById("role-link-group");
const publicLinkGroup = document.getElementById("public-link-group");
const welcomeStatus = document.getElementById("welcome-status");
const navToggle = document.getElementById("nav-toggle");
const siteNav = document.getElementById("site-nav");
const POPUP_SESSION_KEY = "homePopupShown";

let currentSlide = 0;
let slides = [];
let slideTimer = null;

initializeHome();

async function initializeHome() {
  bindNav();
  renderRoleLinks();
  await loadSiteContent();
}

function bindNav() {
  if (navToggle && siteNav) {
    navToggle.addEventListener("click", () => {
      siteNav.classList.toggle("open");
    });

    document.addEventListener("click", (event) => {
      if (!siteNav.classList.contains("open")) {
        return;
      }

      if (siteNav.contains(event.target) || navToggle.contains(event.target)) {
        return;
      }

      siteNav.classList.remove("open");
    });

    siteNav.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (link) {
        siteNav.classList.remove("open");
      }
    });
  }

  if (popupClose) {
    popupClose.addEventListener("click", closePopup);
  }

  if (popupOverlay) {
    popupOverlay.addEventListener("click", (event) => {
      if (event.target === popupOverlay) {
        closePopup();
      }
    });
  }
}

async function loadSiteContent() {
  try {
    const response = await fetch("/api/site-content");
    const content = await response.json();
    renderSiteContent(content);
  } catch (_error) {
    renderFallbackMessage();
  }
}

function renderSiteContent(content) {
  if (brandLogo) {
    brandLogo.src = content.brand.logoSrc;
    brandLogo.alt = content.brand.logoAlt;
  }

  popupImage.src = content.popup.imageSrc;
  popupTitle.textContent = content.popup.title;
  popupText.textContent = content.popup.text;
  popupButton.textContent = content.popup.buttonLabel || "Agenda tu cita";
  popupButton.href = "/agendamiento";

  aboutTitle.textContent = content.about.title;
  aboutText.textContent = content.about.text;
  contactPhone.textContent = content.contact.phone;
  contactEmail.textContent = content.contact.email;
  contactAddress.textContent = content.contact.address;

  renderCarousel(content.carousel || []);

  if (content.popup.enabled && !sessionStorage.getItem(POPUP_SESSION_KEY)) {
    window.setTimeout(() => {
      popupOverlay.classList.remove("hidden");
      sessionStorage.setItem(POPUP_SESSION_KEY, "true");
    }, 900);
  }
}

function renderCarousel(items) {
  carouselTrack.innerHTML = "";
  carouselDots.innerHTML = "";
  slides = items.slice(0, 4);

  slides.forEach((item, index) => {
    const slide = document.createElement("article");
    slide.className = `carousel-slide${index === 0 ? " active" : ""}`;
    slide.innerHTML = `
      <div class="carousel-media" style="background-image: url('${escapeAttribute(item.imageSrc)}');">
        <img src="${item.imageSrc}" alt="${escapeHtml(item.title)}">
      </div>
      <div class="carousel-caption">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.caption)}</p>
      </div>
    `;
    carouselTrack.appendChild(slide);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `carousel-dot${index === 0 ? " active" : ""}`;
    dot.setAttribute("aria-label", `Ir al slide ${index + 1}`);
    dot.addEventListener("click", () => goToSlide(index));
    carouselDots.appendChild(dot);
  });

  prevButton.addEventListener("click", () => goToSlide((currentSlide - 1 + slides.length) % slides.length));
  nextButton.addEventListener("click", () => goToSlide((currentSlide + 1) % slides.length));
  startCarousel();
}

function goToSlide(index) {
  currentSlide = index;
  const slideNodes = carouselTrack.querySelectorAll(".carousel-slide");
  const dotNodes = carouselDots.querySelectorAll(".carousel-dot");

  slideNodes.forEach((slide, slideIndex) => {
    slide.classList.toggle("active", slideIndex === index);
  });

  dotNodes.forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === index);
  });

  startCarousel();
}

function startCarousel() {
  if (slideTimer) {
    window.clearInterval(slideTimer);
  }

  if (slides.length <= 1) {
    return;
  }

  slideTimer = window.setInterval(() => {
    goToSlide((currentSlide + 1) % slides.length);
  }, 5500);
}

function closePopup() {
  popupOverlay.classList.add("hidden");
}

function renderRoleLinks() {
  const session = window.AppAuth.getSession();
  if (publicLinkGroup) {
    publicLinkGroup.innerHTML = buildPrimaryNav(session);
  }

  if (roleLinkGroup) {
    roleLinkGroup.innerHTML = "";
  }

  if (welcomeStatus) {
    welcomeStatus.textContent = session
      ? `Bienvenido, ${session.name || session.username || ""} (${window.AppAuth.getRoleLabel(session.role)})`
      : "";
  }

  setupLoginAction(session);
}

function renderFallbackMessage() {
  if (carouselTrack) {
    carouselTrack.innerHTML = `
      <article class="carousel-slide active">
        <div class="carousel-caption">
          <h3>Atención profesional y cercana</h3>
          <p>No se pudo cargar el contenido dinámico. Revisa el servidor y vuelve a intentarlo.</p>
        </div>
      </article>
    `;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

function buildPrimaryNav(session) {
  const role = session?.role || "PUBLIC";
  const baseLinks = [
    { href: "/", label: "Inicio" },
    { href: "/#conocenos", label: "Conócenos" },
    { href: "/#servicios", label: "Servicios" },
    { href: "/#contactanos", label: "Contáctanos" }
  ];

  const entries = baseLinks.map((link) => `<a href="${link.href}">${link.label}</a>`);

  if (role === "PUBLIC") {
    entries.push(
      buildPublicDropdown("Menú", [
        { href: "/agendamiento", label: "Agenda tu cita" },
        { href: "/consulta-cita", label: "Consulta tu cita" }
      ])
    );

    return entries.join("");
  }

  return buildRoleMenu(role);
}

function buildRoleMenu(role) {
  const itemsByRole = {
    USER: [
      { href: "/ingreso-paciente", label: "Ingreso de Paciente" },
      { href: "/historia-clinica", label: "Historia Clínica" },
      { href: "/consulta-citas", label: "Consulta de Citas" },
      { href: "/plan-sesiones", label: "Plan de Sesiones" },
      { href: "/consulta-sesiones", label: "Consulta de Sesiones" },
      { href: "/reagendar-sesiones", label: "Reagendar Sesiones" },
      { href: "/atenciones", label: "Atención de Sesiones" },
      { href: "/seguimiento-sesiones", label: "Seguimiento de Sesiones" },
      { href: "/dashboard", label: "Dashboard" }
    ],
    ADMIN: [
      { href: "/ingreso-paciente", label: "Ingreso de Paciente" },
      { href: "/historia-clinica", label: "Historia Clínica" },
      { href: "/consulta-citas", label: "Consulta de Citas" },
      { href: "/plan-sesiones", label: "Plan de Sesiones" },
      { href: "/consulta-sesiones", label: "Consulta de Sesiones" },
      { href: "/reagendar-sesiones", label: "Reagendar Sesiones" },
      { href: "/atenciones", label: "Atención de Sesiones" },
      { href: "/seguimiento-sesiones", label: "Seguimiento de Sesiones" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/edicion", label: "Edición" }
    ],
    SUPERADMIN: [
      { href: "/ingreso-paciente", label: "Ingreso de Paciente" },
      { href: "/historia-clinica", label: "Historia Clínica" },
      { href: "/agendamiento", label: "Agenda tu cita" },
      { href: "/consulta-citas", label: "Consulta de Citas" },
      { href: "/plan-sesiones", label: "Plan de Sesiones" },
      { href: "/consulta-sesiones", label: "Consulta de Sesiones" },
      { href: "/reagendar-sesiones", label: "Reagendar Sesiones" },
      { href: "/atenciones", label: "Atención de Sesiones" },
      { href: "/seguimiento-sesiones", label: "Seguimiento de Sesiones" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/historial-accesos", label: "Historial de accesos" },
      { href: "/usuarios", label: "Usuarios" }
    ]
  };

  return buildMenuDropdown("Menú", itemsByRole[role] || []);
}

function buildPublicDropdown(label, items) {
  const submenu = items
    .map((item) => `<a href="${item.href}">${item.label}</a>`)
    .join("");

  return `
    <span class="nav-with-submenu">
      <a class="nav-primary-link" href="${items[0]?.href || "#"}">${label}</a>
      <div class="nav-submenu">
        ${submenu}
      </div>
    </span>
  `;
}

function buildMenuDropdown(label, items) {
  const submenu = items
    .map((item) => `<a href="${item.href}">${item.label}</a>`)
    .join("");

  return `
    <span class="nav-with-submenu nav-with-submenu-menu">
      <button class="nav-menu-trigger" type="button" aria-haspopup="true" aria-expanded="false">${label}</button>
      <div class="nav-submenu">
        ${submenu}
      </div>
    </span>
  `;
}

function buildLoginHref() {
  return `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
}

function setupLoginAction(session) {
  if (!loginLink) {
    return;
  }

  if (session) {
    loginLink.textContent = "Salir";
    loginLink.href = "#";
    loginLink.addEventListener("click", async (event) => {
      event.preventDefault();
      await window.AppAuth.logout();
      window.location.href = "/";
    }, { once: true });
    return;
  }

  loginLink.textContent = "Login";
  loginLink.href = buildLoginHref();
}
