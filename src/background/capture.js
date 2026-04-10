function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return `data:${blob.type};base64,${base64}`;
}

export async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

export async function cropCapturedImage(dataUrl, rect, viewport) {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(blob);

  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;

  const sx = clamp(Math.round(rect.x * scaleX), 0, bitmap.width);
  const sy = clamp(Math.round(rect.y * scaleY), 0, bitmap.height);
  const sw = clamp(Math.round(rect.width * scaleX), 1, bitmap.width - sx);
  const sh = clamp(Math.round(rect.height * scaleY), 1, bitmap.height - sy);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }
  return blobToDataUrl(croppedBlob);
}

