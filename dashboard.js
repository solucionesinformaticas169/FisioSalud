(() => {
  const summary = document.getElementById("dashboard-summary");
  const status = document.getElementById("dashboard-status");
  const board = document.getElementById("dashboard-board");
  const boardBadge = document.getElementById("dashboard-board-badge");
  const appointmentsContainer = document.getElementById("dashboard-appointments");
  const appointmentsBadge = document.getElementById("dashboard-appointments-badge");
  const dateBadge = document.getElementById("dashboard-date-badge");
  const refreshButton = document.getElementById("dashboard-refresh-button");

  if (!summary || !status || !board || !appointmentsContainer) {
    return;
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", loadDashboard);
  }

  loadDashboard();

  async function loadDashboard() {
    if (refreshButton) {
      refreshButton.disabled = true;
    }

    setStatus("Consultando dashboard del dia...", "neutral");

    try {
      const response = await fetch("/api/dashboard/today");
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo cargar el dashboard.");
      }

      renderSummary(payload?.totals || {});
      renderBoard(payload?.scheduleSlots || [], payload?.therapies || [], payload?.sessions || []);
      renderAppointments(payload?.appointments || []);

      if (dateBadge) {
        dateBadge.textContent = payload?.longDate || "Hoy";
      }

      setStatus("Dashboard cargado correctamente.", "success");
    } catch (error) {
      renderSummary({});
      renderBoard([], [], []);
      renderAppointments([]);
      if (dateBadge) {
        dateBadge.textContent = "Hoy";
      }
      setStatus(error.message || "No se pudo cargar el dashboard.", "error");
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
      }
    }
  }

  function renderSummary(totals) {
    const byTherapy = totals.byTherapy || {};
    summary.innerHTML = [
      createSummaryCard("Citas del dia", totals.appointments || 0),
      createSummaryCard("Sesiones del dia", totals.sessions || 0),
      createSummaryCard("Camilla", byTherapy.CAMILLA || 0),
      createSummaryCard("Rodilla/Tobillo", byTherapy.RODILLA_TOBILLO || 0),
      createSummaryCard("Hombro/Codo/Mano", byTherapy.HOMBRO_CODO_MANO || 0)
    ].join("");
  }

  function renderBoard(slots, therapies, sessions) {
    board.innerHTML = "";

    if (!slots.length || !therapies.length) {
      board.innerHTML = "<p class=\"results-placeholder\">No hay sesiones para mostrar hoy.</p>";
      updateBadge(boardBadge, "Sin datos", "subtle");
      return;
    }

    const grouped = new Map();
    sessions.forEach((session) => {
      const key = `${session.hora}|${session.tipo_terapia}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(session);
    });

    const table = document.createElement("div");
    table.className = "dashboard-grid-table";

    const headRow = document.createElement("div");
    headRow.className = "dashboard-grid-row dashboard-grid-head";
    headRow.appendChild(createGridCell("Hora", "is-hour is-head"));
    therapies.forEach((therapy) => {
      headRow.appendChild(createGridCell(formatTherapyLabel(therapy), "is-head"));
    });
    table.appendChild(headRow);

    slots.forEach((slot) => {
      const row = document.createElement("div");
      row.className = "dashboard-grid-row";
      row.appendChild(createGridCell(slot, "is-hour"));

      therapies.forEach((therapy) => {
        const cell = document.createElement("div");
        cell.className = "dashboard-grid-cell";
        const items = grouped.get(`${slot}|${therapy}`) || [];

        if (!items.length) {
          cell.innerHTML = "<span class=\"dashboard-empty\">-</span>";
        } else {
          items.forEach((item) => {
            const card = document.createElement("article");
            card.className = "dashboard-session-chip";
            card.innerHTML = `
              <strong>${escapeHtml(item.nombre)} ${escapeHtml(item.apellido)}</strong>
              <span>${escapeHtml(item.cedula)} · Sesion ${escapeHtml(item.numero_sesion)}</span>
              <span>${escapeHtml(item.diagnostico || "Sin diagnostico")}</span>
            `;
            cell.appendChild(card);
          });
        }

        row.appendChild(cell);
      });

      table.appendChild(row);
    });

    board.appendChild(table);
    updateBadge(boardBadge, `${sessions.length} sesion${sessions.length === 1 ? "" : "es"}`, sessions.length ? "" : "subtle");
  }

  function renderAppointments(appointments) {
    appointmentsContainer.innerHTML = "";

    if (!appointments.length) {
      appointmentsContainer.innerHTML = "<p class=\"results-placeholder\">No hay citas o valoraciones registradas para hoy.</p>";
      updateBadge(appointmentsBadge, "Sin datos", "subtle");
      return;
    }

    appointments.forEach((appointment) => {
      const item = document.createElement("article");
      item.className = "dashboard-appointment-card";
      item.innerHTML = `
        <div class="dashboard-appointment-head">
          <strong>${escapeHtml(appointment.hora)} · ${escapeHtml(appointment.nombre)} ${escapeHtml(appointment.apellido)}</strong>
          <span class="dashboard-origin-pill">${escapeHtml(appointment.origen || "WEB")}</span>
        </div>
        <div class="dashboard-appointment-meta">
          <span>Cedula: ${escapeHtml(appointment.cedula)}</span>
          <span>Estado: ${escapeHtml(formatStatusLabel(appointment.estado_atencion))}</span>
        </div>
        <p>${escapeHtml(appointment.observacion || "Sin observacion registrada.")}</p>
      `;
      appointmentsContainer.appendChild(item);
    });

    updateBadge(
      appointmentsBadge,
      `${appointments.length} cita${appointments.length === 1 ? "" : "s"}`,
      appointments.length ? "" : "subtle"
    );
  }

  function createSummaryCard(label, value) {
    return `
      <article class="dashboard-summary-card">
        <span class="dashboard-summary-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `;
  }

  function createGridCell(content, className = "") {
    const cell = document.createElement("div");
    cell.className = `dashboard-grid-cell ${className}`.trim();
    cell.textContent = content;
    return cell;
  }

  function updateBadge(element, text, extraClass = "") {
    if (!element) {
      return;
    }

    element.textContent = text;
    element.className = extraClass ? `badge ${extraClass}` : "badge";
  }

  function setStatus(text, level = "neutral") {
    status.textContent = text;
    status.className = `form-message ${level}`;
  }

  function formatTherapyLabel(value) {
    const labels = {
      CAMILLA: "Camilla",
      RODILLA_TOBILLO: "Rodilla/Tobillo",
      HOMBRO_CODO_MANO: "Hombro/Codo/Mano"
    };

    return labels[value] || String(value || "");
  }

  function formatStatusLabel(value) {
    return value === "ATENDIDO" ? "Atendido" : "No atendido";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
})();
