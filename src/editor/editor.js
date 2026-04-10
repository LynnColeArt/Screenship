import { MESSAGE_TYPE } from "../shared/messages.js";
import { buildExportMetadata, embedMetadata } from "../shared/metadata.js";
import {
  cloneLayers,
  createBlurLayer,
  createShapeLayer,
  createStrokeLayer,
  createTextLayer
} from "./layer-model.js";

const TOOL_HOTKEYS = new Map([
  ["v", "move"],
  ["c", "crop"],
  ["p", "pen"],
  ["h", "highlight"],
  ["b", "blur"],
  ["t", "text"]
]);
const THEME_STORAGE_KEY = "screenship:editor-theme";
const TEXT_HANDLE_SIZE = 10;
const DEFAULT_STROKE_COLOR = "#ff0000";
const DEFAULT_HIGHLIGHT_COLOR = "#fff200";
const DEFAULT_HIGHLIGHT_WIDTH = 16;
const DEFAULT_HIGHLIGHT_OPACITY = 0.42;
const BLEND_MODE_TO_COMPOSITE = Object.freeze({
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-burn": "color-burn",
  "color-dodge": "color-dodge",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion"
});

const dom = {
  canvas: document.querySelector("#editor-canvas"),
  canvasWrapper: document.querySelector("#canvas-wrapper"),
  emptyState: document.querySelector("#empty-state"),
  status: document.querySelector("#editor-status"),
  inlineTextEditor: document.querySelector("#inline-text-editor"),
  themeToggle: document.querySelector("#theme-toggle"),
  toolButtons: Array.from(document.querySelectorAll(".tool-button")),
  layersList: document.querySelector("#layers-list"),
  metadataList: document.querySelector("#metadata-list"),
  propertiesSection: document.querySelector("#properties-section"),
  blendMode: document.querySelector("#blend-mode"),
  strokeColor: document.querySelector("#stroke-color"),
  fillColor: document.querySelector("#fill-color"),
  strokeWidth: document.querySelector("#stroke-width"),
  opacity: document.querySelector("#opacity"),
  fontSize: document.querySelector("#font-size"),
  blurStrength: document.querySelector("#blur-strength"),
  fontFamily: document.querySelector("#font-family"),
  textContent: document.querySelector("#text-content"),
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  editTextButton: document.querySelector("#edit-text-button"),
  exportFormat: document.querySelector("#export-format"),
  exportQuality: document.querySelector("#export-quality"),
  exportButton: document.querySelector("#export-button"),
  copyButton: document.querySelector("#copy-button"),
  inspectorHint: document.querySelector("#inspector-hint"),
  inspectorFields: Array.from(document.querySelectorAll(".inspector-field"))
};

const state = {
  sessionId: null,
  metadata: null,
  baseImageDataUrl: null,
  baseImage: null,
  layers: [],
  tool: "move",
  selectedLayerId: null,
  pointerOrigin: null,
  draft: null,
  draggingLayerId: null,
  dropLayerId: null,
  dropBefore: true,
  movingLayerId: null,
  movingSnapshot: null,
  movingDidTranslate: false,
  resizingLayer: null,
  resizingSnapshot: null,
  resizingDidChange: false,
  inlineEditingLayerId: null,
  history: [],
  future: [],
  theme: "dark",
  style: {
    strokeColor: DEFAULT_STROKE_COLOR,
    fillColor: "#fff2a8",
    lineWidth: 4,
    opacity: 1,
    blendMode: "normal",
    fontSize: 18,
    blurStrength: 10,
    fontFamily: '"Avenir Next", sans-serif',
    textContent: "Note"
  }
};

const ctx = dom.canvas.getContext("2d");

function setStatus(text, isError = false) {
  dom.status.textContent = text;
  dom.status.style.color = isError ? "#a2281a" : "";
}

function getPreferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  return "dark";
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  if (dom.themeToggle) {
    dom.themeToggle.textContent = state.theme === "dark" ? "☀️ Day" : "🌙 Night";
    dom.themeToggle.title = state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Ignore storage failures.
  }
}

function setTool(tool) {
  if (isInlineEditing()) {
    closeInlineTextEditor({ commit: true });
  }
  state.tool = tool;
  for (const button of dom.toolButtons) {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  }
  dom.canvas.style.cursor = tool === "move" ? "move" : "crosshair";
  updateInspectorFieldVisibility();
}

function isInlineEditing() {
  return Boolean(state.inlineEditingLayerId);
}

