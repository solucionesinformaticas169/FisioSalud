const SESSION_SLOT_OPTIONS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"
];

const form = document.querySelector("#session-plan-form");
const fields = {
  cedula: document.querySelector("#cedula"),
  nombre: document.querySelector("#nombre"),
  diagnostico: document.querySelector("#diagnostico"),
  numeroSesiones: document.querySelector("#numero-sesiones"),
  fechaInicial: document.querySelector("#fecha-inicial"),
  horaInicial: document.querySelector("#hora-inicial"),
  tipoTerapia: document.querySelector("#tipo-terapia"),
  observacion: document.querySelector("#observacion")
};

const lookupMessage = document.querySelector("#lookup-message");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const consultButton = document.querySelector("#consult-button");
const resultsContainer = document.querySelector("#results-container");
const resultsSummary = document.querySelector("#results-summary");

let datePicker = null;
let lastLookupValue = "";
let suggestedSessions = [];
let lastObservedCedulaValue = "";
let hasConsultedAvailability = false;

initializeDatePicker();
setDefaultHour();

fields.cedula.addEventListener("input", handleCedulaInput);
fields.cedula.addEventListener("paste", handleCedulaPaste);
fields.cedula.addEventListener("change", handleCedulaInput);
fields.cedula.addEventListener("blur", handleCedulaInput);
fields.diagnostico.addEventListener("input", () => {
  fields.diagnostico.value = normalizeDiagnosis(fields.diagnostico.value);
});
fields.observacion.addEventListener("input", () => {
  fields.observacion.value = normalizeLetters(fields.observacion.value);
});
consultButton.addEventListener("click", consultAvailability);

if (fields.cedula.value.trim().length === 10) {
  handleCedulaInput();
}

window.setInterval(() => {
  const currentValue = sanitizeCedula(fields.cedula.value);
  if (currentValue !== lastObservedCedulaValue) {
    lastObservedCedulaValue = currentValue;
    if (fields.cedula.value !== currentValue) {
      fields.cedula.value = currentValue;
    }
    handleCedulaInput();
  }
}, 250);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  if (!validateForm(true)) {
    setFormMessage("Corrige los campos marcados para continuar.", "error");
    return;
  }

  const payload = {
    cedula: fields.cedula.value.trim(),
    diagnostico: fields.diagnostico.value.trim(),
    numeroSesiones: Number(fields.numeroSesiones.value),
    fechaInicial: fields.fechaInicial.value,
    horaInicial: fields.horaInicial.value,
    tipoTerapia: fields.tipoTerapia.value,
    observacion: fields.observacion.value.trim(),
    sesiones: collectSelectedSessions()
  };

  try {
    setSubmitState(true);
    const response = await fetch("/api/session-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      setFormMessage(result.message || "No se pudo guardar el plan.", "error");
      return;
    }

    setLookupMessage("Paciente validado correctamente.", "success");
    setFormMessage("Agendado exitoso.", "success");
    window.setTimeout(() => {
      resetForm();
      setFormMessage("Consulta la disponibilidad y luego agenda el plan.", "neutral");
      setLookupMessage("Ingresa una cedula para consultar al paciente.", "neutral");
    }, 5000);
  } catch (_error) {
    setFormMessage("No se pudo conectar con el servidor.", "error");
  } finally {
    setSubmitState(false);
  }
});

async function handleCedulaInput() {
  clearMessages();
  const previousCedula = lastLookupValue;
  fields.cedula.value = sanitizeCedula(fields.cedula.value);
  clearFieldError("cedula");

  if (previousCedula && previousCedula !== fields.cedula.value) {
    resetPlanFieldsForCedulaChange(fields.cedula.value);
  } else {
    resetAvailabilityState();
  }

  if (fields.cedula.value.length !== 10) {
    lastLookupValue = "";
    fields.nombre.value = "";
    setLookupMessage("Ingresa una cedula para consultar al paciente.", "neutral");
    return;
  }

  if (fields.cedula.value === lastLookupValue) {
    return;
  }

  lastLookupValue = fields.cedula.value;

  try {
    const response = await fetch(`/api/patients/${fields.cedula.value}`);
    const result = await response.json();

    if (response.ok && result.exists) {
      fields.nombre.value = `${result.patient.nombre || ""} ${result.patient.apellido || ""}`.trim();
      setLookupMessage("Paciente encontrado. Nombre cargado automaticamente.", "success");
    } else {
      fields.nombre.value = "";
      setLookupMessage("Paciente no encontrado. La cedula debe existir para crear el plan.", "warning");
    }
  } catch (_error) {
    fields.nombre.value = "";
    setLookupMessage("No se pudo consultar la base de datos.", "error");
  }
}

