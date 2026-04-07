const AVAILABLE_HOURS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00"
];

const form = document.querySelector("#appointment-form");
const fields = {
  cedula: document.querySelector("#cedula"),
  nombre: document.querySelector("#nombre"),
  apellido: document.querySelector("#apellido"),
  telefono: document.querySelector("#telefono"),
  correo: document.querySelector("#correo"),
  fecha: document.querySelector("#fecha"),
  hora: document.querySelector("#hora"),
  observacion: document.querySelector("#observacion")
};

const lookupMessage = document.querySelector("#lookup-message");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const hourOptions = document.querySelector("#hour-options");
const datePreview = document.querySelector("#date-preview");

let lastLookupValue = "";
let datePicker = null;

initializeDatePicker();
setMinDate();

fields.cedula.addEventListener("input", handleCedulaInput);
fields.cedula.addEventListener("paste", handleCedulaPaste);

fields.telefono.addEventListener("input", () => {
  fields.telefono.value = onlyDigits(fields.telefono.value).slice(0, 10);
});

["nombre", "apellido", "observacion"].forEach((fieldName) => {
  fields[fieldName].addEventListener("input", () => {
    fields[fieldName].value = normalizeLetters(fields[fieldName].value);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const isValid = validateForm();
  if (!isValid) {
    formMessage.textContent = "Corrige los campos marcados para continuar.";
    return;
  }

  const payload = {
    cedula: fields.cedula.value.trim(),
    nombre: fields.nombre.value.trim(),
    apellido: fields.apellido.value.trim(),
    telefono: fields.telefono.value.trim(),
    correo: fields.correo.value.trim().toLowerCase(),
    fecha: fields.fecha.value,
    hora: fields.hora.value,
    observacion: fields.observacion.value.trim()
  };

  try {
    setSubmitState(true);
    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      setFormMessage(result.message || "No se pudo agendar la cita.", "error");
      return;
    }

    setFormMessage(result.message || "Agendado correctamente.", "success");
    setLookupMessage("Paciente guardado correctamente.", "success");
    resetForm();
    await updateAvailableHours();
  } catch (error) {
    setFormMessage("No se pudo conectar con el servidor.", "error");
  } finally {
    setSubmitState(false);
  }
});

async function handleCedulaInput() {
  clearMessages();
  fields.cedula.value = sanitizeCedula(fields.cedula.value);
  clearFieldError("cedula");

  if (fields.cedula.value.length !== 10) {
    lastLookupValue = "";
    clearPatientData();
    setLookupMessage("Ingresa una cedula para buscar al paciente.", "neutral");
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
      fillPatientData(result.patient);
      setLookupMessage("Paciente encontrado. Datos cargados automaticamente.", "success");
    } else {
      clearPatientData();
      setLookupMessage("Paciente no encontrado. Ingresa los datos manualmente.", "warning");
    }
  } catch (error) {
    setLookupMessage("No se pudo consultar la base de datos.", "error");
  }
}

function handleCedulaPaste(event) {
  event.preventDefault();
  const pastedText = event.clipboardData.getData("text");
  fields.cedula.value = sanitizeCedula(pastedText);
  handleCedulaInput();
}

async function updateAvailableHours() {
  const selectedDate = fields.fecha.value;
  clearHourOptions();
  fields.hora.value = "";

  if (!selectedDate) {
    setHourPlaceholder("Selecciona una fecha");
    return;
  }

  setHourPlaceholder("Cargando horas...");
  datePreview.textContent = formatDatePreview(selectedDate);

  try {
    const response = await fetch(`/api/appointments/available-hours?date=${selectedDate}`);
    const result = await response.json();

    clearHourOptions();

    if (!response.ok) {
      if (result.message) {
        showFieldError("fecha", result.message);
      }
      setHourPlaceholder("No hay horas disponibles");
      return;
    }

    clearFieldError("fecha");
    const hours = Array.isArray(result.availableHours) ? result.availableHours : AVAILABLE_HOURS;
    hours.forEach((hour) => appendHourButton(hour));

    if (hours.length === 0) {
      setHourPlaceholder("No hay horas disponibles");
    }
  } catch (error) {
    clearHourOptions();
    showFieldError("fecha", "No se pudo consultar la disponibilidad.");
    setHourPlaceholder("Error al cargar horas");
  }
}

async function handleDateChange() {
  const selectedDate = fields.fecha.value;

  if (!selectedDate) {
    clearFieldError("fecha");
    clearHourOptions();
    setHourPlaceholder("Selecciona una fecha");
    datePreview.textContent = "Selecciona una fecha para ver horarios.";
    return;
  }

  if (isWeekendDate(selectedDate)) {
    fields.fecha.value = "";
    fields.hora.value = "";
    clearHourOptions();
    setHourPlaceholder("Selecciona una fecha");
    datePreview.textContent = "Selecciona una fecha para ver horarios.";
    showFieldError("fecha", "Solo se puede seleccionar de lunes a viernes.");
    setFormMessage("No se permite agendar citas en fin de semana.", "error");
    return;
  }

  clearFieldError("fecha");
  await updateAvailableHours();
}