function getCanvasBoundsInWrapper() {
  return {
    x: dom.canvas.offsetLeft,
    y: dom.canvas.offsetTop
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSelectedLayer() {
  if (!state.selectedLayerId) {
    return null;
  }
  return state.layers.find((layer) => layer.id === state.selectedLayerId) ?? null;
}

function normalizeBlendMode(blendMode) {
  if (typeof blendMode === "string" && BLEND_MODE_TO_COMPOSITE[blendMode]) {
    return blendMode;
  }
  return "normal";
}

function getLayerBlendMode(layer) {
  if (!layer) {
    return "normal";
  }
  if (typeof layer.blendMode === "string" && BLEND_MODE_TO_COMPOSITE[layer.blendMode]) {
    return layer.blendMode;
  }
  if (layer.kind === "highlight") {
    return "multiply";
  }
  return "normal";
}

function getInlineEditorColors(layer) {
  const textColor = layer.color ?? state.style.strokeColor ?? "#10151d";
  if (layer.sticky) {
    return {
      color: textColor,
      background: layer.background || state.style.fillColor || "#fff2a8",
      textShadow: "none"
    };
  }

  return {
    color: textColor,
    background: "transparent",
    textShadow: "0 0 2px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255, 255, 255, 0.4)"
  };
}

function applyInlineEditorVisuals(layer) {
  const colors = getInlineEditorColors(layer);
  dom.inlineTextEditor.style.fontFamily = layer.fontFamily ?? state.style.fontFamily;
  dom.inlineTextEditor.style.fontSize = `${layer.fontSize ?? state.style.fontSize}px`;
  dom.inlineTextEditor.style.color = colors.color;
  dom.inlineTextEditor.style.background = colors.background;
  dom.inlineTextEditor.style.textShadow = colors.textShadow;
}

function describeInspectorKind(kind) {
  if (kind === "shape") {
    return "shape";
  }
  if (kind === "stroke") {
    return "pen stroke";
  }
  if (kind === "highlight") {
    return "highlight";
  }
  if (kind === "blur") {
    return "blur";
  }
  if (kind === "text") {
    return "text";
  }
  return "layer";
}

function updateInspectorFieldVisibility() {
  const selected = getSelectedLayer();
  if (dom.propertiesSection) {
    dom.propertiesSection.classList.toggle("is-hidden", !selected);
  }

  if (!selected) {
    return;
  }
  const activeKind = selected.kind;

  for (const field of dom.inspectorFields) {
    const tokens = String(field.dataset.inspector || "")
      .split(/\s+/)
      .filter(Boolean);
    const show = tokens.includes("all") || (activeKind ? tokens.includes(activeKind) : false);
    field.classList.toggle("is-hidden", !show);
  }

  if (!dom.inspectorHint) {
    return;
  }

  if (selected) {
    const label = selected.kind === "text" && selected.sticky ? "sticky note" : describeInspectorKind(selected.kind);
    dom.inspectorHint.textContent = `Editing ${label} layer properties.`;
  }
}

function syncInspectorFromSelection() {
  const selected = getSelectedLayer();
  dom.editTextButton.disabled = !(selected && selected.kind === "text");
  if (!selected) {
    dom.blendMode.value = normalizeBlendMode(state.style.blendMode);
    updateInspectorFieldVisibility();
    return;
  }

  dom.blendMode.value = getLayerBlendMode(selected);

  if (selected.kind === "shape") {
    dom.strokeColor.value = selected.stroke ?? state.style.strokeColor;
    if (selected.fill) {
      dom.fillColor.value = selected.fill;
    }
    dom.strokeWidth.value = String(selected.strokeWidth ?? state.style.lineWidth);
    dom.opacity.value = String(selected.opacity ?? state.style.opacity);
  } else if (selected.kind === "stroke" || selected.kind === "highlight") {
    dom.strokeColor.value = selected.color ?? state.style.strokeColor;
    dom.strokeWidth.value = String(selected.width ?? state.style.lineWidth);
    dom.opacity.value = String(selected.opacity ?? state.style.opacity);
  } else if (selected.kind === "blur") {
    dom.blurStrength.value = String(selected.strength ?? state.style.blurStrength);
    dom.opacity.value = String(selected.opacity ?? state.style.opacity);
  } else if (selected.kind === "text") {
    dom.strokeColor.value = selected.color ?? state.style.strokeColor;
    if (selected.background) {
      dom.fillColor.value = selected.background;
    }
    dom.opacity.value = String(selected.opacity ?? state.style.opacity);
    dom.fontSize.value = String(selected.fontSize ?? state.style.fontSize);
    dom.fontFamily.value = selected.fontFamily ?? state.style.fontFamily;
    dom.textContent.value = selected.text ?? state.style.textContent;
  }

  state.style.strokeColor = dom.strokeColor.value;
  state.style.fillColor = dom.fillColor.value;
  state.style.lineWidth = Number(dom.strokeWidth.value);
  state.style.opacity = Number(dom.opacity.value);
  state.style.blendMode = normalizeBlendMode(dom.blendMode.value);
  state.style.fontSize = Number(dom.fontSize.value);
  state.style.blurStrength = Number(dom.blurStrength.value);
  state.style.fontFamily = dom.fontFamily.value;
  state.style.textContent = dom.textContent.value;
  updateInspectorFieldVisibility();
}

function applyStyleToSelectedLayer() {
  const selected = getSelectedLayer();
  if (!selected) {
    updateInspectorFieldVisibility();
    return;
  }

  selected.blendMode = normalizeBlendMode(state.style.blendMode);

  if (selected.kind === "shape") {
    selected.stroke = state.style.strokeColor;
    selected.strokeWidth = state.style.lineWidth;
    selected.opacity = state.style.opacity;
    if (selected.shape !== "line" && selected.shape !== "arrow") {
      selected.fill = state.style.fillColor;
    }
  } else if (selected.kind === "stroke" || selected.kind === "highlight") {
    selected.color = state.style.strokeColor;
    selected.width = state.style.lineWidth;
    selected.opacity = selected.kind === "highlight" ? Math.min(state.style.opacity, 0.75) : state.style.opacity;
  } else if (selected.kind === "blur") {
    selected.opacity = state.style.opacity;
    selected.strength = state.style.blurStrength;
  } else if (selected.kind === "text") {
    selected.color = state.style.strokeColor;
    selected.background = state.style.fillColor;
    selected.opacity = state.style.opacity;
    selected.fontSize = state.style.fontSize;
    selected.fontFamily = state.style.fontFamily;
    selected.text = state.style.textContent;
  }

  if (selected.kind === "text" && isInlineEditing() && state.inlineEditingLayerId === selected.id) {
    applyInlineEditorVisuals(selected);
  }
  updateInspectorFieldVisibility();
}

function closeInlineTextEditor({ commit }) {
  if (!isInlineEditing()) {
    return;
  }

  const layerId = state.inlineEditingLayerId;
  const layer = state.layers.find((item) => item.id === layerId && item.kind === "text");
  let changed = false;
  if (commit && layer) {
    const nextText = dom.inlineTextEditor.value.trim();
    if (nextText && nextText !== layer.text) {
      pushHistory();
      layer.text = nextText;
      state.style.textContent = nextText;
      dom.textContent.value = nextText;
      changed = true;
    }
  }

  state.inlineEditingLayerId = null;
  dom.inlineTextEditor.classList.add("is-hidden");
  if (changed) {
    setStatus("Text updated.");
  }
  render();
}

function cancelActiveToolAction() {
  if (isInlineEditing()) {
    closeInlineTextEditor({ commit: false });
    setStatus("Edit canceled.");
    return true;
  }

  if (state.draft) {
    state.draft = null;
    state.pointerOrigin = null;
    render();
    setStatus("Tool action canceled.");
    return true;
  }

  if (state.movingLayerId) {
    const canceledLayerId = state.movingLayerId;
    if (state.movingSnapshot) {
      state.baseImageDataUrl = state.movingSnapshot.baseImageDataUrl;
      state.layers = cloneLayers(state.movingSnapshot.layers);
    }
    state.selectedLayerId = canceledLayerId;
    state.movingLayerId = null;
    state.movingSnapshot = null;
    state.movingDidTranslate = false;
    state.pointerOrigin = null;
    syncInspectorFromSelection();
    render();
    setStatus("Move canceled.");
    return true;
  }

  if (state.resizingLayer) {
    const resizingLayerId = state.resizingLayer.layerId;
    if (state.resizingSnapshot) {
      state.baseImageDataUrl = state.resizingSnapshot.baseImageDataUrl;
      state.layers = cloneLayers(state.resizingSnapshot.layers);
    }
    state.selectedLayerId = resizingLayerId;
    state.resizingLayer = null;
    state.resizingSnapshot = null;
    state.resizingDidChange = false;
    state.pointerOrigin = null;
    syncInspectorFromSelection();
    render();
    setStatus("Resize canceled.");
    return true;
  }

  if (state.tool !== "move") {
    setTool("move");
    setStatus("Tool canceled.");
    return true;
  }

  return false;
}

function openInlineTextEditor(layerId) {
  const layer = state.layers.find((item) => item.id === layerId && item.kind === "text");
  if (!layer) {
    return;
  }

  const bounds = getLayerBounds(layer);
  if (!bounds) {
    return;
  }

  const canvasBounds = getCanvasBoundsInWrapper();
  const left = Math.max(4, Math.round(canvasBounds.x + bounds.x));
  const top = Math.max(4, Math.round(canvasBounds.y + bounds.y));
  const width = Math.max(120, Math.round(bounds.width + 24));
  const height = Math.max(44, Math.round(bounds.height + 16));

  state.selectedLayerId = layerId;
  state.inlineEditingLayerId = layerId;
  syncInspectorFromSelection();

  dom.inlineTextEditor.value = layer.text;
  dom.inlineTextEditor.style.left = `${left}px`;
  dom.inlineTextEditor.style.top = `${top}px`;
  dom.inlineTextEditor.style.width = `${width}px`;
  dom.inlineTextEditor.style.height = `${height}px`;
  applyInlineEditorVisuals(layer);
  dom.inlineTextEditor.classList.remove("is-hidden");
  dom.inlineTextEditor.focus();
  dom.inlineTextEditor.select();
  setStatus("Editing text. Press Ctrl/Cmd+Enter to apply, Esc to cancel.");
  render();
}

function getCanvasPoint(event) {
  const rect = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x, y, width, height };
}

function snapshot() {
  return {
    baseImageDataUrl: state.baseImageDataUrl,
    layers: cloneLayers(state.layers)
  };
}

function pushHistorySnapshot(nextSnapshot) {
  state.history.push(nextSnapshot);
  if (state.history.length > 100) {
    state.history.shift();
  }
  state.future = [];
}

function pushHistory() {
  pushHistorySnapshot(snapshot());
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = dataUrl;
  });
}

