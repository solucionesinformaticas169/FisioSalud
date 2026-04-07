(() => {
  const form = document.getElementById("attendances-form");
  const dateInput = document.getElementById("attendance-date");
  const status = document.getElementById("attendance-status");
  const summary = document.getElementById("attendance-summary");
  const results = document.getElementById("attendance-results");
  const button = document.getElementById("attendance-button");

  if (!form || !dateInput || !status || !summary || !results) {
    return;
  }

  dateInput.value = getTodayIso();
  form.addEventListener("submit", handleSubmit);

  async function handleSubmit(event) {
    event.preventDefault();
    const date = String(dateInput.value || "").trim();

    if (!date) {
      setStatus("Selecciona una fecha para continuar.", "warning");
      updateSummary("Sin consulta", "subtle");
      renderSessions([]);
      return;
    }

    await fetchAndRender(date);
  }

  async function fetchAndRender(date) {
    if (button) {
      button.disabled = true;
    }

    setStatus("Consultando atenciones...", "neutral");

    try {
      const response = await fetch(`/api/attendances/sessions?date=${encodeURIComponent(date)}`);
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar las atenciones.");
      }

      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      renderSessions(sessions);
      updateSummary(`${sessions.length} sesion${sessions.length === 1 ? "" : "es"}`, sessions.length ? "" : "subtle");
      setStatus(
        sessions.length ? "Atenciones cargadas correctamente." : "No hay sesiones registradas para esa fecha.",
        sessions.length ? "success" : "warning"
      );
    } catch (error) {
      renderSessions([]);
      updateSummary("Sin consulta", "subtle");
      setStatus(error.message || "No se pudo consultar las atenciones.", "error");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function renderSessions(sessions) {
    results.innerHTML = "";

    if (!sessions.length) {
      results.innerHTML = "<p class=\"results-placeholder\">No hay sesiones para mostrar en la fecha seleccionada.</p>";
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

    Object.keys(grouped)
      .sort((a, b) => formatTherapyLabel(a).localeCompare(formatTherapyLabel(b)))
      .forEach((therapyKey) => {
        const list = grouped[therapyKey];
        const card = document.createElement("section");
        card.className = "attendance-group";

        const head = document.createElement("div");
        head.className = "attendance-group-head";
        head.innerHTML = `
          <div>
            <strong>${formatTherapyLabel(therapyKey)}</strong>
            <span>${list.length} sesion${list.length === 1 ? "" : "es"}</span>
          </div>
        `;
        card.appendChild(head);

        list.forEach((session) => {
          const row = document.createElement("article");
          row.className = "attendance-row";
          row.innerHTML = `
            <div class="attendance-main">
              <strong>${session.hora} · Sesion ${session.numero_sesion}</strong>
              <span>${session.cedula} · ${session.nombre} ${session.apellido}</span>
              <span>Diagnostico: ${session.diagnostico || "Sin datos"}</span>
            </div>
            <div class="attendance-controls">
              <button type="button" class="attendance-toggle${session.estado_atencion === "ATENDIDO" ? " is-active" : ""}" data-status="ATENDIDO">
                Atendido
              </button>
              <button type="button" class="attendance-toggle${session.estado_atencion === "NO_ATENDIDO" ? " is-active is-muted" : " is-muted"}" data-status="NO_ATENDIDO">
                No atendido
              </button>
            </div>
          `;

          const buttons = Array.from(row.querySelectorAll(".attendance-toggle"));
          buttons.forEach((toggle) => {
            toggle.addEventListener("click", async () => {
              const nextStatus = toggle.getAttribute("data-status");
              if (!nextStatus || nextStatus === session.estado_atencion) {
                return;
              }

              buttons.forEach((buttonElement) => {
                buttonElement.disabled = true;
              });

              try {
                const response = await fetch(`/api/attendances/sessions/${session.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ estadoAtencion: nextStatus })
                });

                const payload = await safeJson(response);
                if (!response.ok) {
                  throw new Error(payload?.message || "No se pudo actualizar el estado.");
                }

                session.estado_atencion = nextStatus;
                setStatus(payload?.message || "Estado de atencion actualizado correctamente.", "success");
                renderSessions(sessions);
              } catch (error) {
                setStatus(error.message || "No se pudo actualizar el estado.", "error");
                buttons.forEach((buttonElement) => {
                  buttonElement.disabled = false;
                });
              }
            });
          });

          card.appendChild(row);
        });

        results.appendChild(card);
      });
  }

  function setStatus(text, level = "neutral") {
    status.textContent = text;
    status.className = `form-message ${level}`;
  }

  function updateSummary(text, extraClass = "") {
    summary.textContent = text;
    summary.className = extraClass ? `badge ${extraClass}` : "badge";
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
