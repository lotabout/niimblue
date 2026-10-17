# Resizable label borders

Choose **Border** in the insert toolbar, then select a style in the properties panel.
Drag any of the eight handles to change width/height independently. Corners and decorations
keep their size; repeated artwork retains its size and gap, with whole tiles centered along
each available edge. The properties panel also provides dimensions, line width, artwork size,
inset, color, repeat gap, eight decoration anchors, and **Fit to label**.

Minimum dimensions prevent decorations from overlapping. Increasing artwork size or inset may
increase the border dimensions. Fit is disabled if the label cannot contain the current artwork;
reduce the artwork size or inset first. Dimensions and artwork settings use label canvas pixels,
so display zoom does not change their printed size.

## Implementation

- `src/utils/border_layout.ts` holds original 24 × 24 vector motifs, declarative recipes and a pure
  layout function shared by Canvas rendering, SVG export and style thumbnails.
- Recipes combine `corners` (fixed artwork at four corners, connected by variable-length edges),
  `decoration` (fixed-size artwork at a selected anchor), and `repeat` (whole edge tiles).
  `garden` demonstrates all three behaviors together. Rounded corner geometry also stays fixed.
  Edge segments leave gaps around decorations instead of covering existing content with white.
- `src/fabric-object/border.ts` registers `LabelBorder` with Fabric. Its controls change dimensions
  with a fixed opposite anchor instead of scaling artwork. All border settings are serialized,
  allowing the existing clone, undo/redo, save/load and print-preview paths to reuse the object.
- `BorderParamsControls.svelte` provides preset thumbnails and editing controls. English and
  Simplified Chinese strings are included; other locales use the existing English fallback.

To add artwork, add a path to `BORDER_MOTIFS` and reference it in a `BORDER_PRESETS` recipe, then
add its translated name. These are vector components; importing a flattened SVG or bitmap does
not automatically infer corner cuts, anchors or tile boundaries. Bitmap nine-slice import and
arbitrary user-supplied border recipes are not included in this first version.

## Verification

Run `npm test` with Node 22.6+ for layout regressions, plus `npm run sv-check` and `npm run build`.
Layout tests cover fixed corners, all eight anchors, whole-tile repetition, mixed recipes and
minimum sizes. Browser verification should also cover rotated corner/edge drags, clone,
undo/redo, JSON restore and print preview. All bundled artwork is original; no NIIMBOT assets
or third-party artwork are required.
