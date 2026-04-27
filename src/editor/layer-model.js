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
  rotation = 0,
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
    rotation,
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
  rotation = 0,
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
    rotation,
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
  rotation = 0,
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
    rotation,
    blendMode
  };
}

export function createBlurLayer({
  x1,
  y1,
  x2,
  y2,
  opacity,
  strength,
  mode = "gaussian",
  rotation = 0,
  blendMode = "normal"
}) {
  return {
    id: createLayerId(),
    kind: "blur",
    x1,
    y1,
    x2,
    y2,
    opacity,
    strength,
    mode,
    rotation,
    blendMode
  };
}
