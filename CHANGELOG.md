# 2026.10.0

* Add token-based multi-user storage isolation, per-user recovery scope and migration of existing labels to the default user.

* Add selectable browser or self-hosted SQLite label storage, connection settings and cross-device conflict protection; allow HTTP storage on private IPv4 LAN addresses.
* Add Docker Compose deployment for shared storage with a persistent SQLite volume, authenticated health checks and LAN connection instructions.

* Fix iOS Bluetooth connections to B1 with BeaCIO by preferring supported writes with response, unfiltered scanning and the printer data channel; handle replies arriving before write completion.
* Fix B1 CSV batch printing compatibility by using separate sessions per page; add a batch printing mode selector.
* Fix Arabic RTL text cursor and selection
* Parse nested variables (example: `{dt+{var}d}`).
* Auto use `D110M_V4` print task for `protocolVersion 4+` printers.
* Standardize template and saved label JSON import/export.
* Add character spacing field.
* Add preset print offset and replace support.
* Move label delete and export buttons to popup on mobile.
* Most of the dropdowns are modal dialogs now.
* Custom input dialog when editing text.
* Warn on tab close with unsaved changes.
* Do not show warning when loading label if no unsaved changes.
* Fix size inputs resetting on every keystroke.
* Apply position and size inputs live.


# 2026.9.0

* Add changelog (starts from commit 48ce74).
* Add dual color printing support:
  - Add red color to vector objects.
  - Add red/black threshold post-processing.
* Use single PrintStart/PrintEnd session for multi-page printing.
* Fix print progress calculation.
* Display more characteristics at the printer info menu.
* Fix status poll not stopped sometimes.
* Fix version detection for non-very-old printer models.
* Fail on connecting to a non-printer port.
* Add send progress (on printing).
* Printer menu rework:
  - Strings are i18n now.
  - Menu now display most important things.
  - Details moved to separate menu.
  - RFID usage progress bars.
  - RFID paper type and dimensions (for modern printers).
  - Sound settings sliders.
* Add datetime duration parsing (example: `{dt+3d}`, `{dt-3h}`, `{dt+1w|YYYY-MM-DD}`).
