# Build 002 — desktop publishing workspace

The main screen is one publishing desk: book selection/New Book, reviewed batch artwork, manuscript import, a page grid, selected-page preview, right-side inspector, automatic save, compact advisories and Create/Refine/Open in Canva controls. Existing library, assets, template, publishing-history and settings capabilities remain in the secondary Workspace tools menu.

Artwork assignments reserve explicit page numbers first. Unnumbered files use natural sorting; duplicate/out-of-range numbers require review rather than arbitrary assignment. The preview allows per-file reassignment or skipping. Folder selection supports replacing a book's artwork in a batch; old immutable files and version references remain intact.

Manuscript import accepts TXT and Markdown. Explicit `Page N` / Markdown `# Page N` sections map to those pages and preserve unspecified pages. Explicit separators and paragraph-based proposals remain available. Every import is reviewed before applying. Empty text stays advisory.

The editor inspects a missing/stale template dataset once per source selection when Canva is connected, and the existing template tool provides manual refresh. The default source is remembered for new books. The protected master remains the only creation source; revisions require a verified generated target and a current affected-field review.

Desktop Chrome testing covers 1920×1080 and 2560×1440. The complete suite has 19 tests, including batch upload/assignment, numbered Markdown, save/reload, explicit draft selection and affected-field review, startup recovery, existing book/asset operations and secondary tools. No mobile/tablet work was required. Screenshots are ignored under `.local/build002-workspace-1920.png` and `.local/build002-workspace-2560.png`.

The new Chrome regression caught an asynchronous dropdown bug: rerendering reset the controlled select before its value was read after awaiting ownership verification. Capturing the chosen design ID before awaiting fixes that failure. No real Canva design was created or updated by the automated tests.
