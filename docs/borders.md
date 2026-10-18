# Resizable label borders

Choose **Border** in the insert toolbar, then select a style in the properties panel.
The catalog contains the original **Rounded** style and 17 selected designs from the concept sheet.
Picker names and asset filenames have no numbered prefixes. Hidden legacy demonstration styles remain readable in old saved labels.

Drag any of the eight handles to change width/height independently. Fixed corner and anchored decorations keep their size, and repeated artwork retains whole tiles and spacing. The properties panel provides dimensions, line width, artwork size, inset, color, repeat gap, eight anchors and **Fit to label**. Separate minimum dimensions keep large decorations inside the object.

PNG botanical, animal and bow decorations are drawn 25% larger than the initial bitmap integration. The olive design uses **frame-height** sizing: its two mirrored sprigs act as the left/right frame, filling the available height with uniform scaling. On narrow, tall labels they stop growing before colliding, retaining a central gap. Their aspect ratio is never stretched. Other styles retain fixed-size decorations as the frame changes dimensions.

## Identity and saved labels

A border's package ID is stable and independent of its translated name, picker order or original concept-sheet number. For example, the olive package is `niimblue.olive`; its initial content version is `1.0.0`.

Newly saved `LabelBorder` objects include:

```json
{
  "type": "LabelBorder",
  "borderId": "niimblue.olive",
  "borderVersion": "1.0.0",
  "preset": "olive",
  "width": 240,
  "height": 96,
  "decorationSize": 16,
  "borderColor": "#000000"
}
```

The existing `preset` field remains a compatibility alias. Objects from older labels containing only this alias still load; new restoration resolves the stable package ID and checks its version. Unknown package IDs or unsupported versions produce an error rather than silently changing the design. Instance settings (position, dimensions, color, anchor, etc.) stay in the label; the reusable artwork and recipe belong to the package. A future package content update must retain the old revision or provide an explicit migration.

## Package storage and transfer

Each `src/assets/borders/<name>/` directory contains one complete package:

- `border.json`: format/schema version, stable ID/content version, localized names, defaults, procedural engine recipe/version, resize mode, scale/minimums, local PNG metadata, vector paths and extraction provenance.
- `assets/*.png`: all PNGs referenced by that manifest. Shared-looking artwork is deliberately copied into each dependent package, so copying/exporting a directory preserves every dependency. Vite can deduplicate identical production image files by content hash.

PNG metadata records the original image dimensions, alpha bounds and proportional drawing dimensions. The renderer crops transparent padding and applies the selected border color through the alpha channel. Fine ink lines use cached, progressively halved bitmaps at small sizes. SVG exports embed PNG data, sharing one definition for repeated placements.

`border_catalog.ts` is the built-in package index; image keys are scoped to the package ID (for example, `niimblue.meadow/petal`), avoiding collisions between packages. `border_layout.ts` accepts either a built-in package or an independent manifest and builds procedural lines and artwork placements. Common layout code is versioned by the package's `layout.engine`/`layout.version`/`layout.recipe`; arbitrary scripts are not part of the format.

The self-contained transfer format is `.niimborder`, a JSON archive containing the complete manifest and original PNG data URIs. Its envelope has its own format/schema version, distinct from the border's content version. It requires no development-server URL or neighboring files:

```sh
node --experimental-strip-types scripts/export-border.mjs olive /tmp/olive.niimborder
```

`border_package.ts` exposes `createBorderArchive`, `serializeBorderArchive` and `parseBorderArchive`. Parsing validates supported versions/recipes, resource completeness, package-relative paths, PNG headers/dimensions, alpha format and crop/aspect metadata. It returns a validated package without overwriting any installed design. Tests demonstrate rendering a renamed package from only its manifest and embedded images. The existing procedural packages remain built-in. A second layout engine, `niimblue-image` version 1, represents a complete image frame with a single `frame` PNG asset, preserved colors/alpha and a default `contain` fit. It shares the archive envelope and stable identity/version fields. Arbitrary executable code and external image URLs are not supported.

## Custom image borders

Insert **Border**, then choose **My borders → Upload image border**. PNG, JPEG and WebP uploads are normalized to RGBA PNG without recoloring or automatic background removal. Enter a name, inspect the preview and select **Save and use**. Image borders support dimensions, inset, **Keep proportions** (default), explicit **Fill frame (stretch)** and **Fit to label**; procedural line/decorative controls are hidden. Each source/normalized image is limited to 10 MiB, 8192 pixels per side and 16 million pixels in total.

The selected storage provider owns the reusable library. Local records use IndexedDB with binary PNG blobs and small preview metadata. Remote records use the authenticated `/api/v1/borders` API; the server stores immutable PNG files and user-scoped SQLite metadata. The picker refreshes metadata on opening, returning to a visible page, reconnecting, and every 30 seconds while visible. It downloads full PNGs only when applying an existing border. Same-name uploads are rejected within a user's library. Switching storage/users does not apply late responses from the previous library.

`LabelBorder` embeds its complete image archive in `borderPackage`, together with `borderId`, `borderVersion` and the per-instance `imageFit`. Label JSON export/import, IndexedDB recovery, undo/redo, clone, SVG export and print preview restore that embedded copy independently of the reusable library or storage service. Deleting a library entry leaves current and saved labels intact. Built-in procedural borders continue to serialize their existing IDs/preset aliases.

The picker accepts image files; importing arbitrary procedural `.niimborder` packages remains a separate feature.

## Implementation and verification

`LabelBorder` is a registered Fabric object. Its controls resize dimensions with a fixed opposite anchor. JSON restoration waits for PNG decoding; clone, undo/redo and print preview use the same rendering path. `BorderParamsControls.svelte` renders the package's localized names and previews.

Run `npm test` with Node 22.6+, `npm run sv-check` and `npm run build-rel`. Border tests cover fixed corners, anchors, repeat spacing, selected styles, minimum dimensions, image proportions, full-height olive frames, all package round trips, missing resources and standalone package rendering. Browser checks cover real pointer drags, rotation, color, restore/clone, print preview and mobile controls.