async function applySnapshot(nextSnapshot) {
  closeInlineTextEditor({ commit: false });
  state.baseImageDataUrl = nextSnapshot.baseImageDataUrl;
  state.layers = cloneLayers(nextSnapshot.layers);
  state.selectedLayerId = null;
  state.baseImage = await loadImage(state.baseImageDataUrl);
  resizeCanvasToBase();
  syncInspectorFromSelection();
  render();
}

async function undo() {
  closeInlineTextEditor({ commit: true });
  if (!state.history.length) {
    return;
  }
  state.future.push(snapshot());
  const previous = state.history.pop();
  await applySnapshot(previous);
}

async function redo() {
  closeInlineTextEditor({ commit: true });
  if (!state.future.length) {
    return;
  }
  state.history.push(snapshot());
  const next = state.future.pop();
  await applySnapshot(next);
}

function resizeCanvasToBase() {
  if (!state.baseImage) {
    return;
  }
  dom.canvas.width = state.baseImage.width;
  dom.canvas.height = state.baseImage.height;
}

function drawArrow(ctx2d, x1, y1, x2, y2, strokeWidth, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLength = Math.max(16, strokeWidth * 4.5);
  const headWidth = Math.max(14, strokeWidth * 3.5);
  const shaftEndX = x2 - Math.cos(angle) * (headLength * 0.72);
  const shaftEndY = y2 - Math.sin(angle) * (headLength * 0.72);

  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = strokeWidth;
  ctx2d.lineCap = "round";
  ctx2d.lineJoin = "round";
  ctx2d.beginPath();
  ctx2d.moveTo(x1, y1);
  ctx2d.lineTo(shaftEndX, shaftEndY);
  ctx2d.stroke();

  const leftX = x2 - Math.cos(angle) * headLength + Math.cos(angle + Math.PI / 2) * (headWidth / 2);
  const leftY = y2 - Math.sin(angle) * headLength + Math.sin(angle + Math.PI / 2) * (headWidth / 2);
  const rightX = x2 - Math.cos(angle) * headLength + Math.cos(angle - Math.PI / 2) * (headWidth / 2);
  const rightY = y2 - Math.sin(angle) * headLength + Math.sin(angle - Math.PI / 2) * (headWidth / 2);

  ctx2d.fillStyle = color;
  ctx2d.beginPath();
  ctx2d.moveTo(x2, y2);
  ctx2d.lineTo(leftX, leftY);
  ctx2d.lineTo(rightX, rightY);
  ctx2d.closePath();
  ctx2d.fill();
}

function getTextMetrics(layer, ctx2d, overrides = {}) {
  const fontSize = overrides.fontSize ?? layer.fontSize ?? state.style.fontSize;
  const fontFamily = overrides.fontFamily ?? layer.fontFamily ?? state.style.fontFamily;
  const lines = String(layer.text ?? "").split(/\r?\n/);
  const safeLines = lines.length ? lines : [" "];
  const lineHeight = fontSize * 1.3;

  ctx2d.save();
  ctx2d.font = `600 ${fontSize}px ${fontFamily}`;
  let width = 0;
  for (const line of safeLines) {
    width = Math.max(width, ctx2d.measureText(line || " ").width);
  }
  ctx2d.restore();

  return {
    lines: safeLines,
    width,
    lineHeight,
    height: Math.max(lineHeight, safeLines.length * lineHeight)
  };
}

function getTextBounds(layer, ctx2d, overrides = {}) {
  const metrics = getTextMetrics(layer, ctx2d, overrides);
  const padX = layer.sticky ? 10 : 4;
  const padY = layer.sticky ? 8 : 4;
  return {
    x: layer.x - padX,
    y: layer.y - metrics.lineHeight - padY,
    width: metrics.width + padX * 2,
    height: metrics.height + padY * 2,
    padX,
    padY,
    lineHeight: metrics.lineHeight,
    metrics
  };
}

function drawPixelatedBlur(ctx2d, x, y, width, height, strength) {
  const regionW = Math.max(1, Math.round(width));
  const regionH = Math.max(1, Math.round(height));
  if (regionW < 2 || regionH < 2) {
    return;
  }

  const pixelSize = Math.max(4, Math.round(strength));
  const sampleW = Math.max(1, Math.floor(regionW / pixelSize));
  const sampleH = Math.max(1, Math.floor(regionH / pixelSize));

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = regionW;
  sourceCanvas.height = regionH;
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(ctx2d.canvas, x, y, regionW, regionH, 0, 0, regionW, regionH);

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sampleCtx = sampleCanvas.getContext("2d");
  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.drawImage(sourceCanvas, 0, 0, sampleW, sampleH);

  ctx2d.save();
  ctx2d.imageSmoothingEnabled = false;
  ctx2d.drawImage(sampleCanvas, 0, 0, sampleW, sampleH, x, y, regionW, regionH);
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.restore();
}

