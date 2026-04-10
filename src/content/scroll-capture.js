(function scrollCaptureBootstrap() {
  if (window.__screenshipScrollCaptureLoaded) {
    return;
  }
  window.__screenshipScrollCaptureLoaded = true;

  const MESSAGE_TYPE = {
    BG_BEGIN_SCROLL_CAPTURE: "screenship/bg-begin-scroll-capture",
    CONTENT_FULLPAGE_COMPLETE: "screenship/content-fullpage-complete",
    CONTENT_REQUEST_VISIBLE_FRAME: "screenship/content-request-visible-frame"
  };

  const WAIT_BETWEEN_SCROLL_MS = 210;
  const RETRY_DELAY_MS = 120;
  const MAX_FRAME_RETRIES = 2;
  const MAX_CAPTURE_FRAMES = 180;
  let isCapturing = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function waitForPageHeightStability(iterations = 4, intervalMs = 80) {
    let previousHeight = getPageHeight();
    let stableTicks = 0;

    for (let tick = 0; tick < iterations; tick += 1) {
      await sleep(intervalMs);
      await nextAnimationFrame();
      const currentHeight = getPageHeight();
      if (currentHeight === previousHeight) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
      }
      previousHeight = currentHeight;
      if (stableTicks >= 2) {
        break;
      }
    }
  }

  async function settleAfterScroll(y) {
    window.scrollTo(0, y);
    await sleep(WAIT_BETWEEN_SCROLL_MS);
    await nextAnimationFrame();
    await nextAnimationFrame();
    await waitForPageHeightStability();
  }

  function getPageHeight() {
    return Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      document.documentElement.offsetHeight,
      document.body?.offsetHeight ?? 0
    );
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode captured frame."));
      image.src = dataUrl;
    });
  }

  function getStickyOrFixedCandidates() {
    const allElements = document.body ? Array.from(document.body.querySelectorAll("*")) : [];
    const candidates = [];

    for (const element of allElements) {
      const computed = window.getComputedStyle(element);
      if (computed.position !== "fixed" && computed.position !== "sticky") {
        continue;
      }
      if (computed.visibility === "hidden" || computed.display === "none") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 20) {
        continue;
      }
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        continue;
      }

      candidates.push(element);
    }

    return candidates;
  }

  function hideStickyAndFixedElements() {
    const hidden = [];
    const candidates = getStickyOrFixedCandidates();

    for (const element of candidates) {
      hidden.push({
        element,
        visibility: element.style.visibility,
        opacity: element.style.opacity,
        pointerEvents: element.style.pointerEvents
      });

      element.style.setProperty("visibility", "hidden", "important");
      element.style.setProperty("opacity", "0", "important");
      element.style.setProperty("pointer-events", "none", "important");
    }

    return {
      hiddenCount: hidden.length,
      restore: () => {
      for (const item of hidden) {
        if (!item.element.isConnected) {
          continue;
        }

        if (item.visibility) {
          item.element.style.setProperty("visibility", item.visibility);
        } else {
          item.element.style.removeProperty("visibility");
        }

        if (item.opacity) {
          item.element.style.setProperty("opacity", item.opacity);
        } else {
          item.element.style.removeProperty("opacity");
        }

        if (item.pointerEvents) {
          item.element.style.setProperty("pointer-events", item.pointerEvents);
        } else {
          item.element.style.removeProperty("pointer-events");
        }
      }
      }
    };
  }

  function chooseOverlap(viewportHeight, hiddenPinnedCount) {
    const base = Math.round(viewportHeight * 0.14);
    const pinnedBoost = Math.min(72, hiddenPinnedCount * 10);
    return Math.min(240, Math.max(64, base + pinnedBoost));
  }

  async function requestVisibleFrame(scrollY) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_FRAME_RETRIES; attempt += 1) {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.CONTENT_REQUEST_VISIBLE_FRAME,
        scrollY
      });

      if (response?.ok && response.imageDataUrl) {
        return response.imageDataUrl;
      }

      lastError = response?.error ?? "Visible-frame capture failed.";
      if (attempt < MAX_FRAME_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }

    throw new Error(lastError ?? "Visible-frame capture failed.");
  }

  async function stitchFrames(frames, pageHeight) {
    if (!frames.length) {
      throw new Error("No frames captured for stitching.");
    }

    const decodedFrames = [];
    for (const frame of frames) {
      decodedFrames.push({
        scrollY: frame.scrollY,
        image: await dataUrlToImage(frame.imageDataUrl)
      });
    }

    const firstFrame = decodedFrames[0].image;
    const cssToPixelScale = firstFrame.width / Math.max(1, window.innerWidth);

    const canvas = document.createElement("canvas");
    canvas.width = firstFrame.width;
    canvas.height = Math.max(1, Math.round(pageHeight * cssToPixelScale));
    const ctx = canvas.getContext("2d");

    let previousBottom = 0;
    for (const frame of decodedFrames) {
      const drawTop = Math.max(0, Math.round(frame.scrollY * cssToPixelScale));
      const overlap = Math.max(0, previousBottom - drawTop);
      const cropTop = Math.min(frame.image.height - 1, overlap);
      const srcHeight = frame.image.height - cropTop;
      const destY = drawTop + cropTop;
      const clippedHeight = Math.min(srcHeight, canvas.height - destY);

      if (clippedHeight > 0) {
        ctx.drawImage(
          frame.image,
          0,
          cropTop,
          frame.image.width,
          clippedHeight,
          0,
          destY,
          frame.image.width,
          clippedHeight
        );
      }

      previousBottom = Math.max(previousBottom, drawTop + frame.image.height);
    }

    return canvas.toDataURL("image/png");
  }

  async function runCapture() {
    if (isCapturing) {
      throw new Error("A full-page capture is already in progress.");
    }

    isCapturing = true;

    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const pinned = hideStickyAndFixedElements();
    const overlap = chooseOverlap(viewportHeight, pinned.hiddenCount);
    const step = Math.max(64, viewportHeight - overlap);
    const frames = [];
    let pageHeight = getPageHeight();
    const seenPositions = new Set();
    const restorePinnedElements = pinned.restore;

    try {
      await settleAfterScroll(0);

      let targetY = 0;
      while (true) {
        if (frames.length >= MAX_CAPTURE_FRAMES) {
          break;
        }
        const maxScrollY = Math.max(0, pageHeight - viewportHeight);
        const desiredY = Math.min(targetY, maxScrollY);
        await settleAfterScroll(desiredY);

        const actualY = Math.max(0, Math.round(window.scrollY));
        if (seenPositions.has(actualY)) {
          if (actualY >= maxScrollY - 1) {
            break;
          }
          targetY = actualY + step;
          continue;
        }

        seenPositions.add(actualY);
        const imageDataUrl = await requestVisibleFrame(actualY);
        frames.push({ scrollY: actualY, imageDataUrl });

        pageHeight = Math.max(pageHeight, getPageHeight());
        const updatedMax = Math.max(0, pageHeight - viewportHeight);
        if (actualY >= updatedMax - 1) {
          break;
        }

        targetY = actualY + step;
      }

      const stitchedImageDataUrl = await stitchFrames(frames, pageHeight);

      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.CONTENT_FULLPAGE_COMPLETE,
        imageDataUrl: stitchedImageDataUrl,
        sourceUrl: location.href,
        pageTitle: document.title,
        capturedAt: new Date().toISOString(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        scrollPageHeight: pageHeight,
        userAgent: navigator.userAgent,
        captureDiagnostics: {
          frameCount: frames.length,
          overlapCssPx: overlap,
          stepCssPx: step,
          hiddenPinnedCount: pinned.hiddenCount
        }
      });
    } finally {
      restorePinnedElements();
      window.scrollTo(originalX, originalY);
      isCapturing = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE.BG_BEGIN_SCROLL_CAPTURE) {
      return;
    }

    runCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
})();