function validateForm() {
  let isValid = true;
  const data = {
    cedula: fields.cedula.value.trim(),
    nombre: fields.nombre.value.trim(),
    apellido: fields.apellido.value.trim(),
    telefono: fields.telefono.value.trim(),
    correo: fields.correo.value.trim(),
    fecha: fields.fecha.value,
    hora: fields.hora.value,
    observacion: fields.observacion.value.trim()
  };

  if (!/^\d{10}$/.test(data.cedula)) {
    showFieldError("cedula", "La cedula debe tener exactamente 10 digitos.");
    isValid = false;
  } else {
    clearFieldError("cedula");
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.nombre)) {
    showFieldError("nombre", "Ingresa solo letras en nombre.");
    isValid = false;
  } else {
    clearFieldError("nombre");
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.apellido)) {
    showFieldError("apellido", "Ingresa solo letras en apellido.");
    isValid = false;
  } else {
    clearFieldError("apellido");
  }

  if (!/^\d{10}$/.test(data.telefono)) {
    showFieldError("telefono", "El telefono debe tener 10 digitos.");
    isValid = false;
  } else {
    clearFieldError("telefono");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.correo)) {
    showFieldError("correo", "Ingresa un correo valido.");
    isValid = false;
  } else {
    clearFieldError("correo");
  }

  if (!data.fecha) {
    showFieldError("fecha", "La fecha es obligatoria.");
    isValid = false;
  } else {
    if (isWeekendDate(data.fecha)) {
      showFieldError("fecha", "Solo se atiende de lunes a viernes.");
      isValid = false;
    } else {
      clearFieldError("fecha");
    }
  }

  if (!data.hora) {
    showFieldError("hora", "Selecciona una hora disponible.");
    isValid = false;
  } else {
    clearFieldError("hora");
  }

  if (data.observacion && !/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.observacion)) {
    showFieldError("observacion", "La observacion solo permite letras.");
    isValid = false;
  } else {
    clearFieldError("observacion");
  }

  return isValid;
}

function fillPatientData(patient) {
  fields.nombre.value = patient.nombre || "";
  fields.apellido.value = patient.apellido || "";
  fields.telefono.value = patient.telefono || "";
  fields.correo.value = patient.correo || "";
}

function clearPatientData() {
  fields.nombre.value = "";
  fields.apellido.value = "";
  fields.telefono.value = "";
  fields.correo.value = "";
}

function onlyDigits(value) {
  return value.replace(/\D/g, "");
}

function sanitizeCedula(value) {
  return onlyDigits(String(value || "").trim()).slice(0, 10);
}

function normalizeLetters(value) {
  return value
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

function showFieldError(fieldName, message) {
  document.querySelector(`#${fieldName}-error`).textContent = message;
}

function clearFieldError(fieldName) {
  document.querySelector(`#${fieldName}-error`).textContent = "";
}

function clearMessages() {
  setFormMessage("Completa la informacion para registrar la cita.", "neutral");
}

function setLookupMessage(message, type) {
  lookupMessage.textContent = message;
  lookupMessage.className = `lookup-message ${type}`;
}

function setFormMessage(message, type) {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
}

function setSubmitState(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.querySelector(".button-main").textContent = isLoading ? "Agendando..." : "Agendar cita";
  submitButton.querySelector(".button-sub").textContent = isLoading
    ? "Validando y guardando informacion"
    : "Guardar paciente y reserva";
}

function setMinDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const minDate = `${year}-${month}-${day}`;
  fields.fecha.min = minDate;
  if (datePicker) {
    datePicker.set("minDate", minDate);
  }
}

function isWeekendDate(value) {
  const selectedDate = new Date(`${value}T00:00:00`);
  const day = selectedDate.getDay();
  return day === 0 || day === 6;
}

function resetForm() {
  form.reset();
  lastLookupValue = "";
  clearPatientData();
  fields.hora.value = "";
  clearHourOptions();
  setHourPlaceholder("Selecciona una fecha");
  datePreview.textContent = "Selecciona una fecha para ver horarios.";
  clearFieldError("cedula");
  clearFieldError("nombre");
  clearFieldError("apellido");
  clearFieldError("telefono");
  clearFieldError("correo");
  clearFieldError("fecha");
  clearFieldError("hora");
  clearFieldError("observacion");
  setMinDate();
  if (datePicker) {
    datePicker.clear();
  }
}

function clearHourOptions() {
  hourOptions.innerHTML = "";
}

function setHourPlaceholder(message) {
  hourOptions.innerHTML = `<p class="hour-placeholder">${message}</p>`;
}

function appendHourButton(hour) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hour-button";
  button.textContent = hour;
  button.dataset.hour = hour;
  button.addEventListener("click", () => selectHour(hour));
  hourOptions.appendChild(button);
}

function selectHour(hour) {
  fields.hora.value = hour;
  clearFieldError("hora");
  hourOptions.querySelectorAll(".hour-button").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.hour === hour);
  });
}

function formatDatePreview(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("es-EC", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function initializeDatePicker() {
  if (typeof flatpickr === "undefined") {
    fields.fecha.addEventListener("change", handleDateChange);
    return;
  }

  if (flatpickr.l10ns && flatpickr.l10ns.es) {
    flatpickr.localize(flatpickr.l10ns.es);
  }

  datePicker = flatpickr(fields.fecha, {
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    allowInput: false,
    disableMobile: true,
    prevArrow: "<",
    nextArrow: ">",
    disable: [
      (date) => {
        const day = date.getDay();
        return day === 0 || day === 6;
      }
    ],
    onChange: () => {
      handleDateChange();
    }
  });
}