function handleCedulaPaste(event) {
  event.preventDefault();
  fields.cedula.value = sanitizeCedula(event.clipboardData.getData("text"));
  handleCedulaInput();
}

async function consultAvailability() {
  clearMessages();
  hasConsultedAvailability = false;

  if (!validateSearchForm()) {
    setFormMessage("Completa los datos requeridos para consultar.", "error");
    return;
  }

  const params = new URLSearchParams({
    cedula: fields.cedula.value.trim(),
    numeroSesiones: fields.numeroSesiones.value,
    fechaInicial: fields.fechaInicial.value,
    horaInicial: fields.horaInicial.value,
    tipoTerapia: fields.tipoTerapia.value
  });

  try {
    setConsultState(true);
    const response = await fetch(`/api/session-plans/availability?${params.toString()}`);
    const result = await response.json();

    if (!response.ok) {
      suggestedSessions = [];
      renderResults([]);
      setFormMessage(result.message || "No se pudo consultar la disponibilidad.", "error");
      return;
    }

    suggestedSessions = Array.isArray(result.sessions) ? result.sessions : [];
    renderResults(suggestedSessions);
    hasConsultedAvailability = suggestedSessions.length > 0;
    setFormMessage("Disponibilidad consultada correctamente.", "success");
    resultsContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (_error) {
    suggestedSessions = [];
    hasConsultedAvailability = false;
    renderResults([]);
    setFormMessage("No se pudo conectar con el servidor.", "error");
  } finally {
    setConsultState(false);
  }
}

function validateSearchForm() {
  let isValid = true;

  if (!/^\d{10}$/.test(fields.cedula.value.trim())) {
    showFieldError("cedula", "La cedula debe tener exactamente 10 digitos.");
    isValid = false;
  } else {
    clearFieldError("cedula");
  }

  if (!fields.nombre.value.trim()) {
    showFieldError("nombre", "Debes seleccionar una cedula de paciente existente.");
    isValid = false;
  } else {
    clearFieldError("nombre");
  }

  if (!/^(10|[1-9])$/.test(fields.numeroSesiones.value)) {
    showFieldError("numero-sesiones", "Selecciona entre 1 y 10 sesiones.");
    isValid = false;
  } else {
    clearFieldError("numero-sesiones");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.fechaInicial.value)) {
    showFieldError("fecha-inicial", "Selecciona una fecha inicial.");
    isValid = false;
  } else {
    clearFieldError("fecha-inicial");
  }

  if (!SESSION_SLOT_OPTIONS.includes(fields.horaInicial.value)) {
    showFieldError("hora-inicial", "Selecciona una hora valida de 30 minutos.");
    isValid = false;
  } else {
    clearFieldError("hora-inicial");
  }

  if (!["CAMILLA", "RODILLA_TOBILLO", "HOMBRO_CODO_MANO"].includes(fields.tipoTerapia.value)) {
    showFieldError("tipo-terapia", "Selecciona un tipo de terapia.");
    isValid = false;
  } else {
    clearFieldError("tipo-terapia");
  }

  return isValid;
}

