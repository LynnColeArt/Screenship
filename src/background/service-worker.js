import { CAPTURE_MODE, MESSAGE_TYPE } from "../shared/messages.js";
import { captureVisibleTab, cropCapturedImage } from "./capture.js";
import { clearSession, createSession, readSession } from "./state.js";

function isMissingReceiverError(error) {
  const message = String(error?.message ?? error ?? "");
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

async function ensureCaptureScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/selection-overlay.js", "src/content/scroll-capture.js"]
  });
}

async function sendMessageWithInjection(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await ensureCaptureScripts(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    throw new Error("No active tab available.");
  }
  return tabs[0];
}

async function openEditorSession(payload) {
  const sessionId = await createSession(payload);
  const editorUrl = chrome.runtime.getURL(`src/editor/editor.html?sessionId=${sessionId}`);
  await chrome.tabs.create({ url: editorUrl });
  return sessionId;
}

async function beginCapture(mode) {
  const tab = await getActiveTab();

  if (!tab.id || !tab.windowId) {
    throw new Error("Active tab is not capturable.");
  }

  if (mode === CAPTURE_MODE.SELECTION) {
    await sendMessageWithInjection(tab.id, { type: MESSAGE_TYPE.BG_BEGIN_SELECTION });
    return { started: true, mode };
  }

  if (mode === CAPTURE_MODE.SCROLLING_FULL_PAGE) {
    await sendMessageWithInjection(tab.id, { type: MESSAGE_TYPE.BG_BEGIN_SCROLL_CAPTURE });
    return { started: true, mode };
  }

  if (mode === CAPTURE_MODE.VIEWPORT) {
    const imageDataUrl = await captureVisibleTab(tab.windowId);
    const metadata = {
      sourceUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      capturedAt: new Date().toISOString(),
      captureMode: CAPTURE_MODE.VIEWPORT,
      viewportWidth: 0,
      viewportHeight: 0,
      scrollPageHeight: 0,
      userAgent: "unknown",
      extensionVersion: chrome.runtime.getManifest().version
    };
    await openEditorSession({ imageDataUrl, metadata });
    return { started: true, mode };
  }

  throw new Error(`Unsupported capture mode: ${mode}`);
}

async function handleSelectionComplete(message, sender) {
  const tab = sender.tab;
  if (!tab?.windowId) {
    throw new Error("No tab context available for selection capture.");
  }

  const fullFrameDataUrl = await captureVisibleTab(tab.windowId);
  const imageDataUrl = await cropCapturedImage(fullFrameDataUrl, message.rect, message.viewport);

  const metadata = {
    sourceUrl: message.sourceUrl ?? tab.url ?? "",
    pageTitle: message.pageTitle ?? tab.title ?? "",
    capturedAt: message.capturedAt ?? new Date().toISOString(),
    captureMode: CAPTURE_MODE.SELECTION,
    viewportWidth: message.viewport?.width ?? 0,
    viewportHeight: message.viewport?.height ?? 0,
    scrollPageHeight: message.scrollPageHeight ?? 0,
    userAgent: message.userAgent ?? "unknown",
    extensionVersion: chrome.runtime.getManifest().version
  };

  await openEditorSession({ imageDataUrl, metadata });
  return { captured: true };
}

async function handleFullPageComplete(message) {
  const metadata = {
    sourceUrl: message.sourceUrl ?? "",
    pageTitle: message.pageTitle ?? "",
    capturedAt: message.capturedAt ?? new Date().toISOString(),
    captureMode: CAPTURE_MODE.SCROLLING_FULL_PAGE,
    viewportWidth: message.viewport?.width ?? 0,
    viewportHeight: message.viewport?.height ?? 0,
    scrollPageHeight: message.scrollPageHeight ?? 0,
    userAgent: message.userAgent ?? "unknown",
    extensionVersion: chrome.runtime.getManifest().version,
    captureDiagnostics: message.captureDiagnostics ?? null
  };

  await openEditorSession({
    imageDataUrl: message.imageDataUrl,
    metadata
  });
  return { captured: true };
}

async function handleVisibleFrameRequest(sender) {
  if (!sender.tab?.windowId) {
    throw new Error("No tab context available for frame capture.");
  }
  const imageDataUrl = await captureVisibleTab(sender.tab.windowId);
  return { imageDataUrl };
}

async function handleEditorLoadSession(sessionId) {
  if (!sessionId) {
    throw new Error("Missing session id.");
  }
  const session = await readSession(sessionId);
  if (!session) {
    throw new Error("Capture session not found.");
  }
  return { session };
}

async function handleEditorClearSession(sessionId) {
  if (!sessionId) {
    return { cleared: false };
  }
  await clearSession(sessionId);
  return { cleared: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MESSAGE_TYPE.POPUP_START_CAPTURE:
        return beginCapture(message.mode);
      case MESSAGE_TYPE.CONTENT_SELECTION_COMPLETE:
        return handleSelectionComplete(message, sender);
      case MESSAGE_TYPE.CONTENT_FULLPAGE_COMPLETE:
        return handleFullPageComplete(message);
      case MESSAGE_TYPE.CONTENT_REQUEST_VISIBLE_FRAME:
        return handleVisibleFrameRequest(sender);
      case MESSAGE_TYPE.EDITOR_LOAD_SESSION:
        return handleEditorLoadSession(message.sessionId);
      case MESSAGE_TYPE.EDITOR_CLEAR_SESSION:
        return handleEditorClearSession(message.sessionId);
      default:
        throw new Error(`Unhandled message type: ${message?.type ?? "unknown"}`);
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
