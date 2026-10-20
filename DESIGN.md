---
name: Spotify Subgenre Assistant
description: A record shop crate for filing songs behind the right genre divider.
colors:
  stained-wood: "#1a1613"
  wood-side: "#1e1916"
  wood-panel: "#241e1a"
  wood-raised: "#2f2722"
  wood-line: "#3b322b"
  wood-line-strong: "#4a3f36"
  sleeve-ink: "#f1e9dd"
  sleeve-ink-soft: "#e2d8ca"
  sleeve-muted: "#b9ad9c"
  sleeve-faint: "#a39684"
  oxblood-band: "#5e1a24"
  oxblood-ground: "#2c0c12"
  oxblood-panel: "#43141c"
  oxblood-raised: "#74303b"
  band-muted: "#e8cdd0"
  danger: "#f0b2a4"
  ok: "#86d4a0"
  warn: "#f5a442"
  paper-ground: "#f3ede3"
  paper-side: "#eee6da"
  paper-panel: "#fbf8f2"
  paper-raised: "#e4dacb"
  paper-line: "#d8cdbd"
  paper-line-strong: "#bfb2a0"
  wood-ink: "#241c16"
  wood-ink-soft: "#3a2f26"
  wood-muted: "#66594b"
  wood-faint: "#6f6254"
  danger-light: "#9e3424"
  ok-light: "#2b7a47"
  warn-light: "#a85400"
  fam-house: "#5db8b0"
  fam-bass: "#9a8bea"
  fam-rock: "#e58a76"
  fam-pop: "#e2b547"
  fam-hiphop: "#78ade6"
  fam-roots: "#a7c47c"
  fam-none: "#8f857a"
  fam-house-mark-light: "#23857d"
  fam-bass-mark-light: "#6a5ad0"
  fam-rock-mark-light: "#c4553f"
  fam-pop-mark-light: "#a87c12"
  fam-hiphop-mark-light: "#3170b8"
  fam-roots-mark-light: "#5e7f33"
  fam-none-mark-light: "#7a6f63"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.25
    fontVariation: "'wdth' 80"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.4
    fontVariation: "'wdth' 80"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.5
    fontVariation: "'wdth' 80"
  summary:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "'tnum'"
  body-dense:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
  meta:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.33
    fontFeature: "'tnum'"
  divider-tab:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.33
    fontVariation: "'wdth' 80"
rounded:
  sm: "4px"
  tab: "5px"
  md: "6px"
  dialog: "8px"
  card: "10px"
  sheet: "12px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "14px"
  xl: "20px"
  xxl: "24px"
components:
  button-file:
    backgroundColor: "{colors.sleeve-ink}"
    textColor: "{colors.stained-wood}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "28px"
    width: "72px"
  button-file-hover:
    backgroundColor: "{colors.sleeve-ink-soft}"
  button-file-compact:
    backgroundColor: "transparent"
    textColor: "{colors.sleeve-ink}"
    rounded: "{rounded.md}"
    height: "24px"
    width: "68px"
  button-file-compact-hover:
    backgroundColor: "{colors.sleeve-ink}"
    textColor: "{colors.stained-wood}"
  button-filed:
    backgroundColor: "transparent"
    textColor: "{colors.sleeve-muted}"
    rounded: "{rounded.md}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.sleeve-ink}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-outline-hover:
    backgroundColor: "{colors.wood-raised}"
  button-play:
    backgroundColor: "{colors.sleeve-ink}"
    textColor: "{colors.stained-wood}"
    rounded: "{rounded.full}"
    size: "44px"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.band-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  nav-tab-active:
    backgroundColor: "{colors.oxblood-raised}"
    textColor: "{colors.sleeve-ink}"
  input-search:
    backgroundColor: "{colors.stained-wood}"
    textColor: "{colors.sleeve-ink}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  chip-tag:
    backgroundColor: "{colors.wood-raised}"
    textColor: "{colors.sleeve-ink}"
    rounded: "{rounded.full}"
    padding: "2px 4px 2px 8px"
  divider-tab:
    backgroundColor: "{colors.fam-house}"
    textColor: "{colors.stained-wood}"
    typography: "{typography.divider-tab}"
    rounded: "{rounded.tab}"
    padding: "2px 10px 1px"
  divider-card:
    backgroundColor: "{colors.wood-panel}"
    textColor: "{colors.sleeve-ink-soft}"
    rounded: "{rounded.md}"
    padding: "6px 4px 6px 6px"
  divider-card-filed:
    backgroundColor: "{colors.wood-raised}"
  playlist-row:
    backgroundColor: "transparent"
    textColor: "{colors.sleeve-ink}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.md}"
    height: "36px"
  playlist-row-hover:
    backgroundColor: "{colors.wood-panel}"
  summary-card:
    backgroundColor: "{colors.wood-panel}"
    textColor: "{colors.sleeve-ink}"
    rounded: "{rounded.card}"
    padding: "16px 20px"
  confidence-bar:
    backgroundColor: "{colors.wood-line}"
    rounded: "{rounded.full}"
    height: "4px"