function drawLayer(ctx2d, layer, options = {}) {
  ctx2d.save();
  ctx2d.globalAlpha = layer.opacity ?? 1;
  ctx2d.globalCompositeOperation = BLEND_MODE_TO_COMPOSITE[getLayerBlendMode(layer)] ?? "source-over";

  if (layer.kind === "stroke" || layer.kind === "highlight") {
    if (layer.points.length < 2) {
      ctx2d.restore();
      return;
    }
    ctx2d.strokeStyle = layer.color;
    ctx2d.lineWidth = layer.width;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";
    ctx2d.beginPath();
    ctx2d.moveTo(layer.points[0].x, layer.points[0].y);
    for (let i = 1; i < layer.points.length; i += 1) {
      const point = layer.points[i];
      ctx2d.lineTo(point.x, point.y);
    }
    ctx2d.stroke();
    ctx2d.restore();
    return;
  }

  if (layer.kind === "shape") {
    const { x, y, width, height } = normalizeRect(layer.x1, layer.y1, layer.x2, layer.y2);
    ctx2d.strokeStyle = layer.stroke;
    ctx2d.fillStyle = layer.fill || "transparent";
    ctx2d.lineWidth = layer.strokeWidth;

    if (layer.shape === "rect") {
      if (layer.fill) {
        ctx2d.fillRect(x, y, width, height);
      }
      ctx2d.strokeRect(x, y, width, height);
    } else if (layer.shape === "ellipse") {
      ctx2d.beginPath();
      ctx2d.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      if (layer.fill) {
        ctx2d.fill();
      }
      ctx2d.stroke();
    } else if (layer.shape === "line") {
      ctx2d.beginPath();
      ctx2d.moveTo(layer.x1, layer.y1);
      ctx2d.lineTo(layer.x2, layer.y2);
      ctx2d.stroke();
    } else if (layer.shape === "arrow") {
      drawArrow(ctx2d, layer.x1, layer.y1, layer.x2, layer.y2, layer.strokeWidth, layer.stroke);
    }
    ctx2d.restore();
    return;
  }

  if (layer.kind === "text") {
    const fontSize = layer.fontSize ?? state.style.fontSize;
    const fontFamily = layer.fontFamily ?? state.style.fontFamily;
    const bounds = getTextBounds(layer, ctx2d);
    const textWidth = bounds.metrics.width;
    const textHeight = bounds.metrics.height;
    const textTop = bounds.y + bounds.padY;
    const padX = layer.sticky ? 10 : 2;
    const padY = layer.sticky ? 8 : 2;

    ctx2d.font = `600 ${fontSize}px ${fontFamily}`;

    if (layer.sticky) {
      ctx2d.fillStyle = layer.background || "#fff2a8";
      ctx2d.fillRect(layer.x - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2);
      ctx2d.strokeStyle = "rgba(0,0,0,0.2)";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(layer.x - padX, textTop - padY, textWidth + padX * 2, textHeight + padY * 2);
    }

    ctx2d.fillStyle = layer.color;
    for (let index = 0; index < bounds.metrics.lines.length; index += 1) {
      const baselineY = layer.y + index * bounds.metrics.lineHeight;
      ctx2d.fillText(bounds.metrics.lines[index], layer.x, baselineY);
    }
    ctx2d.restore();
    return;
  }

  if (layer.kind === "blur") {
    const { x, y, width, height } = normalizeRect(layer.x1, layer.y1, layer.x2, layer.y2);
    drawPixelatedBlur(ctx2d, x, y, width, height, layer.strength ?? state.style.blurStrength);
    ctx2d.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx2d.fillRect(x, y, width, height);
    if (!options.forExport && options.showBlurFrame) {
      ctx2d.strokeStyle = "rgba(80, 80, 80, 0.35)";
      ctx2d.lineWidth = 1.25;
      ctx2d.setLineDash([5, 4]);
      ctx2d.strokeRect(x, y, width, height);
    }
    ctx2d.restore();
  }
}

function layerLabel(layer, index) {
  if (layer.kind === "shape") {
    return `${index + 1}. ${layer.shape}`;
  }
  if (layer.kind === "text") {
    return `${index + 1}. ${layer.sticky ? "sticky note" : "text"}`;
  }
  return `${index + 1}. ${layer.kind}`;
}

function reorderLayerByDisplayPosition(dragLayerId, targetLayerId, beforeTarget) {
  const displayIds = [...state.layers].reverse().map((layer) => layer.id);
  const fromIndex = displayIds.indexOf(dragLayerId);
  const targetIndex = displayIds.indexOf(targetLayerId);
  if (fromIndex < 0 || targetIndex < 0) {
    return false;
  }

  let insertionIndex = targetIndex + (beforeTarget ? 0 : 1);
  if (fromIndex < insertionIndex) {
    insertionIndex -= 1;
  }
  if (insertionIndex === fromIndex) {
    return false;
  }

  displayIds.splice(fromIndex, 1);
  displayIds.splice(insertionIndex, 0, dragLayerId);

  const layersById = new Map(state.layers.map((layer) => [layer.id, layer]));
  const reorderedDisplayLayers = displayIds.map((id) => layersById.get(id)).filter(Boolean);
  state.layers = reorderedDisplayLayers.reverse();
  return true;
}

function setDropIndicator(layerId, beforeTarget) {
  state.dropLayerId = layerId;
  state.dropBefore = beforeTarget;

  const items = dom.layersList.querySelectorAll("li");
  for (const item of items) {
    const isTarget = item.dataset.layerId === layerId;
    item.classList.toggle("drop-before", isTarget && beforeTarget);
    item.classList.toggle("drop-after", isTarget && !beforeTarget);
  }
}

function clearLayerDropIndicator() {
  state.dropLayerId = null;
  state.dropBefore = true;
  const items = dom.layersList.querySelectorAll("li");
  for (const item of items) {
    item.classList.remove("drop-before", "drop-after");
  }
}

function clearLayerDragState() {
  state.draggingLayerId = null;
  clearLayerDropIndicator();
}

function removeLayer(layerId) {
  const index = state.layers.findIndex((item) => item.id === layerId);
  if (index < 0) {
    return;
  }

  if (state.inlineEditingLayerId === layerId) {
    closeInlineTextEditor({ commit: false });
  } else {
    closeInlineTextEditor({ commit: true });
  }

  pushHistory();
  state.layers.splice(index, 1);
  if (state.selectedLayerId === layerId) {
    state.selectedLayerId = null;
  }
  syncInspectorFromSelection();
  render();
}

