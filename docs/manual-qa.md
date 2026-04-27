# Manual QA and Tuning Checklist

## 1) Full-Page Capture Reliability Pass

Test on pages with different behaviors:

- Long documentation page with sticky top nav
- News/article page with lazy-loaded images
- Dashboard page with fixed side panels
- Infinite-scroll feed page
- LinkedIn feed or profile page

For each page:

1. Run `Scrolling Full Page` capture.
2. Verify no duplicate sticky headers in stitched output.
3. Verify seams are not visible at stitch boundaries.
4. Verify lazy-loaded sections appear (not blank placeholders).
5. Verify capture returns to original scroll position.
6. On infinite feeds, verify capture finishes instead of chasing newly loaded content forever.

If tuning is needed, adjust in `src/content/scroll-capture.js`:

- `WAIT_BETWEEN_SCROLL_MS`
- `MAX_CAPTURE_FRAMES`
- `chooseOverlap(viewportHeight, hiddenPinnedCount)`

## 2) Text Editing UX Pass

1. Add a text layer and a sticky-note layer.
2. Double-click each text layer to open inline editor.
3. Confirm `Ctrl/Cmd+Enter` applies and `Esc` cancels.
4. Confirm `Edit Text` button works for selected text layer.
5. Confirm `Note Text` panel updates selected text live.
6. Confirm multi-line text renders correctly after export.

## 3) Crop Auto-Scroll Reliability Pass

1. Capture a tall page so the editor canvas exceeds the visible viewport.
2. Select the Crop tool and drag toward the bottom edge of the canvas viewport.
3. Verify the canvas scrolls steadily while the crop rectangle keeps extending.
4. Repeat near the top edge and both horizontal edges.
5. Confirm releasing the pointer stops auto-scroll immediately.

## 4) Rotation and Zoom Pass

1. Create a rectangle, a pen stroke, and a text layer.
2. Rotate each supported layer from the canvas rotate handle and confirm selection still works.
3. Change zoom between `25%`, `100%`, and `300%`.
4. Confirm dragging, resizing, crop, and text editing still land in the right place at each zoom level.
5. Export one rotated composition and confirm the output matches the editor.

## 5) Blur Rendering Pass

1. Add one blur region over text or a face and confirm the default mode looks like a real Gaussian blur instead of mosaic pixelation.
2. Switch the selected blur layer to `Pixelate` and confirm the preview changes immediately.
3. Adjust `Blur Strength` in both modes and confirm editor and export match.
4. Stack a blur region over existing annotations and confirm only content beneath the blur is affected.

## 6) Export Metadata Sanity

After exporting test images:

```bash
node scripts/verify-metadata.js /path/to/export.png
node scripts/verify-metadata.js /path/to/export.jpg
node scripts/verify-metadata.js /path/to/export.webp
```

Confirm metadata includes:

- `sourceUrl`
- `capturedAt`
- `captureMode`
- `exportFormat`
