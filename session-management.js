(() => {
  const form = document.getElementById("session-management-form");
  const cedulaInput = document.getElementById("management-cedula");
  const status = document.getElementById("management-status");
  const error = document.getElementById("management-error");
  const button = document.getElementById("management-lookup-button");
  const results = document.getElementById("management-results");
  const summary = document.getElementById("management-results-summary");
  const MAX_CEDULA_LENGTH = 10;
  let lastCedula = "";

  if (!form || !cedulaInput || !status || !results || !summary) {
    return;
  }

  form.addEventListener("submit", handleLookup);
  cedulaInput.addEventListener("input", sanitizeCedulaInput);
  cedulaInput.addEventListener("paste", handleCedulaPaste);

  async function handleLookup(event) {
    event.preventDefault();
    clearError();
    const cedula = sanitizeCedula(cedulaInput.value);

    if (!/^\d{10}$/.test(cedula)) {
      showError("La cedula debe tener 10 digitos.");
      setStatus("Ingresa una cedula valida para buscar.", "warning");
      updateSummary("Sin consulta", "subtle");
      renderSessions([]);
      return;
    }

    lastCedula = cedula;
    await fetchAndRender(cedula);
  }

  async function fetchAndRender(cedula, options = { disableButton: true }) {
    if (options.disableButton && button) {
      button.disabled = true;
    }

    setStatus("Buscando sesiones futuras...", "neutral");

    try {
      const response = await fetch(`/api/session-plans/patient/${cedula}`);
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar las sesiones.");
      }

      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      renderSessions(sessions);
      updateSummary(`${sessions.length} sesion${sessions.length === 1 ? "" : "es"}`, sessions.length ? "" : "subtle");
      setStatus(
        sessions.length ? "Sesiones futuras encontradas." : "No hay sesiones futuras para esa cedula.",
        sessions.length ? "success" : "warning"
      );
    } catch (lookupError) {
      renderSessions([]);
      updateSummary("Sin consulta", "subtle");
      setStatus(lookupError.message || "No se pudo consultar las sesiones.", "error");
    } finally {
      if (options.disableButton && button) {
        button.disabled = false;
      }
    }
  }

  function renderSessions(sessions) {
    results.innerHTML = "";

    if (!sessions.length) {
      results.innerHTML = "<p class=\"results-placeholder\">No hay sesiones futuras para gestionar.</p>";
      return;
    }

    sessions.forEach((session) => {
      const entry = document.createElement("article");
      entry.className = "result-entry";

      const row = document.createElement("div");
      row.className = "report-row";
      row.innerHTML = `
        <strong>Sesion ${session.numero_sesion} · ${formatDateReadable(session.fecha)} · ${session.hora}</strong>
        <span>${session.cedula} · ${session.nombre} ${session.apellido}</span>
        <span>Tipo: ${formatTherapyLabel(session.tipo_terapia)} · Diagnostico: ${session.diagnostico || "Sin datos"}</span>
      `;

      const actions = document.createElement("div");
      actions.className = "result-actions";

      const rescheduleButton = document.createElement("button");
      rescheduleButton.type = "button";
      rescheduleButton.className = "secondary-button action-button";
      rescheduleButton.textContent = "Reagendar sesion";

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "secondary-button action-button";
      cancelButton.textContent = "Cancelar sesion";

      actions.append(rescheduleButton, cancelButton);

      const panel = createReschedulePanel(session);
      entry.append(row, actions, panel);
      results.appendChild(entry);

      rescheduleButton.addEventListener("click", () => togglePanel(panel, session));
      cancelButton.addEventListener("click", () => handleCancel(session));
    });
  }

  function togglePanel(panel, session) {
    const isVisible = !panel.classList.contains("hidden");
    document.querySelectorAll("#management-results .reschedule-panel").forEach((openPanel) => {
      openPanel.classList.add("hidden");
    });

    if (isVisible) {
      clearPanel(panel);
      panel.classList.add("hidden");
      return;
    }

    clearPanel(panel);
    panel.classList.remove("hidden");
    preparePanel(panel, session);
  }

  function preparePanel(panel, session) {
    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const message = panel.querySelector(".panel-message");

    if (!dateInput || !timeSelect) {
      return;
    }

    dateInput.min = getTodayIso();
    dateInput.value = "";
    timeSelect.innerHTML = '<option value="">Selecciona una fecha</option>';
    timeSelect.disabled = true;
    setPanelMessage(message, "Selecciona fecha y hora antes de confirmar.", "neutral");

    dateInput.onchange = () => loadAvailableTimes(session, dateInput.value, timeSelect, message);
  }

  async function loadAvailableTimes(session, date, select, message) {
    select.disabled = true;
    select.innerHTML = '<option value="">Cargando horarios...</option>';

    if (!date) {
      select.innerHTML = '<option value="">Selecciona una fecha</option>';
      setPanelMessage(message, "Selecciona una fecha valida.", "warning");
      select.disabled = false;
      return;
    }

    try {
      const params = new URLSearchParams({
        date,
        tipoTerapia: session.tipo_terapia,
        cedula: session.cedula,
        excludeSessionId: session.id
      });

      const response = await fetch(`/api/session-plans/available-times?${params.toString()}`);
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar la disponibilidad.");
      }

      const availableTimes = Array.isArray(payload.availableTimes) ? payload.availableTimes : [];
      if (!availableTimes.length) {
        select.innerHTML = '<option value="">Sin horarios disponibles</option>';
        setPanelMessage(message, "No hay horarios disponibles para esa fecha.", "warning");
      } else {
        select.innerHTML = availableTimes.map((time) => `<option value="${time}">${time}</option>`).join("");
        setPanelMessage(message, "Selecciona la hora deseada.", "success");
      }
    } catch (loadError) {
      select.innerHTML = '<option value="">Error al cargar horarios</option>';
      setPanelMessage(message, loadError.message || "No se pudo consultar la disponibilidad.", "error");
    } finally {
      select.disabled = false;
    }
  }

  async function handleReschedule(session, panel) {
    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const message = panel.querySelector(".panel-message");
    const confirmButton = panel.querySelector('button[data-action="confirm"]');
    const fecha = String(dateInput?.value || "").trim();
    const hora = String(timeSelect?.value || "").trim();

    if (!fecha) {
      setPanelMessage(message, "Selecciona una fecha para continuar.", "warning");
      return;
    }

    if (!hora) {
      setPanelMessage(message, "Selecciona una hora disponible.", "warning");
      return;
    }

    if (fecha === session.fecha && hora === session.hora) {
      setPanelMessage(message, "Selecciona una fecha u hora diferente.", "warning");
      return;
    }

    if (confirmButton) {
      confirmButton.disabled = true;
    }

    setPanelMessage(message, "Guardando nuevo horario...", "neutral");

    try {
      const response = await fetch(`/api/session-plans/sessions/${session.id}/reschedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, hora })
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo reprogramar la sesion.");
      }

      setPanelMessage(message, payload?.message || "Sesion reprogramada correctamente.", "success");
      setStatus(payload?.message || "Sesion reprogramada correctamente.", "success");
      clearPanel(panel);
      panel.classList.add("hidden");
      if (lastCedula) {
        await fetchAndRender(lastCedula, { disableButton: false });
      }
    } catch (rescheduleError) {
      setPanelMessage(message, rescheduleError.message || "No se pudo reprogramar la sesion.", "error");
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
      }
    }
  }

  async function handleCancel(session) {
    const confirmMessage = `Deseas cancelar la sesion ${session.numero_sesion} del ${formatDateReadable(session.fecha)} a las ${session.hora}?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setStatus("Cancelando sesion...", "neutral");

    try {
      const response = await fetch(`/api/session-plans/sessions/${session.id}`, {
        method: "DELETE"
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo cancelar la sesion.");
      }

      setStatus(payload?.message || "Sesion cancelada correctamente.", "success");
      if (lastCedula) {
        await fetchAndRender(lastCedula, { disableButton: false });
      }
    } catch (cancelError) {
      setStatus(cancelError.message || "No se pudo cancelar la sesion.", "error");
    }
  }

  function createReschedulePanel(session) {
    const panel = document.createElement("div");
    panel.className = "reschedule-panel hidden";
    panel.innerHTML = `
      <div class="grid">
        <label class="field">
          <span>Nueva fecha</span>
          <input type="date" class="reschedule-date">
        </label>
        <label class="field">
          <span>Hora disponible</span>
          <select class="reschedule-time" disabled>
            <option value="">Selecciona una fecha</option>
          </select>
        </label>
      </div>
      <p class="panel-message lookup-message neutral">Selecciona fecha y hora antes de confirmar.</p>
      <div class="reschedule-actions">
        <button type="button" class="secondary-button action-button" data-action="confirm">
          Confirmar cambio
        </button>
      </div>
    `;

    const confirmButton = panel.querySelector('button[data-action="confirm"]');
    confirmButton?.addEventListener("click", () => handleReschedule(session, panel));
    return panel;
  }

  function clearPanel(panel) {
    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const message = panel.querySelector(".panel-message");

    if (dateInput) {
      dateInput.value = "";
    }

    if (timeSelect) {
      timeSelect.innerHTML = '<option value="">Selecciona una fecha</option>';
      timeSelect.disabled = true;
    }

    setPanelMessage(message, "Selecciona fecha y hora antes de confirmar.", "neutral");
  }

  function sanitizeCedulaInput() {
    const sanitized = sanitizeCedula(cedulaInput.value);
    if (cedulaInput.value !== sanitized) {
      cedulaInput.value = sanitized;
    }
  }

  function handleCedulaPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData)?.getData("text") || "";
    cedulaInput.value = sanitizeCedula(text);
  }

  function sanitizeCedula(value) {
    return String(value || "").replace(/\D/g, "").slice(0, MAX_CEDULA_LENGTH);
  }

  function setStatus(text, level = "neutral") {
    status.textContent = text;
    status.className = `form-message ${level}`;
  }

  function setPanelMessage(element, text, level = "neutral") {
    if (!element) {
      return;
    }

    element.textContent = text;
    element.className = `panel-message lookup-message ${level}`;
  }

  function showError(message) {
    if (error) {
      error.textContent = message;
    }
  }

  function clearError() {
    if (error) {
      error.textContent = "";
    }
  }

  function updateSummary(text, extraClass = "") {
    summary.textContent = text;
    summary.className = extraClass ? `badge ${extraClass}` : "badge";
  }

  function formatDateReadable(value) {
    try {
      return new Intl.DateTimeFormat("es-EC", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      }).format(new Date(`${value}T00:00:00`));
    } catch (_error) {
      return value;
    }
  }

  function formatTherapyLabel(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getTodayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
})();
