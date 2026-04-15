(() => {
  const webForm = document.getElementById("web-appointments-form");
  const sessionForm = document.getElementById("session-report-form");
  const webStartDate = document.getElementById("web-start-date");
  const webEndDate = document.getElementById("web-end-date");
  const webName = document.getElementById("web-name");
  const sessionStartDate = document.getElementById("session-start-date");
  const sessionEndDate = document.getElementById("session-end-date");
  const sessionCedula = document.getElementById("session-cedula");
  const sessionName = document.getElementById("session-name");

  const webResults = document.getElementById("web-appointments-results");
  const sessionResults = document.getElementById("session-appointments-results");
  const webStatus = document.getElementById("web-report-status");
  const sessionStatus = document.getElementById("session-report-status");
  const webSummary = document.getElementById("web-results-summary");
  const sessionSummary = document.getElementById("session-results-summary");
  const webButton = document.getElementById("web-appointments-button");
  const sessionButton = document.getElementById("session-report-button");

  if (webButton) {
    webButton.addEventListener("click", () => handleWebReport());
  }

  if (sessionButton) {
    sessionButton.addEventListener("click", () => handleSessionReport());
  }

  webName?.addEventListener("input", () => {
    webName.value = sanitizeName(webName.value, { preserveTrailingSpace: true });
  });

  sessionName?.addEventListener("input", () => {
    sessionName.value = sanitizeName(sessionName.value, { preserveTrailingSpace: true });
  });

  function handleWebReport() {
    const startDate = String(webStartDate?.value || "").trim();
    const endDate = String(webEndDate?.value || "").trim();
    const name = sanitizeName(webName?.value || "");

    if (!validateDates(startDate, endDate, webStatus)) {
      updateSummary(webSummary, "Sin consulta", "subtle");
      renderWebResults([]);
      return;
    }

    const params = { startDate, endDate };
    if (name) {
      params.name = name;
    }

    fetchReport("/api/reports/appointments", params)
      .then((result) => {
        const appointments = Array.isArray(result.appointments) ? result.appointments : [];
        renderWebResults(appointments);
        updateSummary(webSummary, `${appointments.length} cita${appointments.length === 1 ? "" : "s"}`, appointments.length ? "" : "subtle");
        setStatus(webStatus, appointments.length ? "Se encontraron citas agendadas." : "No hay citas en ese rango.", appointments.length ? "success" : "warning");
      })
      .catch((error) => {
        renderWebResults([]);
        updateSummary(webSummary, "Sin consulta", "subtle");
        setStatus(webStatus, error.message || "No se pudo consultar los pacientes.", "error");
      });
  }

  function handleSessionReport() {
    const startDate = String(sessionStartDate?.value || "").trim();
    const endDate = String(sessionEndDate?.value || "").trim();
    const cedula = sanitizeCedula(sessionCedula?.value || "");
    const name = sanitizeName(sessionName?.value || "");

    if (!validateDates(startDate, endDate, sessionStatus)) {
      updateSummary(sessionSummary, "Sin consulta", "subtle");
      renderSessionResults([]);
      return;
    }

    const params = { startDate, endDate };
    if (cedula.length === 10) {
      params.cedula = cedula;
    }
    if (name) {
      params.name = name;
    }

    fetchReport("/api/reports/sessions", params)
      .then((result) => {
        const sessions = Array.isArray(result.sessions) ? result.sessions : [];
        renderSessionResults(sessions);
        updateSummary(sessionSummary, `${sessions.length} sesiones`, sessions.length ? "" : "subtle");
        setStatus(sessionStatus, sessions.length ? "Sesiones encontradas." : "No hay sesiones en ese rango.", sessions.length ? "success" : "warning");
      })
      .catch((error) => {
        renderSessionResults([]);
        updateSummary(sessionSummary, "Sin consulta", "subtle");
        setStatus(sessionStatus, error.message || "No se pudo consultar las sesiones.", "error");
      });
  }

  function validateDates(startDate, endDate, statusElement) {
    if (!startDate || !endDate) {
      setStatus(statusElement, "Selecciona ambas fechas para continuar.", "warning");
      return false;
    }

    if (new Date(`${startDate}T00:00:00`).getTime() > new Date(`${endDate}T00:00:00`).getTime()) {
      setStatus(statusElement, "La fecha inicial no puede ser posterior a la final.", "warning");
      return false;
    }

    return true;
  }

  async function fetchReport(endpoint, params) {
    const query = new URLSearchParams(params);
    setStatus(endpoint === "/api/reports/appointments" ? webStatus : sessionStatus, "Consultando...", "neutral");
    const response = await fetch(`${endpoint}?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "No se pudo consultar el reporte.");
    }
    return payload;
  }

  function renderWebResults(appointments) {
    if (!webResults) {
      return;
    }

    if (!appointments.length) {
      webResults.innerHTML = "<p class=\"results-placeholder\">No hay citas agendadas para mostrar.</p>";
      return;
    }

    webResults.innerHTML = "";
    appointments.forEach((appointment) => {
      const row = document.createElement("article");
      row.className = "attendance-row";
      row.innerHTML = `
        <div class="attendance-main">
          <strong>${formatDate(appointment.fecha)} · ${appointment.hora}</strong>
          <span>${appointment.cedula} · ${appointment.nombre} ${appointment.apellido}</span>
          <span>Origen: ${appointment.origen || "Sin datos"} · Observación: ${appointment.observacion || "Sin datos"}</span>
        </div>
        <div class="attendance-controls">
          <button type="button" class="attendance-toggle${appointment.estado_atencion === "ATENDIDO" ? " is-active" : ""}" data-status="ATENDIDO">
            Atendido
          </button>
          <button type="button" class="attendance-toggle${appointment.estado_atencion === "NO_ATENDIDO" ? " is-active is-muted" : " is-muted"}" data-status="NO_ATENDIDO">
            No atendido
          </button>
        </div>
      `;

      const toggleButtons = Array.from(row.querySelectorAll(".attendance-toggle"));
      toggleButtons.forEach((toggle) => {
        toggle.addEventListener("click", async () => {
          const nextStatus = toggle.getAttribute("data-status");
          if (!nextStatus || nextStatus === appointment.estado_atencion) {
            return;
          }

          toggleButtons.forEach((buttonElement) => {
            buttonElement.disabled = true;
          });

          try {
            const response = await fetch(`/api/attendances/appointments/${appointment.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ estadoAtencion: nextStatus })
            });

            const payload = await safeJson(response);
            if (!response.ok) {
              throw new Error(payload?.message || "No se pudo actualizar el estado de la cita.");
            }

            appointment.estado_atencion = nextStatus;
            setStatus(webStatus, payload?.message || "Estado de atencion de la cita actualizado correctamente.", "success");
            renderWebResults(appointments);
          } catch (error) {
            setStatus(webStatus, error.message || "No se pudo actualizar el estado de la cita.", "error");
            toggleButtons.forEach((buttonElement) => {
              buttonElement.disabled = false;
            });
          }
        });
      });

      webResults.appendChild(row);
    });
  }

