(() => {
  const lookupForm = document.getElementById("lookup-form");
  const lookupCedula = document.getElementById("lookup-cedula");
  const lookupStatus = document.getElementById("lookup-status");
  const lookupError = document.getElementById("lookup-error");
  const lookupButton = document.getElementById("lookup-button");
  const resultsContainer = document.getElementById("appointments-container");
  const flatpickrInstances = new WeakMap();
  const MAX_CEDULA_LENGTH = 10;
  let lastCedula = "";

  if (!lookupForm || !lookupStatus || !resultsContainer) {
    return;
  }

  lookupForm.addEventListener("submit", handleLookup);
  lookupCedula?.addEventListener("input", sanitizeCedulaInput);
  lookupCedula?.addEventListener("paste", handleCedulaPaste);

  async function handleLookup(event) {
    event.preventDefault();
    clearLookupError();
    const cedula = String(lookupCedula?.value || "").replace(/\D/g, "");

    if (!/^\d{10}$/.test(cedula)) {
      showLookupError("La cédula debe tener 10 dígitos.");
      setLookupStatus("Ingresa una cédula válida para buscar.", "warning");
      return;
    }

    lastCedula = cedula;
    await fetchAndRender(cedula);
  }

  async function fetchAndRender(cedula, options = { disableButton: true }) {
    if (options.disableButton && lookupButton) {
      lookupButton.disabled = true;
    }
    setLookupStatus("Buscando citas...", "neutral");

    try {
      const response = await fetch(`/api/appointments/patient/${cedula}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        const payload = await safeJson(response);
        throw new Error(payload?.message || "No se pudo consultar las citas.");
      }

      const payload = await response.json();
      const appointments = Array.isArray(payload.appointments) ? payload.appointments : [];
      renderAppointments(appointments);

      if (appointments.length === 0) {
        setLookupStatus("No hay citas registradas para esa cédula.", "warning");
      } else {
        const plural = appointments.length === 1 ? "" : "s";
        setLookupStatus(`Se encontraron ${appointments.length} cita${plural}.`, "success");
      }
    } catch (error) {
      setLookupStatus(error.message || "No se pudo consultar las citas.", "error");
      renderAppointments([]);
    } finally {
      if (options.disableButton && lookupButton) {
        lookupButton.disabled = false;
      }
    }
  }

  function sanitizeCedulaInput() {
    if (!lookupCedula) {
      return;
    }

    const cleaned = (lookupCedula.value || "").replace(/\D/g, "");
    const truncated = cleaned.slice(0, MAX_CEDULA_LENGTH);
    if (lookupCedula.value !== truncated) {
      lookupCedula.value = truncated;
    }
  }

  function handleCedulaPaste(event) {
    if (!lookupCedula) {
      return;
    }

    event.preventDefault();
    const clipboard = (event.clipboardData || window.clipboardData)?.getData("text") || "";
    const clean = clipboard.replace(/\D/g, "");
    if (!clean) {
      return;
    }

    const { selectionStart = 0, selectionEnd = 0, value = "" } = lookupCedula;
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    const combined = (before + clean + after).replace(/\D/g, "");
    const truncated = combined.slice(0, MAX_CEDULA_LENGTH);
    lookupCedula.value = truncated;
    const caretPosition = Math.min(before.length + clean.length, truncated.length);
    lookupCedula.setSelectionRange(caretPosition, caretPosition);
  }

  function renderAppointments(appointments) {
    resultsContainer.innerHTML = "";

    if (!appointments.length) {
      resultsContainer.innerHTML = `
        <p class="results-placeholder">
          No hay citas agendadas para mostrar. Puedes intentar con otra cédula.
        </p>
      `;
      return;
    }

    appointments.forEach((appointment) => {
      const entry = document.createElement("article");
      entry.className = "result-entry";

      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <div class="result-main">
          <strong>${formatDateReadable(appointment.fecha)}</strong>
          <span>${appointment.hora} · Origen: ${appointment.origen}</span>
          <span>${appointment.observacion ? `Observación: ${appointment.observacion}` : "Observación: Sin datos"}</span>
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "result-actions";
      const rescheduleButton = document.createElement("button");
      rescheduleButton.type = "button";
      rescheduleButton.className = "secondary-button action-button";
      rescheduleButton.textContent = "Reagendar";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "secondary-button action-button";
      cancelButton.textContent = "Cancelar cita";
      actions.append(rescheduleButton, cancelButton);

      const panel = createReschedulePanel(appointment);

      entry.append(row, actions, panel);
      resultsContainer.appendChild(entry);

      rescheduleButton.addEventListener("click", () => toggleReschedulePanel(panel, appointment));
      cancelButton.addEventListener("click", () => handleCancel(appointment, cancelButton, entry));
    });
  }

  function toggleReschedulePanel(panel, appointment) {
    const isVisible = !panel.classList.contains("hidden");
    document.querySelectorAll(".reschedule-panel").forEach((openPanel) => openPanel.classList.add("hidden"));

    if (isVisible) {
      panel.classList.add("hidden");
      clearRescheduleInputs(panel);
      return;
    }

    panel.classList.remove("hidden");
    prepareReschedulePanel(panel, appointment);
  }

  function prepareReschedulePanel(panel, appointment) {
    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const panelMessage = panel.querySelector(".panel-message");

    setPanelMessage(panelMessage, "Selecciona fecha y hora antes de confirmar.", "neutral");
    timeSelect.innerHTML = '<option value="">Selecciona una fecha</option>';
    timeSelect.disabled = true;

    if (typeof flatpickr === "undefined" || !dateInput) {
      return;
    }

    if (!flatpickrInstances.has(dateInput)) {
      const picker = flatpickr(dateInput, {
        locale: "es",
        dateFormat: "Y-m-d",
        minDate: "today",
        disable: [(date) => date.getDay() === 0 || date.getDay() === 6],
        onChange: (_, dateStr) => loadAvailableTimes(dateStr, timeSelect, panelMessage)
      });
      flatpickrInstances.set(dateInput, picker);
    } else {
      const picker = flatpickrInstances.get(dateInput);
      picker.clear();
    }
  }

  async function loadAvailableTimes(date, select, messageElement) {
    if (!select) {
      return;
    }

    select.disabled = true;
    select.innerHTML = '<option value="">Cargando horarios...</option>';

    if (!date) {
      select.innerHTML = '<option value="">Selecciona una fecha</option>';
      select.disabled = false;
      setPanelMessage(messageElement, "Selecciona una fecha válida.", "warning");
      return;
    }

    try {
      const response = await fetch(`/api/appointments/available-hours?date=${encodeURIComponent(date)}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("No se pudo obtener la disponibilidad.");
      }

      const payload = await response.json();
      const hours = Array.isArray(payload.availableHours) ? payload.availableHours : [];

      if (!hours.length) {
        select.innerHTML = '<option value="">Sin horarios disponibles</option>';
        setPanelMessage(messageElement, "No hay horarios disponibles para esa fecha.", "warning");
      } else {
        select.innerHTML = hours.map((hour) => `<option value="${hour}">${hour}</option>`).join("");
        setPanelMessage(messageElement, "Selecciona la hora deseada.", "success");
      }
    } catch (error) {
      select.innerHTML = '<option value="">Error al cargar horarios</option>';
      setPanelMessage(messageElement, error.message || "No se pudo consultar la disponibilidad.", "error");
    } finally {
      select.disabled = false;
    }
  }

  function clearRescheduleInputs(panel) {
    if (!panel) {
      return;
    }

    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const panelMessage = panel.querySelector(".panel-message");

    if (dateInput) {
      const picker = flatpickrInstances.get(dateInput);
      if (picker) {
        picker.clear();
      }
      dateInput.value = "";
    }

    if (timeSelect) {
      timeSelect.innerHTML = '<option value="">Selecciona una fecha</option>';
      timeSelect.disabled = true;
    }

    setPanelMessage(panelMessage, "Selecciona fecha y hora antes de confirmar.", "neutral");
  }

  async function handleReschedule(appointment, panel) {
    const dateInput = panel.querySelector(".reschedule-date");
    const timeSelect = panel.querySelector(".reschedule-time");
    const panelMessage = panel.querySelector(".panel-message");
    const confirmButton = panel.querySelector('button[data-action="confirm"]');

    const newDate = String(dateInput?.value || "").trim();
    const newTime = String(timeSelect?.value || "").trim();

    if (!newDate) {
      setPanelMessage(panelMessage, "Selecciona una fecha para continuar.", "warning");
      return;
    }

    if (!newTime) {
      setPanelMessage(panelMessage, "Selecciona una hora disponible.", "warning");
      return;
    }

    if (newDate === appointment.fecha && newTime === appointment.hora) {
      setPanelMessage(panelMessage, "Selecciona una fecha u hora diferente.", "warning");
      return;
    }

    if (confirmButton) {
      confirmButton.disabled = true;
    }

    setPanelMessage(panelMessage, "Guardando nuevo horario...", "neutral");

    try {
      const response = await fetch(`/api/appointments/${appointment.id}/reschedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: newDate, hora: newTime })
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo reprogramar la cita.");
      }

      setPanelMessage(panelMessage, payload?.message || "Cita reprogramada correctamente.", "success");
      setLookupStatus(payload?.message || "Cita reprogramada correctamente.", "success");
      clearRescheduleInputs(panel);
      panel.classList.add("hidden");
      if (lastCedula) {
        await fetchAndRender(lastCedula, { disableButton: false });
      }
    } catch (error) {
      setPanelMessage(panelMessage, error.message || "No se pudo reprogramar la cita.", "error");
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
      }
    }
  }

  async function handleCancel(appointment, cancelButton, entry) {
    const confirmCancel = window.confirm(
      `¿Deseas cancelar la cita del ${formatDateReadable(appointment.fecha)} a las ${appointment.hora}?`
    );
    if (!confirmCancel) {
      return;
    }

    if (cancelButton) {
      cancelButton.disabled = true;
      cancelButton.textContent = "Cancelando...";
    }

    setLookupStatus("Cancelando cita...", "neutral");

    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "DELETE",
        cache: "no-store"
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo cancelar la cita.");
      }

      if (entry) {
        entry.remove();
      }

      setLookupStatus(payload?.message || "Cita cancelada correctamente.", "success");
      if (lastCedula) {
        await fetchAndRender(lastCedula, { disableButton: false });
      }
    } catch (error) {
      setLookupStatus(error.message || "No se pudo cancelar la cita.", "error");
    } finally {
      if (cancelButton) {
        cancelButton.disabled = false;
        cancelButton.textContent = "Cancelar cita";
      }
    }
  }

  function createReschedulePanel(appointment) {
    const panel = document.createElement("div");
    panel.className = "reschedule-panel hidden";
    panel.innerHTML = `
      <div class="grid">
        <label class="field">
          <span>Nueva fecha</span>
          <input type="text" class="reschedule-date" placeholder="Selecciona un día">
        </label>
        <label class="field">
          <span>Hora disponible</span>
          <select class="reschedule-time">
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
    confirmButton?.addEventListener("click", () => handleReschedule(appointment, panel));

    return panel;
  }

  function setLookupStatus(text, level = "neutral") {
    if (!lookupStatus) {
      return;
    }
    lookupStatus.textContent = text;
    lookupStatus.className = `form-message ${level}`;
  }

  function showLookupError(message) {
    if (lookupError) {
      lookupError.textContent = message;
    }
  }

  function clearLookupError() {
    if (lookupError) {
      lookupError.textContent = "";
    }
  }

  function setPanelMessage(element, text, level = "neutral") {
    if (!element) {
      return;
    }
    element.textContent = text;
    element.className = `panel-message lookup-message ${level}`;
  }

  function formatDateReadable(value) {
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

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
})();
