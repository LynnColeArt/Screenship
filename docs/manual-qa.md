# Manual QA and Tuning Checklist

## 1) Full-Page Capture Reliability Pass

Test on pages with different behaviors:

- Long documentation page with sticky top nav
- News/article page with lazy-loaded images
- Dashboard page with fixed side panels
- Infinite-scroll feed page

For each page:

1. Run `Scrolling Full Page` capture.
2. Verify no duplicate sticky headers in stitched output.
3. Verify seams are not visible at stitch boundaries.
4. Verify lazy-loaded sections appear (not blank placeholders).
5. Verify capture returns to original scroll position.

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

## 3) Export Metadata Sanity

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

