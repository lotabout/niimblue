# Border packages

Each named subdirectory is a complete border package. A package contains `border.json` and all referenced files under `assets/`. All PNG and vector assets used by a recipe live inside that package. No package depends on another package or on a global artwork manifest.

```text
olive/
  border.json
  assets/
    olive.png
```

`border.json` owns the stable ID, content version, localized names, procedural layout recipe/version, resize mode, artwork scale, default settings, minimum dimensions, PNG crop metadata, vector paths and ImageGen provenance/extraction prompts. Names and filenames have no numbered prefixes. Concept-sheet numbers are provenance metadata only.

PNG files are the original transparent outputs from the built-in ImageGen tool. They have not been resampled or edited offline. Cropping, tinting and progressively filtered downscaling happen at render time. The source selections, prompts, cleanup instructions and final file hashes live in each package's `provenance` field.

The procedural layout engine is shared application code. A package declares its engine version and recipe; the package never includes executable code. The renderer rebuilds frame lines at each size while placing the package's own artwork.

Export a self-contained `.niimborder` file with Node 22.6+:

```sh
node --experimental-strip-types scripts/export-border.mjs olive /tmp/olive.niimborder
```

This file contains the manifest plus all original PNGs as embedded data URIs. `src/utils/border_package.ts` provides creation, serialization, import parsing and validation. Import/export UI and a persistent custom-border library are separate follow-up features; the package format and renderer already support loading a validated package independently.
