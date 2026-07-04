const stepsEl = document.getElementById("steps");
const errorEl = document.getElementById("error");
const errorDetail = document.getElementById("errorDetail");
const retryBtn = document.getElementById("retryBtn");

function stepEl(name) {
  return stepsEl.querySelector(`[data-step="${name}"]`);
}

window.mailhubDesktop.onSplashStep(({ step, status }) => {
  const el = stepEl(step);
  if (!el) return;
  if (status === "active") el.classList.add("active");
  if (status === "done") {
    el.classList.remove("active");
    el.classList.add("done");
  }
});

window.mailhubDesktop.onSplashError(({ step, message }) => {
  const el = stepEl(step);
  if (el) el.classList.remove("active");
  stepsEl.style.opacity = "0.4";
  errorDetail.textContent = message;
  errorEl.style.display = "block";
});

retryBtn.addEventListener("click", () => {
  errorEl.style.display = "none";
  stepsEl.style.opacity = "1";
  stepsEl.querySelectorAll(".step").forEach((el) => el.classList.remove("active", "done"));
  window.mailhubDesktop.retrySplash();
});