function renderSessionResults(sessions) {
  if (!sessionResults) {
    return;
  }

  if (!sessions.length) {
    sessionResults.innerHTML = "<p class=\"results-placeholder\">No hay sesiones registradas para mostrar.</p>";
    return;
  }

  const grouped = sessions.reduce((acc, session) => {
    const key = session.tipo_terapia || "SIN_TIPO";
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(session);
    return acc;
  }, {});

  const orderedKeys = Object.keys(grouped).sort((a, b) => {
    return formatTherapyLabel(a).localeCompare(formatTherapyLabel(b));
  });

  sessionResults.innerHTML = "";
  orderedKeys.forEach((therapyKey) => {
    const list = grouped[therapyKey];
    const therapyLabel = formatTherapyLabel(therapyKey) || "Sin tipo";
    const group = document.createElement("div");
    group.className = "session-group";

    const groupHead = document.createElement("div");
    groupHead.className = "session-group-head";
    groupHead.innerHTML = `<strong>${therapyLabel}</strong><span>${list.length} sesión${list.length === 1 ? "" : "es"}</span>`;
    group.appendChild(groupHead);

    list.forEach((session) => {
      const row = document.createElement("article");
      row.className = "report-row session-row";
      row.innerHTML = `
        <strong>${formatDate(session.fecha)} · ${session.hora}</strong>
        <span>${session.cedula} · ${session.nombre} ${session.apellido}</span>
        <span>Diagnóstico: ${session.diagnostico || "Sin datos"}</span>
      `;
      group.appendChild(row);
    });

    sessionResults.appendChild(group);
  });
}

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat("es-EC", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      }).format(new Date(`${value}T00:00:00`));
    } catch (error) {
      return value;
    }
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

  function setStatus(element, text, level) {
    if (!element) {
      return;
    }

    element.textContent = text;
    element.className = `form-message ${level}`;
  }

  function updateSummary(summaryElement, text, extraClass = "") {
    if (!summaryElement) {
      return;
    }

    summaryElement.textContent = text;
    summaryElement.className = extraClass ? `badge ${extraClass}` : "badge";
  }

  function formatTherapyLabel(value) {
    if (!value) {
      return "";
    }

    return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
})();
