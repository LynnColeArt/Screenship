# ScreenShip

ScreenShip is a local-first Chrome extension scaffold for:

- Selection and scrolling full-page screenshot capture
- Photoshop-style annotation/editor workflow
- Flattened export to PNG, JPG, and WebP
- Capture metadata pipeline hooks

## Repository Layout

- `manifest.json`: Chrome extension manifest (MV3)
- `docs/spec.md`: Product and implementation spec
- `docs/manual-qa.md`: Manual test + tuning checklist
- `src/background`: Service worker and capture orchestration
- `src/content`: Selection overlay and scrolling capture scripts
- `src/popup`: Extension action popup
- `src/editor`: Canvas editor UI and runtime layer model
- `src/shared`: Shared message contracts and metadata helpers
- `scripts/verify-metadata.js`: CLI helper to inspect embedded export metadata

## Run (Unpacked Extension)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory.
5. Pin and open the ScreenShip extension from the toolbar.

## Current Scaffold Status

- End-to-end flow is wired: popup -> capture mode -> editor session.
- Selection and scrolling full-page capture pipeline exists.
- Editor shell includes core tools, layers, and export actions.
- Metadata embedding is implemented for PNG (`iTXt`), JPG (XMP APP1), and WebP (XMP chunk).

## Verify Metadata

Use the verifier on an exported image:

```bash
node scripts/verify-metadata.js /path/to/exported-image.png
```

## Next Build Steps

1. Improve full-page stitch quality for sticky headers and dynamic content.
2. Add refined blur/highlight rendering and richer text editing controls.
3. Add extension icons and Chrome Web Store packaging assets.
4. Add automated integration tests around capture and export behaviors.
