(() => {
  const form = document.getElementById("clinical-history-form");
  const cedulaInput = document.getElementById("clinical-history-cedula");
  const nameInput = document.getElementById("clinical-history-name");
  const status = document.getElementById("clinical-history-status");
  const button = document.getElementById("clinical-history-button");
  const results = document.getElementById("clinical-history-results");
  const countBadge = document.getElementById("clinical-history-count");
  const summaryBadge = document.getElementById("clinical-history-summary");

  if (!form || !cedulaInput || !nameInput || !status || !button || !results || !countBadge || !summaryBadge) {
    return;
  }

  cedulaInput.addEventListener("input", () => {
    cedulaInput.value = sanitizeCedula(cedulaInput.value);
  });

  cedulaInput.addEventListener("paste", () => {
    window.setTimeout(() => {
      cedulaInput.value = sanitizeCedula(cedulaInput.value);
    }, 0);
  });

  nameInput.addEventListener("input", () => {
    nameInput.value = sanitizeName(nameInput.value, { preserveTrailingSpace: true });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await searchClinicalHistory();
  });

  async function searchClinicalHistory() {
    const cedula = sanitizeCedula(cedulaInput.value);
    const name = sanitizeName(nameInput.value);

    if (!cedula && !name) {
      setStatus("Ingresa una cédula o un nombre para consultar.", "warning");
      renderPlans([]);
      return;
    }

    if (cedula && !/^\d{10}$/.test(cedula)) {
      setStatus("La cédula debe tener 10 dígitos.", "warning");
      renderPlans([]);
      return;
    }

    setLoading(true);
    setStatus("Consultando historia clínica...", "neutral");

    try {
      const params = new URLSearchParams();
      if (cedula) {
        params.set("cedula", cedula);
      }
      if (name) {
        params.set("name", name);
      }

      const response = await fetch(`/api/clinical-history/search?${params.toString()}`, {
        headers: window.AppAuth?.getAuthHeaders?.() || {}
      });
      const payload = await safeJson(response);

      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar la historia clínica.");
      }

      const plans = Array.isArray(payload.plans) ? payload.plans : [];
      renderPlans(plans);
      setStatus(
        plans.length ? "Historia clínica consultada correctamente." : "No se encontraron planes para ese criterio.",
        plans.length ? "success" : "warning"
      );
    } catch (error) {
      renderPlans([]);
      setStatus(error.message || "No se pudo consultar la historia clínica.", "error");
    } finally {
      setLoading(false);
    }
  }

  function renderPlans(plans) {
    results.innerHTML = "";
    const totalLabel = `${plans.length} plan${plans.length === 1 ? "" : "es"}`;
    countBadge.textContent = totalLabel;
    countBadge.className = plans.length ? "badge" : "badge subtle";
    summaryBadge.textContent = plans.length ? totalLabel : "Sin consulta";
    summaryBadge.className = plans.length ? "badge" : "badge subtle";

    if (!plans.length) {
      results.innerHTML = '<p class="results-placeholder">No hay planes de sesiones para mostrar.</p>';
      return;
    }

    plans.forEach((plan) => {
      const entry = document.createElement("article");
      entry.className = "clinical-history-card";
      entry.innerHTML = `
        <div class="clinical-history-card-head">
          <div>
            <p class="clinical-history-patient">${escapeHtml(`${plan.apellido} ${plan.nombre}`.trim())}</p>
            <h4>Plan #${escapeHtml(String(plan.id))} · ${escapeHtml(formatTherapyLabel(plan.tipo_terapia))}</h4>
          </div>
          <button type="button" class="secondary-button action-button" data-plan-id="${escapeHtml(String(plan.id))}">
            <span class="button-main">VER</span>
            <span class="button-sub">Detalle de sesiones</span>
          </button>
        </div>
        <div class="clinical-history-meta">
          <span><strong>Cédula:</strong> ${escapeHtml(plan.cedula)}</span>
          <span><strong>Diagnóstico:</strong> ${escapeHtml(plan.diagnostico || "Sin datos")}</span>
          <span><strong>Fecha inicial:</strong> ${escapeHtml(formatDate(plan.fecha_inicial))}</span>
          <span><strong>Hora inicial:</strong> ${escapeHtml(plan.hora_inicial || "Sin hora")}</span>
          <span><strong>Observación:</strong> ${escapeHtml(plan.observacion || "Sin observación registrada.")}</span>
        </div>
        <div class="clinical-history-stats">
          <span class="clinical-history-stat">
            <strong>${escapeHtml(String(plan.total_sesiones || 0))}</strong>
            <small>Sesiones</small>
          </span>
          <span class="clinical-history-stat is-success">
            <strong>${escapeHtml(String(plan.sesiones_atendidas || 0))}</strong>
            <small>Atendidas</small>
          </span>
          <span class="clinical-history-stat is-warning">
            <strong>${escapeHtml(String(plan.sesiones_no_atendidas || 0))}</strong>
            <small>No atendidas</small>
          </span>
        </div>
        <div class="clinical-history-detail hidden">
          <p class="results-placeholder">Presiona VER para cargar las sesiones del plan.</p>
        </div>
      `;

      results.appendChild(entry);

      const detail = entry.querySelector(".clinical-history-detail");
      const viewButton = entry.querySelector("button[data-plan-id]");
      viewButton?.addEventListener("click", async () => {
        await togglePlanDetail(plan.id, detail, viewButton);
      });
    });
  }

  async function togglePlanDetail(planId, container, buttonElement) {
    const isVisible = !container.classList.contains("hidden");

    if (isVisible) {
      container.classList.add("hidden");
      return;
    }

    document.querySelectorAll(".clinical-history-detail").forEach((detailElement) => {
      detailElement.classList.add("hidden");
    });

    container.classList.remove("hidden");
    container.innerHTML = '<p class="results-placeholder">Cargando sesiones del plan...</p>';
    buttonElement.disabled = true;

    try {
      const response = await fetch(`/api/clinical-history/plans/${encodeURIComponent(planId)}`, {
        headers: window.AppAuth?.getAuthHeaders?.() || {}
      });
      const payload = await safeJson(response);

      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar el detalle del plan.");
      }

      renderPlanDetail(container, payload.plan, Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch (error) {
      container.innerHTML = `<p class="form-message error">${escapeHtml(error.message || "No se pudo consultar el detalle del plan.")}</p>`;
    } finally {
      buttonElement.disabled = false;
    }
  }

  function renderPlanDetail(container, plan, sessions) {
    if (!sessions.length) {
      container.innerHTML = '<p class="results-placeholder">Este plan no tiene sesiones registradas.</p>';
      return;
    }

    const rows = sessions.map((session) => `
      <article class="clinical-session-row">
        <div class="clinical-session-main">
          <strong>Sesión ${escapeHtml(String(session.numero_sesion))} · ${escapeHtml(formatDate(session.fecha))} · ${escapeHtml(session.hora || "Sin hora")}</strong>
          <span>Terapia: ${escapeHtml(formatTherapyLabel(session.tipo_terapia))}</span>
        </div>
        <span class="clinical-session-status ${session.estado_atencion === "ATENDIDO" ? "is-success" : "is-warning"}">
          ${escapeHtml(session.estado_atencion === "ATENDIDO" ? "Atendida" : "No atendida")}
        </span>
      </article>
    `).join("");

    container.innerHTML = `
      <div class="clinical-history-detail-head">
        <div>
          <p class="section-label">Detalle del plan</p>
          <h5>${escapeHtml(`${plan.apellido} ${plan.nombre}`.trim())}</h5>
        </div>
        <div class="clinical-history-detail-summary">
          <span class="badge">${escapeHtml(String(plan.sesiones_atendidas || 0))} atendidas</span>
          <span class="badge subtle">${escapeHtml(String(plan.sesiones_no_atendidas || 0))} no atendidas</span>
        </div>
      </div>
      <div class="clinical-session-list">${rows}</div>
    `;
  }

  function sanitizeCedula(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
  }

  function sanitizeName(value, options = {}) {
    const { preserveTrailingSpace = false } = options;
    const rawValue = String(value || "");
    const hasTrailingSpace = /\s$/.test(rawValue);
    let sanitized = rawValue
      .replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+/g, "");

    if (!preserveTrailingSpace || !hasTrailingSpace) {
      sanitized = sanitized.trimEnd();
    }

    return sanitized.slice(0, 80);
  }

  function setStatus(message, level = "neutral") {
    status.textContent = message;
    status.className = `form-message ${level}`;
  }

  function setLoading(isLoading) {
    button.disabled = isLoading;
  }

  function formatDate(value) {
    if (!value) {
      return "Sin fecha";
    }

    try {
      return new Intl.DateTimeFormat("es-EC", {
        day: "2-digit",
        month: "long",
        year: "numeric"
      }).format(new Date(`${value}T00:00:00`));
    } catch (_error) {
      return value;
    }
  }

  function formatTherapyLabel(value) {
    const labels = {
      CAMILLA: "Camilla",
      RODILLA_TOBILLO: "Rodilla Tobillo",
      HOMBRO_CODO_MANO: "Hombro Codo Mano"
    };

    return labels[value] || String(value || "Sin tipo");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (_error) {
      return {};
    }
  }
})();
