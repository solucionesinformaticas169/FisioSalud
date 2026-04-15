const followUpForm = document.getElementById("follow-up-form");
const startDateInput = document.getElementById("follow-up-start-date");
const endDateInput = document.getElementById("follow-up-end-date");
const cedulaInput = document.getElementById("follow-up-cedula");
const nameInput = document.getElementById("follow-up-name");
const followUpStatus = document.getElementById("follow-up-status");
const followUpButton = document.getElementById("follow-up-button");
const followUpResults = document.getElementById("follow-up-results");
const followUpSummary = document.getElementById("follow-up-summary");
const followUpHeadBadge = document.getElementById("follow-up-head-badge");
const totalSessionsValue = document.getElementById("total-sessions-value");
const attendedSessionsValue = document.getElementById("attended-sessions-value");
const pendingSessionsValue = document.getElementById("pending-sessions-value");

initializeFollowUp();

function initializeFollowUp() {
  if (!followUpForm) {
    return;
  }

  setDefaultDates();

  cedulaInput.addEventListener("input", () => {
    cedulaInput.value = cedulaInput.value.replace(/\D/g, "").slice(0, 10);
  });

  cedulaInput.addEventListener("paste", () => {
    window.setTimeout(() => {
      cedulaInput.value = cedulaInput.value.replace(/\D/g, "").slice(0, 10);
    }, 0);
  });

  nameInput?.addEventListener("input", () => {
    nameInput.value = sanitizeName(nameInput.value, { preserveTrailingSpace: true });
  });

  followUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadFollowUp();
  });
}

function setDefaultDates() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);

  startDateInput.value = toIsoDate(start);
  endDateInput.value = toIsoDate(today);
}

async function loadFollowUp() {
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const cedula = cedulaInput.value.replace(/\D/g, "");
  const name = sanitizeName(nameInput?.value || "");

  if (!startDate || !endDate) {
    setStatus("Debes seleccionar la fecha inicial y la fecha final.", "error");
    return;
  }

  if (cedula && cedula.length !== 10) {
    setStatus("La cedula debe tener exactamente 10 digitos.", "error");
    return;
  }

  setLoading(true);
  setStatus("Consultando seguimiento de sesiones...", "neutral");

  try {
    const query = new URLSearchParams({ startDate, endDate });
    if (cedula) {
      query.set("cedula", cedula);
    }
    if (name) {
      query.set("name", name);
    }

    const response = await fetch(`/api/reports/session-follow-up?${query.toString()}`);
    const data = await safeJson(response);

    if (!response.ok) {
      throw new Error(data.message || "No se pudo consultar el seguimiento.");
    }

    renderTotals(data.totals || { totalSesiones: 0, atendidas: 0, pendientes: 0 });
    renderResults(data.summaries || []);

    const count = Array.isArray(data.summaries) ? data.summaries.length : 0;
    const summaryLabel = count === 1 ? "1 paciente" : `${count} pacientes`;

    followUpSummary.textContent = summaryLabel;
    followUpHeadBadge.textContent = summaryLabel;
    setStatus(
      count ? "Seguimiento generado correctamente." : "No se encontraron sesiones en el rango consultado.",
      count ? "success" : "neutral"
    );
  } catch (error) {
    renderTotals({ totalSesiones: 0, atendidas: 0, pendientes: 0 });
    followUpResults.innerHTML = '<p class="results-placeholder">No fue posible cargar la informacion solicitada.</p>';
    followUpSummary.textContent = "Sin resultados";
    followUpHeadBadge.textContent = "Sin resultados";
    setStatus(error.message || "No se pudo consultar el seguimiento.", "error");
  } finally {
    setLoading(false);
  }
}

function renderTotals(totals) {
  totalSessionsValue.textContent = String(totals.totalSesiones || 0);
  attendedSessionsValue.textContent = String(totals.atendidas || 0);
  pendingSessionsValue.textContent = String(totals.pendientes || 0);
}

function renderResults(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    followUpResults.innerHTML = '<p class="results-placeholder">No hay sesiones para mostrar en este seguimiento.</p>';
    return;
  }

  followUpResults.innerHTML = summaries.map((summary) => {
    const total = Number(summary.total_sesiones || 0);
    const attended = Number(summary.atendidas || 0);
    const pending = Number(summary.pendientes || 0);
    const percentage = total > 0 ? Math.round((attended / total) * 100) : 0;
    const progressLabel = percentage === 100 ? "Completado" : `${percentage}% avanzado`;

    return `
      <article class="follow-up-card">
        <div class="follow-up-card-head">
          <div>
            <p class="section-label">Paciente</p>
            <h4>${escapeHtml(`${summary.apellido} ${summary.nombre}`)}</h4>
            <p class="follow-up-meta">${escapeHtml(summary.cedula)} · ${escapeHtml(summary.tipo_terapia)} · Diagnostico: ${escapeHtml(summary.diagnostico || "SIN DATO")}</p>
          </div>
          <span class="badge">${escapeHtml(progressLabel)}</span>
        </div>

        <div class="follow-up-progress">
          <div class="follow-up-progress-bar">
            <span class="follow-up-progress-fill" style="width: ${percentage}%"></span>
          </div>
          <div class="follow-up-progress-labels">
            <span>Inicio: ${escapeHtml(formatDate(summary.fecha_inicio))}</span>
            <span>Fin: ${escapeHtml(formatDate(summary.fecha_fin))}</span>
          </div>
        </div>

        <div class="follow-up-stats">
          <div class="follow-up-stat">
            <span>Total</span>
            <strong>${total}</strong>
          </div>
          <div class="follow-up-stat is-success">
            <span>Atendidas</span>
            <strong>${attended}</strong>
          </div>
          <div class="follow-up-stat is-warning">
            <span>Pendientes</span>
            <strong>${pending}</strong>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function setStatus(message, type) {
  followUpStatus.textContent = message;
  followUpStatus.className = `form-message ${type}`;
}

function setLoading(isLoading) {
  followUpButton.disabled = isLoading;
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