function validateForm(requireResults) {
  let isValid = true;

  if (!/^\d{10}$/.test(fields.cedula.value.trim())) {
    showFieldError("cedula", "La cedula debe tener exactamente 10 digitos.");
    isValid = false;
  } else {
    clearFieldError("cedula");
  }

  if (!fields.nombre.value.trim()) {
    showFieldError("nombre", "Debes seleccionar una cedula de paciente existente.");
    isValid = false;
  } else {
    clearFieldError("nombre");
  }

  if (!/^[A-Z0-9ÁÉÍÓÚÑ ]+$/.test(fields.diagnostico.value.trim())) {
    showFieldError("diagnostico", "El diagnostico solo permite letras y numeros en mayusculas.");
    isValid = false;
  } else {
    clearFieldError("diagnostico");
  }

  if (!/^(10|[1-9])$/.test(fields.numeroSesiones.value)) {
    showFieldError("numero-sesiones", "Selecciona entre 1 y 10 sesiones.");
    isValid = false;
  } else {
    clearFieldError("numero-sesiones");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.fechaInicial.value)) {
    showFieldError("fecha-inicial", "Selecciona una fecha inicial.");
    isValid = false;
  } else {
    clearFieldError("fecha-inicial");
  }

  if (!SESSION_SLOT_OPTIONS.includes(fields.horaInicial.value)) {
    showFieldError("hora-inicial", "Selecciona una hora valida de 30 minutos.");
    isValid = false;
  } else {
    clearFieldError("hora-inicial");
  }

  if (!["CAMILLA", "RODILLA_TOBILLO", "HOMBRO_CODO_MANO"].includes(fields.tipoTerapia.value)) {
    showFieldError("tipo-terapia", "Selecciona un tipo de terapia.");
    isValid = false;
  } else {
    clearFieldError("tipo-terapia");
  }

  if (!fields.observacion.value.trim()) {
    showFieldError("observacion", "La observacion es obligatoria.");
    isValid = false;
  } else if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(fields.observacion.value.trim())) {
    showFieldError("observacion", "La observacion solo permite letras.");
    isValid = false;
  } else {
    clearFieldError("observacion");
  }

  if (requireResults) {
    if (!hasConsultedAvailability) {
      setFormMessage("Debes consultar la disponibilidad antes de agendar el plan.", "error");
      isValid = false;
    }

    const sessions = collectSelectedSessions();
    if (sessions.length !== Number(fields.numeroSesiones.value || 0)) {
      setFormMessage("Consulta primero las sesiones y verifica los resultados.", "error");
      isValid = false;
    }

    if (hasDuplicateSelectedTimes()) {
      setFormMessage("No puedes repetir la misma fecha y hora dentro del plan.", "error");
      isValid = false;
    }
  }

  return isValid;
}