function updateLayersList() {
  dom.layersList.textContent = "";

  const reversed = [...state.layers].reverse();
  for (const layer of reversed) {
    const originalIndex = state.layers.findIndex((item) => item.id === layer.id);

    const item = document.createElement("li");
    item.dataset.layerId = layer.id;
    item.draggable = true;
    item.classList.toggle("is-selected", state.selectedLayerId === layer.id);
    item.classList.toggle("is-dragging", state.draggingLayerId === layer.id);
    if (state.dropLayerId === layer.id) {
      item.classList.toggle("drop-before", state.dropBefore);
      item.classList.toggle("drop-after", !state.dropBefore);
    }

    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "layer-drag-handle";
    dragHandle.textContent = "⋮⋮";
    dragHandle.title = "Drag to reorder";
    dragHandle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isInlineEditing() && state.inlineEditingLayerId !== layer.id) {
        closeInlineTextEditor({ commit: true });
      }
      state.selectedLayerId = layer.id;
      syncInspectorFromSelection();
      render();
    });

    const main = document.createElement("button");
    main.type = "button";
    main.className = "layer-item-main";
    const label = document.createElement("span");
    label.textContent = layerLabel(layer, originalIndex);
    main.appendChild(label);
    main.addEventListener("click", () => {
      if (isInlineEditing() && state.inlineEditingLayerId !== layer.id) {
        closeInlineTextEditor({ commit: true });
      }
      state.selectedLayerId = layer.id;
      syncInspectorFromSelection();
      render();
    });

    const actions = document.createElement("div");
    actions.className = "layer-item-actions";

    const trashButton = document.createElement("button");
    trashButton.type = "button";
    trashButton.className = "layer-icon-button";
    trashButton.textContent = "🗑";
    trashButton.title = "Delete layer";
    trashButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeLayer(layer.id);
    });

    actions.appendChild(trashButton);

    item.addEventListener("dragstart", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".layer-item-actions")) {
        event.preventDefault();
        return;
      }
      state.draggingLayerId = layer.id;
      clearLayerDropIndicator();
      item.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", layer.id);
      }
    });

    item.addEventListener("dragover", (event) => {
      if (!state.draggingLayerId || state.draggingLayerId === layer.id) {
        return;
      }
      event.preventDefault();
      const rect = item.getBoundingClientRect();
      const beforeTarget = event.clientY < rect.top + rect.height / 2;
      setDropIndicator(layer.id, beforeTarget);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    item.addEventListener("drop", (event) => {
      if (!state.draggingLayerId) {
        return;
      }
      event.preventDefault();
      const draggedId = state.draggingLayerId;
      const rect = item.getBoundingClientRect();
      const beforeTarget = state.dropLayerId === layer.id
        ? state.dropBefore
        : event.clientY < rect.top + rect.height / 2;
      clearLayerDragState();
      if (draggedId === layer.id) {
        render();
        return;
      }

      closeInlineTextEditor({ commit: true });
      const previousSnapshot = snapshot();
      const changed = reorderLayerByDisplayPosition(draggedId, layer.id, beforeTarget);
      if (changed) {
        pushHistorySnapshot(previousSnapshot);
        state.selectedLayerId = draggedId;
        syncInspectorFromSelection();
        setStatus("Layer order updated.");
      }
      render();
    });

    item.addEventListener("dragend", () => {
      clearLayerDragState();
      render();
    });

    item.appendChild(dragHandle);
    item.appendChild(main);
    item.appendChild(actions);
    dom.layersList.appendChild(item);
  }
}

function updateMetadataView() {
  dom.metadataList.textContent = "";
  const metadata = state.metadata;
  if (!metadata) {
    return;
  }

  const rows = [
    ["URL", metadata.sourceUrl ?? ""],
    ["Title", metadata.pageTitle ?? ""],
    ["Captured", metadata.capturedAt ?? ""],
    ["Mode", metadata.captureMode ?? ""],
    ["Viewport", `${metadata.viewportWidth ?? 0} x ${metadata.viewportHeight ?? 0}`],
    ["Page Height", `${metadata.scrollPageHeight ?? 0}`],
    ["Version", metadata.extensionVersion ?? ""]
  ];

  if (metadata.captureDiagnostics) {
    rows.push(["Frames", String(metadata.captureDiagnostics.frameCount ?? "")]);
    rows.push(["Overlap", `${metadata.captureDiagnostics.overlapCssPx ?? ""}px`]);
    rows.push(["Hidden Pinned", String(metadata.captureDiagnostics.hiddenPinnedCount ?? "")]);
  }

  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    dom.metadataList.append(dt, dd);
  }
}

function getResizeHandlePoints(bounds) {
  return {
    nw: { x: bounds.x, y: bounds.y },
    ne: { x: bounds.x + bounds.width, y: bounds.y },
    sw: { x: bounds.x, y: bounds.y + bounds.height },
    se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  };
}

