(() => {
  const form = document.getElementById("history-filters-form");
  const usernameInput = document.getElementById("history-username");
  const startDateInput = document.getElementById("history-start-date");
  const endDateInput = document.getElementById("history-end-date");
  const statusInput = document.getElementById("history-status");
  const statusMessage = document.getElementById("history-status-message");
  const historyList = document.getElementById("history-list");
  const historySummary = document.getElementById("history-summary");
  const historyResultsCount = document.getElementById("history-results-count");
  const resetButton = document.getElementById("history-reset-button");
  let latestRequestId = 0;

  if (!form || !historyList || !statusMessage || !historySummary || !historyResultsCount) {
    return;
  }

  form.addEventListener("submit", handleSubmit);
  resetButton?.addEventListener("click", () => {
    form.reset();
    clearHistoryView();
  });

  loadHistory();

  async function handleSubmit(event) {
    event.preventDefault();
    await loadHistory();
  }

  async function loadHistory() {
    const requestId = ++latestRequestId;
    setStatus("Consultando historial...", "neutral");
    historyList.innerHTML = '<p class="results-placeholder">Cargando accesos...</p>';

    const params = new URLSearchParams();
    if (usernameInput.value.trim()) {
      params.set("username", usernameInput.value.trim());
    }
    if (startDateInput?.value) {
      params.set("startDate", startDateInput.value);
    }
    if (endDateInput?.value) {
      params.set("endDate", endDateInput.value);
    }
    if (statusInput.value) {
      params.set("status", statusInput.value);
    }

    try {
      const query = params.toString();
      const response = await fetch(`/api/admin/login-history${query ? `?${query}` : ""}`, {
        headers: window.AppAuth.getAuthHeaders(),
        cache: "no-store"
      });
      const payload = await safeJson(response);

      if (requestId !== latestRequestId) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar el historial.");
      }

      const rows = Array.isArray(payload.history) ? payload.history : [];
      renderHistory(rows);
      historySummary.textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
      historyResultsCount.textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
      setStatus(rows.length ? "Historial cargado correctamente." : "No hay accesos con ese filtro.", rows.length ? "success" : "warning");
    } catch (error) {
      if (requestId !== latestRequestId) {
        return;
      }

      historySummary.textContent = "Sin carga";
      historyResultsCount.textContent = "0 registros";
      historyList.innerHTML = '<p class="results-placeholder">No fue posible cargar el historial de accesos.</p>';
      setStatus(error.message || "No se pudo consultar el historial.", "error");
    }
  }

  function renderHistory(rows) {
    if (!rows.length) {
      historyResultsCount.textContent = "0 registros";
      historyList.innerHTML = '<p class="results-placeholder">No hay accesos registrados con los filtros seleccionados.</p>';
      return;
    }

    historyList.innerHTML = rows.map((row) => {
      const heading = row.nombre_usuario
        ? `${escapeHtml(row.nombre_usuario)} (@${escapeHtml(row.username_intento)})`
        : `@${escapeHtml(row.username_intento)}`;
      const role = formatRole(row.role_usuario);
      const loginStatus = row.login_exitoso ? "Exitoso" : "Fallido";
      const activeStatus = row.sesion_activa ? "Activa" : "Cerrada";
      const failureReason = row.motivo_fallo ? `<p><strong>Detalle:</strong> ${escapeHtml(formatFailureReason(row.motivo_fallo))}</p>` : "";

      return `
        <article class="access-card">
          <div class="access-card-head">
            <div>
              <strong>${heading}</strong>
              <p class="user-meta">${escapeHtml(role)} · ${escapeHtml(loginStatus)} · ${escapeHtml(activeStatus)}</p>
            </div>
            <span class="badge${row.sesion_activa ? "" : " subtle"}">${row.sesion_activa ? "Activa" : loginStatus}</span>
          </div>
          <div class="access-card-grid">
            <p><strong>Ingreso:</strong> ${escapeHtml(formatDateTime(row.fecha_hora_ingreso))}</p>
            <p><strong>Cierre:</strong> ${escapeHtml(row.fecha_hora_cierre ? formatDateTime(row.fecha_hora_cierre) : "Sin cierre registrado")}</p>
            <p><strong>Ultima actividad:</strong> ${escapeHtml(row.ultima_actividad ? formatDateTime(row.ultima_actividad) : "Sin actividad")}</p>
            <p><strong>Navegador:</strong> ${escapeHtml(row.navegador || "No identificado")}</p>
            <p><strong>Sistema:</strong> ${escapeHtml(row.sistema_operativo || "No identificado")}</p>
            <p><strong>IP:</strong> ${escapeHtml(row.direccion_ip || "No disponible")}</p>
          </div>
          ${failureReason}
        </article>
      `;
    }).join("");
  }

  function formatRole(role) {
    return {
      USER: "Usuario",
      ADMIN: "Admin",
      SUPERADMIN: "SuperAdmin"
    }[role] || "Sin rol";
  }

  function formatFailureReason(reason) {
    return {
      DATOS_INCOMPLETOS: "Intento sin usuario o contrasena completa.",
      USUARIO_NO_EXISTE: "El usuario consultado no existe.",
      USUARIO_INACTIVO: "El usuario esta inactivo.",
      CONTRASENA_INVALIDA: "La contrasena ingresada no es correcta.",
      LOGOUT: "Sesion cerrada por el usuario.",
      SESION_CERRADA_POR_INACTIVIDAD: "Sesion cerrada por inactividad o cierre del navegador."
    }[reason] || reason;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("es-EC", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  }

  function setStatus(message, level) {
    statusMessage.textContent = message;
    statusMessage.className = `form-message ${level}`;
  }

  function clearHistoryView() {
    historySummary.textContent = "Sin carga";
    historyResultsCount.textContent = "0 registros";
    historyList.innerHTML = '<p class="results-placeholder">Aplica filtros para consultar accesos.</p>';
    setStatus("Filtros limpiados. Aplica una consulta para ver resultados.", "neutral");
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
      return null;
    }
  }
})();