function renderResults(sessions) {
  resultsContainer.innerHTML = "";

  if (sessions.length === 0) {
    resultsSummary.textContent = "Sin resultados";
    resultsSummary.className = "badge subtle";
    resultsContainer.innerHTML = "<p class=\"results-placeholder\">No hay resultados para mostrar.</p>";
    return;
  }

  resultsSummary.textContent = `${sessions.length} sesiones sugeridas`;
  resultsSummary.className = "badge";

  sessions.forEach((session) => {
    const article = document.createElement("article");
    article.className = "result-row";

    const title = document.createElement("div");
    title.className = "result-main";
    title.innerHTML = `<strong>Sesion ${session.sessionNumber}</strong><span>${session.weekdayLabel} ${session.dateLabel}</span><span>Cupos restantes: ${session.remainingCapacity}</span>`;

    const selectWrap = document.createElement("div");
    selectWrap.className = "result-time";
    const select = document.createElement("select");
    select.className = "result-time-select";
    session.availableTimes.forEach((time) => {
      const option = document.createElement("option");
      option.value = time;
      option.textContent = time;
      if (time === session.selectedTime) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    select.addEventListener("change", (event) => {
      const found = suggestedSessions.find((item) => item.sessionNumber === session.sessionNumber);
      if (found) {
        found.selectedTime = event.target.value;
      }
    });
    selectWrap.appendChild(select);

    article.appendChild(title);
    article.appendChild(selectWrap);
    resultsContainer.appendChild(article);
  });
}

function collectSelectedSessions() {
  return suggestedSessions.map((session) => ({
    sessionNumber: session.sessionNumber,
    date: session.date,
    time: session.selectedTime
  }));
}

function hasDuplicateSelectedTimes() {
  const used = new Set();
  for (const session of collectSelectedSessions()) {
    const key = `${session.date}-${session.time}`;
    if (used.has(key)) {
      return true;
    }
    used.add(key);
  }
  return false;
}

function initializeDatePicker() {
  if (typeof flatpickr === "undefined") {
    return;
  }

  if (flatpickr.l10ns && flatpickr.l10ns.es) {
    flatpickr.localize(flatpickr.l10ns.es);
  }

  datePicker = flatpickr(fields.fechaInicial, {
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    allowInput: false,
    disableMobile: true,
    minDate: "today",
    prevArrow: "<",
    nextArrow: ">",
    disable: [(date) => date.getDay() === 0 || date.getDay() === 6]
  });
}

function setDefaultHour() {
  const now = new Date();
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const nextSlot = SESSION_SLOT_OPTIONS.find((slot) => toMinutes(slot) >= currentMinutes);
  fields.horaInicial.value = nextSlot || SESSION_SLOT_OPTIONS[0];
}

function normalizeDiagnosis(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

function normalizeLetters(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

function sanitizeCedula(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function showFieldError(fieldName, message) {
  document.querySelector(`#${fieldName}-error`).textContent = message;
}

function clearFieldError(fieldName) {
  document.querySelector(`#${fieldName}-error`).textContent = "";
}

function clearMessages() {
  setFormMessage("Consulta la disponibilidad y luego agenda el plan.", "neutral");
}

function setLookupMessage(message, type) {
  lookupMessage.textContent = message;
  lookupMessage.className = `lookup-message ${type}`;
}

function setFormMessage(message, type) {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
  formMessage.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setSubmitState(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.querySelector(".button-main").textContent = isLoading ? "Agendando..." : "Agendar plan";
  submitButton.querySelector(".button-sub").textContent = isLoading ? "Guardando sesiones del plan" : "Guardar sesiones seleccionadas";
}

function setConsultState(isLoading) {
  consultButton.disabled = isLoading;
  consultButton.querySelector(".button-main").textContent = isLoading ? "Consultando..." : "Consultar";
  consultButton.querySelector(".button-sub").textContent = isLoading ? "Buscando sesiones cercanas" : "Buscar sesiones cercanas";
}

function resetForm() {
  form.reset();
  lastLookupValue = "";
  fields.nombre.value = "";
  resetAvailabilityState();
  clearFieldError("cedula");
  clearFieldError("nombre");
  clearFieldError("diagnostico");
  clearFieldError("numero-sesiones");
  clearFieldError("fecha-inicial");
  clearFieldError("hora-inicial");
  clearFieldError("tipo-terapia");
  clearFieldError("observacion");
  setLookupMessage("Ingresa una cedula para consultar al paciente.", "neutral");
  setDefaultHour();
  if (datePicker) {
    datePicker.clear();
  }
}

function resetAvailabilityState() {
  suggestedSessions = [];
  hasConsultedAvailability = false;
  renderResults([]);
  resultsSummary.textContent = "Sin consulta";
  resultsSummary.className = "badge subtle";
}

function resetPlanFieldsForCedulaChange(currentCedula = "") {
  suggestedSessions = [];
  hasConsultedAvailability = false;
  fields.nombre.value = "";
  fields.diagnostico.value = "";
  fields.numeroSesiones.value = "";
  fields.tipoTerapia.value = "";
  fields.observacion.value = "";
  clearFieldError("nombre");
  clearFieldError("diagnostico");
  clearFieldError("numero-sesiones");
  clearFieldError("fecha-inicial");
  clearFieldError("hora-inicial");
  clearFieldError("tipo-terapia");
  clearFieldError("observacion");
  renderResults([]);
  resultsSummary.textContent = "Sin consulta";
  resultsSummary.className = "badge subtle";
  setDefaultHour();
  if (datePicker) {
    datePicker.clear();
  } else {
    fields.fechaInicial.value = "";
  }
  fields.cedula.value = currentCedula;
}