function drawResizeHandles(bounds) {
  const handles = getResizeHandlePoints(bounds);
  const half = TEXT_HANDLE_SIZE / 2;

  ctx.save();
  ctx.fillStyle = "#f3f9ff";
  ctx.strokeStyle = "rgba(13, 102, 208, 0.95)";
  ctx.lineWidth = 1.4;
  for (const point of Object.values(handles)) {
    ctx.beginPath();
    ctx.rect(point.x - half, point.y - half, TEXT_HANDLE_SIZE, TEXT_HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function getResizeHandleAtPoint(point) {
  if (state.tool !== "move") {
    return null;
  }

  const selected = getSelectedLayer();
  if (!selected) {
    return null;
  }

  const bounds = getLayerBounds(selected);
  if (!bounds) {
    return null;
  }

  const handles = getResizeHandlePoints(bounds);
  const hitRadius = TEXT_HANDLE_SIZE / 2 + 2;
  for (const [handle, handlePoint] of Object.entries(handles)) {
    const withinX = Math.abs(point.x - handlePoint.x) <= hitRadius;
    const withinY = Math.abs(point.y - handlePoint.y) <= hitRadius;
    if (withinX && withinY) {
      return { layerId: selected.id, handle, bounds, kind: selected.kind };
    }
  }

  return null;
}

function startLayerResize(handleHit, point) {
  const layer = state.layers.find((item) => item.id === handleHit.layerId);
  if (!layer) {
    return;
  }

  const bounds = handleHit.bounds;
  const anchors = {
    nw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ne: { x: bounds.x, y: bounds.y + bounds.height },
    sw: { x: bounds.x + bounds.width, y: bounds.y },
    se: { x: bounds.x, y: bounds.y }
  };
  const anchor = anchors[handleHit.handle] ?? anchors.se;
  const startVectorX = point.x - anchor.x;
  const startVectorY = point.y - anchor.y;
  const startDistance = Math.max(1, Math.hypot(startVectorX, startVectorY));

  state.resizingLayer = {
    layerId: layer.id,
    kind: layer.kind,
    anchorX: anchor.x,
    anchorY: anchor.y,
    startDistance,
    startFontSize: layer.kind === "text" ? layer.fontSize ?? state.style.fontSize : null,
    startBoundsX: bounds.x,
    startBoundsY: bounds.y,
    startLayer: structuredClone(layer)
  };
  state.resizingSnapshot = snapshot();
  state.resizingDidChange = false;
  state.pointerOrigin = point;
  setStatus("Resizing layer. Drag a handle. Press Esc to cancel.");
}

function applyLayerResize(point) {
  if (!state.resizingLayer) {
    return;
  }

  const layer = state.layers.find((item) => item.id === state.resizingLayer.layerId);
  if (!layer) {
    return;
  }

  const distance = Math.max(1, Math.hypot(point.x - state.resizingLayer.anchorX, point.y - state.resizingLayer.anchorY));
  const scale = clamp(distance / state.resizingLayer.startDistance, 0.15, 8);
  const startLayer = state.resizingLayer.startLayer;

  if (!startLayer) {
    return;
  }

  if (state.resizingLayer.kind === "text") {
    const nextFontSize = clamp(Math.round((state.resizingLayer.startFontSize ?? state.style.fontSize) * scale), 8, 220);

    const offsetX = state.resizingLayer.startBoundsX - state.resizingLayer.anchorX;
    const offsetY = state.resizingLayer.startBoundsY - state.resizingLayer.anchorY;
    const targetBoundsX = state.resizingLayer.anchorX + offsetX * scale;
    const targetBoundsY = state.resizingLayer.anchorY + offsetY * scale;

    const metrics = getTextMetrics(layer, ctx, { fontSize: nextFontSize, fontFamily: startLayer.fontFamily });
    const padX = layer.sticky ? 10 : 4;
    const padY = layer.sticky ? 8 : 4;

    layer.fontSize = nextFontSize;
    layer.x = targetBoundsX + padX;
    layer.y = targetBoundsY + metrics.lineHeight + padY;

    state.style.fontSize = nextFontSize;
    dom.fontSize.value = String(nextFontSize);
    state.resizingDidChange = true;
    return;
  }

  const anchorX = state.resizingLayer.anchorX;
  const anchorY = state.resizingLayer.anchorY;
  const scaledX = (value) => anchorX + (value - anchorX) * scale;
  const scaledY = (value) => anchorY + (value - anchorY) * scale;

  if (layer.kind === "shape" || layer.kind === "blur") {
    layer.x1 = scaledX(startLayer.x1);
    layer.y1 = scaledY(startLayer.y1);
    layer.x2 = scaledX(startLayer.x2);
    layer.y2 = scaledY(startLayer.y2);
    state.resizingDidChange = true;
    return;
  }

  if (layer.kind === "stroke" || layer.kind === "highlight") {
    layer.points = startLayer.points.map((startPoint) => ({
      x: scaledX(startPoint.x),
      y: scaledY(startPoint.y)
    }));
    state.resizingDidChange = true;
  }
}

function cursorForResizeHandle(handle) {
  if (handle === "nw" || handle === "se") {
    return "nwse-resize";
  }
  return "nesw-resize";
}

function render() {
  if (!state.baseImage) {
    return;
  }

  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.drawImage(state.baseImage, 0, 0);
  for (const layer of state.layers) {
    drawLayer(ctx, layer, {
      forExport: false,
      showBlurFrame: layer.kind === "blur" && state.selectedLayerId === layer.id
    });
  }

  if (state.draft) {
    drawLayer(ctx, state.draft, {
      forExport: false,
      showBlurFrame: state.draft.kind === "blur"
    });
  }

  if (state.selectedLayerId) {
    const selectedLayer = state.layers.find((layer) => layer.id === state.selectedLayerId);
    if (selectedLayer) {
      const bounds = getLayerBounds(selectedLayer);
      if (bounds) {
        ctx.save();
        ctx.strokeStyle = "rgba(13, 102, 208, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        if (state.tool === "move" && !isInlineEditing()) {
          drawResizeHandles(bounds);
        }
        ctx.restore();
      }
    }
  }

  updateLayersList();
}

function getLayerBounds(layer) {
  if (layer.kind === "stroke" || layer.kind === "highlight") {
    if (!layer.points.length) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of layer.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return {
      x: minX - layer.width,
      y: minY - layer.width,
      width: maxX - minX + layer.width * 2,
      height: maxY - minY + layer.width * 2
    };
  }

  if (layer.kind === "shape" || layer.kind === "blur") {
    return normalizeRect(layer.x1, layer.y1, layer.x2, layer.y2);
  }

  if (layer.kind === "text") {
    const textBounds = getTextBounds(layer, ctx);
    return {
      x: textBounds.x,
      y: textBounds.y,
      width: textBounds.width,
      height: textBounds.height
    };
  }

  return null;
}

function findTopLayerAtPoint(point) {
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    const bounds = getLayerBounds(layer);
    if (!bounds) {
      continue;
    }
    const inside =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    if (inside) {
      return layer.id;
    }
  }
  return null;
}

function translateLayer(layer, dx, dy) {
  if (layer.kind === "stroke" || layer.kind === "highlight") {
    layer.points = layer.points.map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    }));
    return;
  }

  if (layer.kind === "shape" || layer.kind === "blur") {
    layer.x1 += dx;
    layer.y1 += dy;
    layer.x2 += dx;
    layer.y2 += dy;
    return;
  }

  if (layer.kind === "text") {
    layer.x += dx;
    layer.y += dy;
  }
}

async function applyCropLayer(cropLayer) {
  const crop = normalizeRect(cropLayer.x1, cropLayer.y1, cropLayer.x2, cropLayer.y2);
  if (crop.width < 3 || crop.height < 3) {
    return;
  }

  const flatCanvas = await buildFlattenedCanvas();
  const output = document.createElement("canvas");
  output.width = Math.round(crop.width);
  output.height = Math.round(crop.height);

  const outputCtx = output.getContext("2d");
  outputCtx.drawImage(
    flatCanvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    output.width,
    output.height
  );

  pushHistory();
  state.baseImageDataUrl = output.toDataURL("image/png");
  state.baseImage = await loadImage(state.baseImageDataUrl);
  state.layers = [];
  state.selectedLayerId = null;
  resizeCanvasToBase();
  syncInspectorFromSelection();
}

function commitLayer(layer) {
  layer.blendMode = getLayerBlendMode(layer);
  pushHistory();
  state.layers.push(layer);
  state.selectedLayerId = layer.id;
  syncInspectorFromSelection();
}

function startDraft(point) {
  const opacity = state.style.opacity;
  const width = state.style.lineWidth;
  const stroke = state.style.strokeColor;
  const fill = state.style.fillColor;
  const blendMode = normalizeBlendMode(state.style.blendMode);

  if (state.tool === "pen") {
    state.draft = createStrokeLayer({
      points: [point],
      color: stroke,
      width,
      opacity,
      blendMode,
      variant: "stroke"
    });
    return;
  }

  if (state.tool === "highlight") {
    const highlightColor =
      state.style.strokeColor === DEFAULT_STROKE_COLOR ? DEFAULT_HIGHLIGHT_COLOR : state.style.strokeColor;
    const highlightWidth = state.style.lineWidth <= 4 ? DEFAULT_HIGHLIGHT_WIDTH : state.style.lineWidth;
    const highlightOpacity = state.style.opacity >= 1 ? DEFAULT_HIGHLIGHT_OPACITY : state.style.opacity;
    state.draft = createStrokeLayer({
      points: [point],
      color: highlightColor,
      width: highlightWidth,
      opacity: Math.min(highlightOpacity, 0.75),
      blendMode: blendMode === "normal" ? "multiply" : blendMode,
      variant: "highlight"
    });
    return;
  }

  if (state.tool === "blur") {
    state.draft = createBlurLayer({
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      opacity,
      strength: state.style.blurStrength,
      blendMode
    });
    return;
  }

  if (["rect", "ellipse", "line", "arrow"].includes(state.tool)) {
    state.draft = createShapeLayer({
      shape: state.tool,
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      stroke,
      fill: state.tool === "line" || state.tool === "arrow" ? null : fill,
      strokeWidth: width,
      opacity,
      blendMode
    });
    return;
  }

  if (state.tool === "crop") {
    state.draft = createShapeLayer({
      shape: "rect",
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      stroke: "#0d66d0",
      fill: "rgba(13, 102, 208, 0.15)",
      strokeWidth: 2,
      opacity: 1,
      blendMode: "normal"
    });
  }
}

