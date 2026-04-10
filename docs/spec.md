# ScreenShip Chrome Extension Spec

## 1. Product Summary

ScreenShip is a free, local-first Chrome extension for screenshot capture and lightweight image editing.
It supports selection and scrolling full-page capture, Photoshop-inspired editing, layer-based authoring during session, and flattened export with embedded provenance metadata.

## 2. Goals

- Capture screenshots in two primary modes:
  - Selection capture
  - Scrolling full-page capture
- Edit captures with crop, doodle, notes, and shape tools.
- Export flattened images in PNG, JPG, and WebP.
- Embed metadata in exported files, including full source URL and capture timestamp.
- Provide a Photoshop-like interface familiarity without replicating full Photoshop complexity.

## 3. Non-Goals (v1)

- No paywall or account system.
- No cloud sync.
- No multi-document workflows.
- No project file format or reopening editable sessions.
- No advanced photo manipulation (filters, masking, blend modes, smart objects).

## 4. Target Users

- Users who need quick annotated screenshots for bug reports, docs, support, and team communication.
- Users frustrated by trialware limits or feature paywalls in screenshot tools.

## 5. User Stories

- As a user, I can capture a selected portion of the page.
- As a user, I can capture a full scrolling page.
- As a user, I can crop and annotate with text, arrows, and shapes.
- As a user, I can free-draw and highlight.
- As a user, I can style annotations with foreground/background colors.
- As a user, I can add notes in plain text or sticky-note style.
- As a user, I can export a flattened PNG/JPG/WebP image.
- As a user, I can inspect metadata showing where and when the screenshot was created.

## 6. Functional Requirements

### 6.1 Capture

- `Selection Capture`
  - User invokes extension and drags a rectangular area.
  - Selected region is rasterized at device pixel ratio for crisp output.
- `Scrolling Full-Page Capture`
  - Extension auto-scrolls from top to bottom.
  - Captures viewport slices.
  - Stitches slices into one full image with overlap handling.
  - Restores original scroll position after capture.
- `Viewport Capture` (optional quick mode)
  - Single-frame current viewport capture.

### 6.2 Editor

- Canvas loads captured image as locked base layer.
- Supported tools:
  - Move/select
  - Crop
  - Pen/doodle
  - Highlight
  - Blur brush (basic pixelation/blur effect)
  - Text
  - Sticky note preset (text with tinted background)
  - Rectangle/square
  - Ellipse/circle
  - Line
  - Arrow
- Undo/redo stack (minimum 50 actions).
- Zoom controls and pan.

### 6.3 Styling

- Foreground color picker for strokes/text.
- Background/fill color picker for fill-enabled tools.
- Per-tool controls:
  - Stroke width
  - Fill on/off
  - Opacity
  - Font size (text/sticky note)

### 6.4 Layering Model

- Base screenshot layer is always locked.
- New objects (shape/text/stroke/highlight/blur region) are independent runtime layers.
- Layer ordering supported via layer panel (bring forward/back).
- Export always flattens layers into a single raster image.
- No persistent project/session file output.

### 6.5 Export

- Formats: PNG, JPG, WebP.
- Quality options:
  - JPG/WebP quality slider (default 0.9).
  - PNG quality not exposed (lossless).
- Export options:
  - Download file
  - Copy image to clipboard (if permission/capability available)

### 6.6 Metadata Embedding

Embedded metadata payload fields:

- `sourceUrl` (full URL)
- `pageTitle`
- `capturedAt` (ISO-8601 UTC)
- `captureMode` (`selection`, `scrolling_full_page`, optionally `viewport`)
- `viewportWidth`
- `viewportHeight`
- `scrollPageHeight` (if full-page)
- `userAgent`
- `extensionVersion`
- `exportFormat`

Format strategy:

- PNG: embed JSON payload in a `tEXt`/`iTXt` chunk.
- JPG: embed payload in EXIF `UserComment` + optional XMP mirror.
- WebP: embed payload in XMP chunk.

Notes:

- Some third-party editors/services strip metadata on re-save.
- ScreenShip guarantees metadata presence at export-time only.

## 7. UX and UI Requirements

Photoshop-inspired layout:

- Left vertical toolbar for tools.
- Top action bar for capture mode, undo/redo, zoom, export.
- Right properties + layers panel.
- Central canvas workspace with neutral background and ruler-like spacing.

Interaction requirements:

