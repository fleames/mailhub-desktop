const dropzone = document.getElementById("dropzone");
const status = document.getElementById("status");
const card = document.getElementById("card");
const pasteToggle = document.getElementById("pasteToggle");
const pasteArea = document.getElementById("pasteArea");
const pasteInput = document.getElementById("pasteInput");
const pasteSubmit = document.getElementById("pasteSubmit");
const purchaseLink = document.getElementById("purchaseLink");
const versionEl = document.getElementById("version");

const ICON_SPINNER = `<span class="spinner"></span>`;
const ICON_CHECK = `
  <svg class="check" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke-width="1.6"/>
    <path d="M8 12.5l2.5 2.5L16 9.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

function setStatus(kind, message) {
  status.className = `status ${kind}`;
  if (kind === "validating") status.innerHTML = `${ICON_SPINNER}<span>${message}</span>`;
  else if (kind === "success") status.innerHTML = `${ICON_CHECK}<span>${message}</span>`;
  else status.innerHTML = `<span>${message}</span>`;
}

function clearStatus() {
  status.className = "status";
  status.innerHTML = "";
}

async function handleResult(result) {
  if (result.valid) {
    setStatus("success", "Activated! Opening MailHub…");
    dropzone.classList.remove("busy");
    setTimeout(() => {
      card.classList.add("leaving");
      setTimeout(() => window.mailhubDesktop.proceedToApp(), 380);
    }, 900);
  } else {
    dropzone.classList.remove("busy");
    setStatus("error", result.reason || "That license file isn't valid.");
  }
}

async function activateFromPath(filePath) {
  if (!filePath) return;
  dropzone.classList.add("busy");
  setStatus("validating", "Checking your license…");
  const result = await window.mailhubDesktop.activateLicenseFile(filePath);
  await handleResult(result);
}

// --- Drag and drop ---
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) activateFromPath(file.path);
});

// --- Click to browse ---
dropzone.addEventListener("click", async () => {
  const filePath = await window.mailhubDesktop.browseForLicenseFile();
  if (filePath) activateFromPath(filePath);
});
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    dropzone.click();
  }
});

// --- Paste license text instead ---
pasteToggle.addEventListener("click", () => {
  const opening = !pasteArea.classList.contains("open");
  pasteArea.classList.toggle("open");
  pasteToggle.textContent = opening ? "Hide paste box" : "Paste license text instead";
  if (opening) pasteInput.focus();
});

pasteSubmit.addEventListener("click", async () => {
  const text = pasteInput.value.trim();
  if (!text) return;
  pasteSubmit.disabled = true;
  clearStatus();
  setStatus("validating", "Checking your license…");
  const result = await window.mailhubDesktop.activateLicenseText(text);
  pasteSubmit.disabled = false;
  await handleResult(result);
});

// --- Footer ---
purchaseLink.addEventListener("click", () => window.mailhubDesktop.openPurchaseLink());

window.mailhubDesktop.getVersion().then((v) => {
  versionEl.textContent = `v${v}`;
});
