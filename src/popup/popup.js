import { CAPTURE_MODE, MESSAGE_TYPE } from "../shared/messages.js";

const statusEl = document.querySelector("#status");
const buttons = Array.from(document.querySelectorAll(".action-button"));

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setBusy(button) {
  for (const item of buttons) {
    item.disabled = true;
    item.classList.toggle("is-busy", item === button);
  }
}

function clearBusy() {
  for (const item of buttons) {
    item.disabled = false;
    item.classList.remove("is-busy");
  }
}

async function startCapture(mode) {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.POPUP_START_CAPTURE,
    mode
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Capture failed to start.");
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    const mode = button.dataset.mode;
    if (!mode || !Object.values(CAPTURE_MODE).includes(mode)) {
      setStatus("Unsupported mode.", true);
      return;
    }

    setBusy(button);
    setStatus("Starting capture...");

    try {
      await startCapture(mode);
      setStatus("Capture started.");
      setTimeout(() => window.close(), 250);
    } catch (error) {
      setStatus(error.message, true);
      clearBusy();
    }
  });
}

