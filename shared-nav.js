initializeSharedNav();

async function initializeSharedNav() {
  const navToggle = document.getElementById("nav-toggle");
  const siteNav = document.getElementById("site-nav");
  const loginLink = document.getElementById("login-link");
  const roleLinkGroup = document.getElementById("role-link-group");
  const publicLinkGroup = document.getElementById("public-link-group");
  const welcomeStatus = document.getElementById("welcome-status");
  const brandLogo = document.getElementById("brand-logo");

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

  const session = window.AppAuth?.getSession?.() || null;

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

  setupLoginAction(loginLink, session);

  if (brandLogo) {
    try {
      const response = await fetch("/api/site-content");
      if (response.ok) {
        const content = await response.json();
        brandLogo.src = content.brand.logoSrc;
        brandLogo.alt = content.brand.logoAlt;
      }
    } catch (_error) {
      // Si falla, mantenemos el logo por defecto del HTML.
    }
  }
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
      buildDropdown("/agendamiento", "Agenda tu cita", [
        { href: "/consulta-cita", label: "Consulta tu cita" }
      ])
    );

    return entries.join("");
  }

  const ingresoItems = [];

  if (role === "SUPERADMIN") {
    ingresoItems.push({ href: "/agendamiento", label: "Agenda tu cita" });
  }

  ingresoItems.push(
    { href: "/plan-sesiones", label: "Plan de Sesiones" },
    { href: "/consulta-cita", label: "Consulta tu cita" },
    { href: "/consulta-citas", label: "Consulta de citas" },
    { href: "/consulta-sesiones", label: "Consulta de Sesiones" },
    { href: "/reagendar-sesiones", label: "Reagendar sesiones" },
    { href: "/atenciones", label: "Atenciones" },
    { href: "/seguimiento-sesiones", label: "Seguimiento de sesiones" }
  );

  if (role === "ADMIN" || role === "SUPERADMIN") {
    ingresoItems.push({ href: "/edicion", label: "Edición" });
  }

  if (role === "SUPERADMIN") {
    ingresoItems.push({ href: "/historial-accesos", label: "Historial de accesos" });
  }

  if (role === "SUPERADMIN") {
    ingresoItems.push({ href: "/usuarios", label: "Usuarios" });
  }

  entries.push(buildDropdown("/ingreso-paciente", "Ingreso de Paciente", ingresoItems));
  return entries.join("");
}

function buildDropdown(primaryHref, label, items) {
  const submenu = items
    .map((item) => `<a href="${item.href}">${item.label}</a>`)
    .join("");

  return `
    <span class="nav-with-submenu">
      <a class="nav-primary-link" href="${primaryHref}">${label}</a>
      <div class="nav-submenu">
        ${submenu}
      </div>
    </span>
  `;
}

function buildLoginHref() {
  return `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
}

function setupLoginAction(loginLink, session) {
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
    });
    return;
  }

  loginLink.textContent = "Login";
  loginLink.href = buildLoginHref();
}