---

# Design System: Spotify Subgenre Assistant

## Overview

**Creative North Star: "The Record Shop at Closing Time"**

Filing a song should feel like dropping a record behind the right divider. The ground is stained wood, the text is sleeve paper, and the shell is an oxblood band across the top, the shop's painted fascia. Genre lives on card-stock dividers in six printed family colours, and nowhere else. It is a working tool for a listener with a pile to get through, so the room is dense, quiet and warm, and the colour is reserved for the one thing the listener is deciding: where this record goes.

Dark is the default and the system's home. Light mode is the same shop in daylight: sleeve-paper ground, wood-ink text, the same oxblood band unchanged. The theme follows the operating system unless Settings pins it, and it is set before first paint so the shop never flashes the wrong lighting.

The world refuses the streaming-app default of near-black panels with one green accent, and the grey SaaS dashboard. Its warmth comes from the brown-shifted neutrals and the oxblood, never from gradients or glow.

**Key Characteristics:**
- Warm brown neutrals in both themes; no pure black, white or grey.
- One oxblood band carries navigation, the source picker and dialog headers.
- Six genre-family colours, used only as divider tabs, tag dots and confidence bars.
- Archivo throughout, with its width axis narrowed to 80% for titles and divider tabs.
- Committing actions (filing, Play, a dialog's submit) are sleeve-ink-filled; everything else is outlined or quiet text.
- Flat, tonal depth; the only motion is a record settling into the bin.

## Colors

A stained-wood room lit warm, with an oxblood fascia and a rack of printed card-stock dividers.

### Primary
- **Oxblood Band** (oxblood-band): the shell band behind the tool tabs, library status and source-playlist picker, the header strip of the Settings sheet, the rate-limit notice bar, text selection, and checkbox accents. Identical in both themes. Inside the band the neutrals are redefined to an oxblood family (oxblood-ground, oxblood-panel, oxblood-raised, band-muted) so tabs, buttons and menus there take band colours without per-element overrides.

### Secondary
- **Genre Family Card Stock** (fam-house teal, fam-bass violet, fam-rock coral, fam-pop mustard, fam-hiphop blue, fam-roots sage, fam-none taupe): the divider colours. Each has a tab value (the card stock itself, same in both themes, always carrying dark wood text) and a mark value (dots and confidence bars). In dark mode the mark equals the tab; in light mode the mark darkens (the `-mark-light` tokens) so it holds contrast on paper.

### Neutral
- **Stained Wood / Paper Ground** (stained-wood / paper-ground): the app ground and the inset fill of inputs.
- **Side / Panel / Raised** (wood-side, wood-panel, wood-raised and their paper counterparts): three tonal steps. Side columns sit on side; cards and divider bodies on panel; the selected song, a filed divider and tag chips on raised.
- **Line / Line Strong**: hairline dividers between columns and outlines on secondary buttons and inputs.
- **Sleeve Ink / Wood Ink** (sleeve-ink / wood-ink): primary text, and the inverted fill of committing actions (Add, Play, a dialog's submit). This is the system's action colour; there is no separate bright accent.
- **Ink Soft, Muted, Faint**: secondary text, metadata and placeholders, in that order of emphasis.
- **Status** (danger, ok, warn and their `-light` versions): errors and the remove action; warn also marks a starred playlist and the "leaving source playlist" note. Status hues are kept clear of the six genre-family hues (warn is orange, ok a cool green), so a status never reads as a genre.

### Named Rules
**The Card Stock Rule.** Genre colour lives only on divider tabs, tag dots, a divider's top edge and confidence bars (and the brief filing flash). Never on buttons, backgrounds, headings or chrome.

**The One Band Rule.** Oxblood is the shell, not an accent. It appears as the full-width band and its strips; it never becomes a button fill or a highlight inside the wood.

**The Same Shop Rule.** Light mode changes the lighting, not the shop: the band, the card-stock tabs and the dark text on them stay identical; only neutrals, status colours and family marks shift.

## Typography

**Display Font:** Archivo (with system-ui, sans-serif), loaded as a variable font with the `wdth` axis.

**Character:** One grotesque in two widths. Narrow (80% width) bold for anything that names a place or a record, like a shop's hand-set labels; normal width for everything you read or press. Tabular figures are on globally so percentages, counts and times line up.

### Hierarchy
- **Display** (narrow, 700, 36px, 1.25): the playing song's title under the cover. One per screen.
- **Headline** (narrow, 700, 20px): the Settings sheet title in its band strip.
- **Title** (narrow, 700, 16px): panel headings: "Source playlist", "File it under", "Playlist".
- **Summary** (600, 15px): the AI's mood line atop the summary card; Settings section legends use the same size at 700.
- **Body** (400, 14px): song rows, nav tabs, list text. Dense body (13px) for buttons, playlist rows, search fields and tag names (tags at 600).
- **Label** (600, 12px, sentence case): group labels like "Starred" and "All playlists", in muted.
- **Meta** (500, 11.5px, tabular): percentages, song counts, "yours" and "unscored".
- **Divider Tab** (narrow, 700, 12px): the playlist name printed on a divider tab.

### Named Rules
**The Narrow Label Rule.** The narrow width is for names of places and records (panel titles, the song title, divider tabs). Body copy, buttons and numbers stay at normal width.

## Layout

A fixed desktop workbench. The sorter is three columns under the band: source playlist (280px), the now-playing centre (flexible), and "File it under" (340px), each scrolling independently inside a full-height screen. My library is two columns (300px list, flexible table). Columns are separated by hairlines, and the side columns sit one tonal step off the ground. The layout stays three-column down to 1024px; there is no mobile treatment.

Spacing runs tight: 14px panel insets, 6 to 8px gaps inside rows, 2 to 6px between stacked rows, 20px card padding. The centre column is centred on a 576px measure (cover, title, transport, summary card) so the eye returns to the same place for each song. Starred dividers stack 6px apart; the dense list below them uses 36px rows.

**The Place-Keeping Rule.** Nothing the listener does reflows the lists they are working through: starring keeps the scroll position, tabs stay mounted when hidden, and filing changes a row's state in place.

## Elevation & Depth

Flat and tonal. Depth comes from the ground, side, panel and raised steps and from hairlines, not from shadows. Shadows appear only where something truly floats above the room: the album cover (a soft cast shadow), the Settings sheet, and the playlist-picker menu. Modals dim the room with a 60% black backdrop.

### Shadow Vocabulary
- **Cover cast** (`0 14px 30px rgba(0,0,0,0.35)`): the now-playing album cover only.
- **Sheet** (`0 24px 60px rgba(0,0,0,0.45)`): the Settings sheet.
- **Menu**: a large soft shadow under dropdown menus that overlay the band.

### Named Rules
**The Flat Wood Rule.** Surfaces in the room are flat at rest and on hover; a state change is a tonal step (panel to raised), never a lift.

## Shapes

Small, worn corners. Buttons, inputs, rows and divider bodies use a 6px radius; thumbnails and small badges 4px; the summary card 10px; dialogs 8px and the Settings sheet 12px. Pills (full radius) are reserved for round things: tag chips, the play and transport buttons, dots and confidence bars. Divider tabs are rounded only on their top corners (5px) and sit flush on a 2px top edge of the same colour, so tab and card read as one piece of card stock.

## Components

### Buttons
- **Filing action (Add):** sleeve-ink fill with wood text, 6px radius, fixed 72px width so a column of them aligns. Hover softens to ink-soft. The same ink fill marks every committing action, one per context: Add to playlist in My library, Play, chat Send, and a dialog's submit.
- **Compact filing action:** in the dense list, the same Add is outlined (line-strong) and fills with ink on hover.
- **Filed state:** once added, the button becomes an outlined check "Added" in muted; hover turns it to "Remove" in danger.
- **Outline:** toolbar actions (New playlist, Setups, Playlist genres) are line-strong outlines with 13px medium text; hover raises the fill and brightens the edge. The destructive "Remove from source" uses a half-strength danger outline and danger text.
- **Quiet text:** Edit tags, Regenerate, Clear stars, Cancel: muted text that goes to ink (or danger) on hover.
- **Transport:** a 44px ink-filled round play button flanked by 36px ghost round previous/next.

### Chips
- **Tag chip (editing):** raised fill, ink text, full radius, with a muted close icon that gains a line fill on hover.
- **Playlist chip (My library):** full-radius line outline with a close icon.

### Cards / Containers
- **Summary card:** panel fill, 10px radius, 16px by 20px padding, no border or shadow; holds the audio-feature tiles (raised, 6px radius), the tags and the chat.
- **Settings sections:** line-outlined fieldsets with a bold legend, two per row in a 12px sheet with an oxblood header strip.

### Inputs / Fields
- **Style:** ground-filled (one step darker than the panel around it), 1px line or line-strong edge, 6px radius, 13px text, faint placeholder.
- **Focus:** the edge brightens to ink-soft; keyboard focus everywhere else is a 2px ink outline offset 2px.
- **Checkboxes** take the oxblood accent; range sliders take the ink accent.

### Navigation
- **Tool tabs:** in the band, 14px medium text, 6px radius. Inactive in band-muted; hover and the current tab fill with oxblood-raised and go to sleeve ink. Settings sits beside them as a tab-styled button, followed by the library status in 12px muted.

### Crate Divider (signature)
A starred playlist is a divider in the bin. Its tab carries the playlist name in narrow bold on its family's card stock, offset from the left in a staggered sequence (0, 48, 96, 24, 72px) like dividers in a real crate. Beneath, a panel-filled card with a 2px family-coloured top edge holds the cover (32px), the playlist's top genres, a song count, Add, expand and a mustard star. Once the song is filed the card steps to raised. Below the dividers, every other playlist is a dense 36px row: star, 26px thumb, an 8px family dot, name, count, compact Add, expand.

### Confidence Meter (signature)
How sure the AI is, drawn as an exact-length 4px bar on a line-coloured track, in the tag's family mark, and/or a meta-size percentage; the listener picks bars, percentage or both in Settings (with bars only, the number stays for screen readers). A weak guess (under 45%) draws the bar at 60% opacity and gives the tag name a dashed underline in its family mark. Tags the listener added say "yours" instead of a score.

### File Drop
Filing a song makes the divider or row drop 3px into place over 200ms (`cubic-bezier(0.16, 1, 0.3, 1)`) while flashing a 24% wash of its family colour. It is the system's only motion and is skipped entirely under reduced motion.

## Do's and Don'ts

### Do:
- **Do** put a new genre-coloured element only on a tab, dot, divider edge or confidence bar, using the family tab value for card stock and the mark value for dots and bars.
- **Do** keep dark wood text (stained-wood) on card-stock tabs in both themes.
- **Do** use the token neutrals for every surface, so the oxblood band's redefinition carries into anything placed inside it.
- **Do** set panel titles and record names in narrow bold Archivo; everything else at normal width.
- **Do** give the one committing action per row, bar or dialog the ink fill, and keep other buttons outlined or quiet.
- **Do** draw icons as single-weight (2px) round-capped strokes in currentColor, 13 to 18px.
- **Do** state depth with the side, panel and raised steps before reaching for a shadow.

### Don't:
- **Don't** use near-black panels with one green accent, or cool grey dashboard neutrals.
- **Don't** use genre colour on buttons, backgrounds, headings or chrome.
- **Don't** use oxblood as a button fill or highlight inside the wood; it is the band.
- **Don't** change the band or the card-stock tab colours between themes.
- **Don't** add motion beyond the file drop, and never without the reduced-motion guard.
- **Don't** lift surfaces on hover with shadows.
