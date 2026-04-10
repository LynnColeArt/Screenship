(function selectionOverlayBootstrap() {
  if (window.__screenshipSelectionOverlayLoaded) {
    return;
  }
  window.__screenshipSelectionOverlayLoaded = true;

  const MESSAGE_TYPE = {
    BG_BEGIN_SELECTION: "screenship/bg-begin-selection",
    CONTENT_SELECTION_COMPLETE: "screenship/content-selection-complete"
  };

  const MIN_SELECTION_SIZE = 4;

  let overlay = null;
  let selectionBox = null;
  let isDragging = false;
  let start = { x: 0, y: 0 };
  let end = { x: 0, y: 0 };

  function normalizeRect(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(a.x - b.x);
    const height = Math.abs(a.y - b.y);
    return { x, y, width, height };
  }

  function removeOverlay() {
    if (overlay) {
      overlay.style.pointerEvents = "none";
      overlay.style.opacity = "0";
      overlay.remove();
      overlay = null;
      selectionBox = null;
    }
    window.removeEventListener("keydown", onKeyDown, true);
  }

  function waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  function renderSelectionRect() {
    if (!selectionBox) {
      return;
    }
    const rect = normalizeRect(start, end);
    selectionBox.style.left = `${rect.x}px`;
    selectionBox.style.top = `${rect.y}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
  }

  function onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    isDragging = true;
    start = { x: event.clientX, y: event.clientY };
    end = { x: event.clientX, y: event.clientY };
    renderSelectionRect();
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!isDragging) {
      return;
    }
    end = { x: event.clientX, y: event.clientY };
    renderSelectionRect();
    event.preventDefault();
  }

  async function finishSelection() {
    const rect = normalizeRect(start, end);
    removeOverlay();

    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      return;
    }

    // Let the page repaint after removing overlay UI before capture starts.
    await waitForNextPaint();

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.CONTENT_SELECTION_COMPLETE,
      rect,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      sourceUrl: location.href,
      pageTitle: document.title,
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      scrollPageHeight: document.documentElement.scrollHeight
    });
  }

  function onPointerUp(event) {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    end = { x: event.clientX, y: event.clientY };
    void finishSelection();
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      removeOverlay();
      event.preventDefault();
    }
  }

  function injectOverlay() {
    if (overlay) {
      return;
    }

    overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.cursor = "crosshair";
    overlay.style.background = "rgba(0, 0, 0, 0.18)";
    overlay.style.zIndex = "2147483647";
    overlay.style.backdropFilter = "grayscale(15%)";

    selectionBox = document.createElement("div");
    selectionBox.style.position = "absolute";
    selectionBox.style.border = "2px solid #00b7ff";
    selectionBox.style.background = "rgba(0, 183, 255, 0.14)";
    selectionBox.style.boxShadow = "0 0 0 999999px rgba(0, 0, 0, 0.25)";
    selectionBox.style.pointerEvents = "none";

    overlay.appendChild(selectionBox);
    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerUp);

    document.documentElement.appendChild(overlay);
    window.addEventListener("keydown", onKeyDown, true);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE.BG_BEGIN_SELECTION) {
      return;
    }
    injectOverlay();
    sendResponse({ ok: true });
  });
})();