function updateDraft(point) {
  if (!state.draft) {
    return;
  }

  if (state.draft.kind === "stroke" || state.draft.kind === "highlight") {
    state.draft.points.push(point);
    return;
  }

  state.draft.x2 = point.x;
  state.draft.y2 = point.y;
}

async function finalizeDraft() {
  if (!state.draft) {
    return;
  }

  if (state.tool === "crop") {
    await applyCropLayer(state.draft);
    state.draft = null;
    render();
    return;
  }

  const draft = state.draft;
  state.draft = null;

  if (draft.kind === "stroke" || draft.kind === "highlight") {
    if (draft.points.length < 2) {
      return;
    }
    commitLayer(draft);
    render();
    return;
  }

  const bounds = getLayerBounds(draft);
  if (!bounds || bounds.width < 2 || bounds.height < 2) {
    return;
  }

  commitLayer(draft);
  render();
}

function insertTextLayerAtPoint(point, sticky, { openEditor = false } = {}) {
  const defaultText = sticky ? "Sticky note" : "Note";
  const text = (state.style.textContent || "").trim() || defaultText;

  commitLayer(
    createTextLayer({
      text,
      x: point.x,
      y: point.y,
      color: state.style.strokeColor,
      background: state.style.fillColor,
      fontSize: state.style.fontSize,
      fontFamily: state.style.fontFamily,
      sticky,
      opacity: state.style.opacity,
      blendMode: normalizeBlendMode(state.style.blendMode)
    })
  );

  render();

  if (openEditor && state.selectedLayerId) {
    openInlineTextEditor(state.selectedLayerId);
  }
}

async function buildFlattenedCanvas() {
  if (!state.baseImage) {
    throw new Error("No base image loaded.");
  }

  const output = document.createElement("canvas");
  output.width = state.baseImage.width;
  output.height = state.baseImage.height;
  const outputCtx = output.getContext("2d");

  outputCtx.drawImage(state.baseImage, 0, 0);
  for (const layer of state.layers) {
    drawLayer(outputCtx, layer, { forExport: true, showBlurFrame: false });
  }

  return output;
}

function toBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas export failed."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function mimeTypeForFormat(format) {
  if (format === "jpg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function formatTimestampForFilename(isoTimestamp) {
  return isoTimestamp.replace(/[:]/g, "-").replace(/\..+$/, "");
}

function sanitizeFilenamePart(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportImage() {
  if (!state.baseImage) {
    return;
  }

  const format = dom.exportFormat.value;
  const quality = Number(dom.exportQuality.value);
  const mimeType = mimeTypeForFormat(format);
  const canvas = await buildFlattenedCanvas();
  const rawBlob = await toBlob(canvas, mimeType, quality);

  const metadata = buildExportMetadata(state.metadata ?? {}, format);
  const enrichedBlob = await embedMetadata(rawBlob, format, metadata);

  const slug = sanitizeFilenamePart(state.metadata?.pageTitle ?? "capture") || "capture";
  const timestamp = formatTimestampForFilename(metadata.exportedAt);
  const extension = format === "jpg" ? "jpg" : format;
  downloadBlob(enrichedBlob, `screenship-${slug}-${timestamp}.${extension}`);
  setStatus(`Saved ${format.toUpperCase()} export.`);
}

async function copyImage() {
  if (!state.baseImage) {
    return;
  }

  const canvas = await buildFlattenedCanvas();
  const blob = await toBlob(canvas, "image/png", 1);

  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  setStatus("Copied PNG to clipboard.");
}

function updateQualityVisibility() {
  const show = dom.exportFormat.value !== "png";
  dom.exportQuality.disabled = !show;
  dom.exportQuality.style.opacity = show ? "1" : "0.4";
}

function handleCanvasPointerDown(event) {
  if (!state.baseImage) {
    return;
  }

  if (isInlineEditing()) {
    closeInlineTextEditor({ commit: true });
  }

  const point = getCanvasPoint(event);

  if (state.tool === "text") {
    const targetLayerId = findTopLayerAtPoint(point);
    const targetLayer = targetLayerId ? state.layers.find((item) => item.id === targetLayerId) : null;
    if (targetLayer?.kind === "text") {
      state.selectedLayerId = targetLayerId;
      syncInspectorFromSelection();
      render();
      openInlineTextEditor(targetLayerId);
      return;
    }

    insertTextLayerAtPoint(point, false, { openEditor: true });
    return;
  }

  if (state.tool === "sticky") {
    const targetLayerId = findTopLayerAtPoint(point);
    const targetLayer = targetLayerId ? state.layers.find((item) => item.id === targetLayerId) : null;
    if (targetLayer?.kind === "text") {
      state.selectedLayerId = targetLayerId;
      syncInspectorFromSelection();
      render();
      openInlineTextEditor(targetLayerId);
      return;
    }

    insertTextLayerAtPoint(point, true, { openEditor: true });
    return;
  }

  if (state.tool === "move") {
    const handleHit = getResizeHandleAtPoint(point);
    if (handleHit) {
      startLayerResize(handleHit, point);
      return;
    }

    const targetLayerId = findTopLayerAtPoint(point);
    state.selectedLayerId = targetLayerId;
    syncInspectorFromSelection();
    updateLayersList();
    render();
    if (targetLayerId) {
      state.movingLayerId = targetLayerId;
      state.movingSnapshot = snapshot();
      state.movingDidTranslate = false;
      state.pointerOrigin = point;
    }
    return;
  }

  state.pointerOrigin = point;
  startDraft(point);
  render();
}

function handleCanvasPointerMove(event) {
  if (!state.baseImage) {
    return;
  }

  const point = getCanvasPoint(event);

  if (state.resizingLayer) {
    applyLayerResize(point);
    render();
    return;
  }

  if (state.movingLayerId && state.pointerOrigin) {
    const layer = state.layers.find((item) => item.id === state.movingLayerId);
    if (!layer) {
      return;
    }
    const dx = point.x - state.pointerOrigin.x;
    const dy = point.y - state.pointerOrigin.y;
    if (dx !== 0 || dy !== 0) {
      state.movingDidTranslate = true;
    }
    translateLayer(layer, dx, dy);
    state.pointerOrigin = point;
    render();
    return;
  }

  if (state.draft) {
    updateDraft(point);
    render();
    return;
  }

  if (state.tool === "move") {
    const handleHit = getResizeHandleAtPoint(point);
    if (handleHit) {
      dom.canvas.style.cursor = cursorForResizeHandle(handleHit.handle);
      return;
    }
    dom.canvas.style.cursor = state.selectedLayerId ? "move" : "default";
  }
}

async function handleCanvasPointerUp() {
  if (state.resizingLayer) {
    if (state.resizingDidChange && state.resizingSnapshot) {
      pushHistorySnapshot(state.resizingSnapshot);
      syncInspectorFromSelection();
    }
    state.resizingLayer = null;
    state.resizingSnapshot = null;
    state.resizingDidChange = false;
    state.pointerOrigin = null;
    render();
    return;
  }

  if (state.movingLayerId) {
    if (state.movingDidTranslate && state.movingSnapshot) {
      pushHistorySnapshot(state.movingSnapshot);
    }
    state.movingLayerId = null;
    state.movingSnapshot = null;
    state.movingDidTranslate = false;
    state.pointerOrigin = null;
    render();
    return;
  }

  if (state.draft) {
    await finalizeDraft();
    state.pointerOrigin = null;
  }
}

function handleCanvasDoubleClick(event) {
  if (!state.baseImage) {
    return;
  }

  const point = getCanvasPoint(event);
  const targetLayerId = findTopLayerAtPoint(point);
  if (!targetLayerId) {
    return;
  }

  const layer = state.layers.find((item) => item.id === targetLayerId);
  if (!layer || layer.kind !== "text") {
    return;
  }

  openInlineTextEditor(targetLayerId);
}

async function loadSession() {
  const params = new URLSearchParams(location.search);
  state.sessionId = params.get("sessionId");

  if (!state.sessionId) {
    setStatus("No capture session id provided.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.EDITOR_LOAD_SESSION,
    sessionId: state.sessionId
  });

  if (!response?.ok || !response.session) {
    throw new Error(response?.error ?? "Could not load capture session.");
  }

  state.metadata = response.session.metadata;
  state.baseImageDataUrl = response.session.imageDataUrl;
  state.baseImage = await loadImage(state.baseImageDataUrl);
  resizeCanvasToBase();

  dom.emptyState.classList.add("is-hidden");
  dom.canvasWrapper.classList.remove("is-hidden");

  updateMetadataView();
  updateQualityVisibility();
  dom.blendMode.value = normalizeBlendMode(state.style.blendMode);
  dom.blurStrength.value = String(state.style.blurStrength);
  dom.fontFamily.value = state.style.fontFamily;
  dom.textContent.value = state.style.textContent;
  syncInspectorFromSelection();
  render();
  setStatus("Session loaded.");

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.EDITOR_CLEAR_SESSION,
    sessionId: state.sessionId
  });
}