- Keyboard shortcuts:
  - `V` move/select
  - `C` crop
  - `P` pen
  - `H` highlight
  - `B` blur
  - `T` text
  - `U` shape cycle
  - `Ctrl/Cmd+Z` undo
  - `Ctrl/Cmd+Shift+Z` redo
  - `Delete` remove selected layer
- Clear active tool indication.
- Cursor changes by tool type.
- Responsive support for common desktop widths.

## 8. Technical Architecture (Manifest V3)

### 8.1 Components

- Service worker (`background`)
  - Orchestrates capture requests, tab messaging, and stitching jobs.
- Content script
  - Renders selection overlay and full-page capture helper hooks.
- Editor page (`editor.html`)
  - Main canvas app (tooling, layers, export).
- Shared modules
  - Capture pipeline
  - Layer model
  - Metadata writer
  - Export encoder

### 8.2 Permissions

Required:

- `activeTab`
- `scripting`
- `tabs`
- `storage`
- `downloads`
- `clipboardWrite` (for copy image feature)

Host permissions:

- `<all_urls>` or runtime-requested host permissions for capture reliability.

### 8.3 Data Flow

1. User triggers capture from extension action popup.
2. Capture mode runs in active tab (selection or scrolling).
3. Captured bitmap is passed to editor.
4. User edits via layer actions.
5. Export pipeline flattens canvas and injects metadata.
6. Final image downloaded/copied.

## 9. Data Model (Editor Runtime)

```ts
type CaptureMetadata = {
  sourceUrl: string;
  pageTitle: string;
  capturedAt: string; // ISO-8601 UTC
  captureMode: "selection" | "scrolling_full_page" | "viewport";
  viewportWidth: number;
  viewportHeight: number;
  scrollPageHeight?: number;
  userAgent: string;
  extensionVersion: string;
  exportFormat?: "png" | "jpg" | "webp";
};

type Layer =
  | { id: string; type: "stroke"; points: Array<[number, number]>; color: string; width: number; opacity: number }
  | { id: string; type: "shape"; shape: "rect" | "ellipse" | "line" | "arrow"; bounds: { x: number; y: number; w: number; h: number }; stroke: string; fill?: string; strokeWidth: number; opacity: number }
  | { id: string; type: "text"; text: string; x: number; y: number; color: string; bg?: string; fontSize: number; fontFamily: string; sticky: boolean; opacity: number }
  | { id: string; type: "highlight"; points: Array<[number, number]>; color: string; width: number; opacity: number }
  | { id: string; type: "blur"; regions: Array<{ x: number; y: number; w: number; h: number }>; strength: number };
```

## 10. Quality Requirements

- Capture reliability:
  - Selection capture success rate >= 99% on common static pages.
  - Full-page stitching visually correct on common document-style pages.
- Performance:
  - Editor initial load <= 1.5s for a typical 1920x1080 capture on mid-tier hardware.
  - Interaction latency <= 16ms target for common operations.
- Privacy:
  - All processing local in browser extension context.
  - No outbound network requests for capture/edit/export path.

## 11. Edge Cases

- Sticky/fixed headers in full-page scroll capture.
- Lazy-loaded content changing during scroll stitch.
- Extremely long pages (memory pressure fallback).
- Cross-origin iframes and restricted chrome:// pages (capture limitations should be user-visible).
- DevicePixelRatio mismatch causing blur (must normalize).

## 12. MVP Acceptance Criteria

- User can capture selection area and open editor.
- User can capture scrolling full page and open editor.
- User can crop, draw, add text notes, add sticky note, and place shapes (circle, square/rect, arrow, line).
- User can change foreground/background colors where applicable.
- User can export flattened PNG, JPG, and WebP.
- Exported file contains metadata fields listed in section 6.6.
- UI follows Photoshop-like structure (left tools, top controls, right properties/layers, center canvas).

## 13. Milestones

- M1: Extension scaffold + selection capture + editor shell
- M2: Core tools (crop, pen, text, shapes, sticky note, colors, undo/redo)
- M3: Scrolling full-page capture + stitching
- M4: Export (PNG/JPG/WebP) + metadata embedding
- M5: QA polish + Chrome Web Store assets/listing

## 14. Publish Plan (Chrome Web Store)

- Prepare listing:
  - Name, short description, long description
  - 128x128 icon + screenshots
  - Privacy disclosure (local-first, no data sale)
- Package and submit:
  - Build release zip
  - Upload to developer dashboard
  - Complete compliance form
- Post-launch:
  - Collect feedback/issues
  - Prioritize reliability fixes for full-page stitch edge cases

