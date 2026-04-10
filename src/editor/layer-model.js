export function createLayerId() {
  return crypto.randomUUID();
}

export function cloneLayers(layers) {
  return structuredClone(layers);
}

export function createStrokeLayer({
  points,
  color,
  width,
  opacity,
  blendMode = "normal",
  variant = "stroke"
}) {
  return {
    id: createLayerId(),
    kind: variant,
    points,
    color,
    width,
    opacity,
    blendMode
  };
}

export function createShapeLayer({
  shape,
  x1,
  y1,
  x2,
  y2,
  stroke,
  fill,
  strokeWidth,
  opacity,
  blendMode = "normal"
}) {
  return {
    id: createLayerId(),
    kind: "shape",
    shape,
    x1,
    y1,
    x2,
    y2,
    stroke,
    fill,
    strokeWidth,
    opacity,
    blendMode
  };
}

export function createTextLayer({
  text,
  x,
  y,
  color,
  background,
  fontSize,
  fontFamily,
  sticky,
  opacity,
  blendMode = "normal"
}) {
  return {
    id: createLayerId(),
    kind: "text",
    text,
    x,
    y,
    color,
    background,
    fontSize,
    fontFamily,
    sticky,
    opacity,
    blendMode
  };
}

export function createBlurLayer({ x1, y1, x2, y2, opacity, strength, blendMode = "normal" }) {
  return {
    id: createLayerId(),
    kind: "blur",
    x1,
    y1,
    x2,
    y2,
    opacity,
    strength,
    blendMode
  };
}