function bindEvents() {
  if (dom.themeToggle) {
    dom.themeToggle.addEventListener("click", toggleTheme);
  }

  for (const toolButton of dom.toolButtons) {
    toolButton.addEventListener("click", () => setTool(toolButton.dataset.tool));
  }

  dom.strokeColor.addEventListener("input", (event) => {
    state.style.strokeColor = event.target.value;
    applyStyleToSelectedLayer();
    render();
  });
  dom.fillColor.addEventListener("input", (event) => {
    state.style.fillColor = event.target.value;
    applyStyleToSelectedLayer();
    render();
  });
  dom.strokeWidth.addEventListener("input", (event) => {
    state.style.lineWidth = Number(event.target.value);
    applyStyleToSelectedLayer();
    render();
  });
  dom.opacity.addEventListener("input", (event) => {
    state.style.opacity = Number(event.target.value);
    applyStyleToSelectedLayer();
    render();
  });
  dom.blendMode.addEventListener("change", (event) => {
    state.style.blendMode = normalizeBlendMode(event.target.value);
    applyStyleToSelectedLayer();
    render();
  });
  dom.fontSize.addEventListener("input", (event) => {
    state.style.fontSize = Number(event.target.value);
    applyStyleToSelectedLayer();
    render();
  });
  dom.blurStrength.addEventListener("input", (event) => {
    state.style.blurStrength = Number(event.target.value);
    applyStyleToSelectedLayer();
    render();
  });
  dom.fontFamily.addEventListener("change", (event) => {
    state.style.fontFamily = event.target.value;
    applyStyleToSelectedLayer();
    render();
  });
  dom.textContent.addEventListener("input", (event) => {
    state.style.textContent = event.target.value;
    applyStyleToSelectedLayer();
    render();
  });

  dom.undoButton.addEventListener("click", () => void undo());
  dom.redoButton.addEventListener("click", () => void redo());
  dom.editTextButton.addEventListener("click", () => {
    const selected = getSelectedLayer();
    if (!selected || selected.kind !== "text") {
      setStatus("Select a text layer first.");
      return;
    }
    openInlineTextEditor(selected.id);
  });

  dom.exportFormat.addEventListener("change", updateQualityVisibility);
  dom.exportButton.addEventListener("click", () => {
    closeInlineTextEditor({ commit: true });
    void exportImage();
  });
  dom.copyButton.addEventListener("click", () => {
    closeInlineTextEditor({ commit: true });
    void copyImage();
  });

  dom.canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  dom.canvas.addEventListener("pointermove", handleCanvasPointerMove);
  dom.canvas.addEventListener("pointerup", () => void handleCanvasPointerUp());
  dom.canvas.addEventListener("pointerleave", () => void handleCanvasPointerUp());
  dom.canvas.addEventListener("dblclick", handleCanvasDoubleClick);
  dom.canvasWrapper.addEventListener("scroll", () => {
    if (isInlineEditing()) {
      closeInlineTextEditor({ commit: true });
    }
  });

  dom.inlineTextEditor.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  dom.inlineTextEditor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeInlineTextEditor({ commit: false });
      return;
    }
    if ((event.key === "Enter" && (event.metaKey || event.ctrlKey)) || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      closeInlineTextEditor({ commit: true });
    }
  });
  dom.inlineTextEditor.addEventListener("blur", () => {
    closeInlineTextEditor({ commit: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelActiveToolAction();
      return;
    }

    if (isInlineEditing()) {
      return;
    }
    const lower = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && lower === "z" && !event.shiftKey) {
      event.preventDefault();
      void undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (lower === "z" || lower === "y") && event.shiftKey) {
      event.preventDefault();
      void redo();
      return;
    }
    if (event.key === "Delete" && state.selectedLayerId) {
      event.preventDefault();
      removeLayer(state.selectedLayerId);
      return;
    }

    if (event.key === "Enter") {
      const selected = getSelectedLayer();
      if (selected && selected.kind === "text") {
        event.preventDefault();
        openInlineTextEditor(selected.id);
        return;
      }
    }

    const tool = TOOL_HOTKEYS.get(lower);
    if (tool) {
      event.preventDefault();
      setTool(tool);
    }
  });
}

async function bootstrap() {
  applyTheme(getPreferredTheme());
  bindEvents();
  setTool("move");
  try {
    await loadSession();
  } catch (error) {
    setStatus(error.message, true);
  }
}

void bootstrap();
