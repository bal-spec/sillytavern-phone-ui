# Phone UI Extension — Architecture & Implementation Plan

## Overview

The Phone UI extension intercepts AI character messages that contain `[IMG]...[/IMG]` and `[VN]...[/VN]` tags, replaces inline placeholders with interactive widgets (generated images with carousel, voice note players with TTS), and persists the results in the chat history for restore on reload.

It depends on the LLM being instructed (via preset directives) to:
1. Output phone/IM-styled HTML using the **Visual Toolkit**
2. Include `data-phone-img` / `data-phone-vn` placeholder divs inside the HTML
3. Output `[IMG]prompt[/IMG]` and `[VN]speech text[/VN]` tags outside the HTML

## Files

```
phone-ui/
  index.js                    — Extension logic (510 lines)
  style.css                   — Image carousel + voice note player styles
  manifest.json               — SillyTavern extension manifest
  phone-ui-preset-items.json  — Standalone preset items for any preset
  PLAN.md                     — This file
```

## Prerequisites

- **Visual Toolkit** directive enabled in your preset (generates phone/IM HTML)
- **Text Message Photos** directive (instructs LLM to use `[IMG]` tags + `data-phone-img` placeholders)
- **Text Message Voice Notes** directive (instructs LLM to use `[VN]` tags + `data-phone-vn` placeholders)
- **Strip IMG/VN Tags from Context** regex scripts (prevent processed tags from re-entering the prompt)
- **SD/image generation** extension with `/imagine` slash command configured
- **TTS extension** with voice map configured (for voice notes)

All preset items are available in `phone-ui-preset-items.json` and have been merged into `Stabs-GLM5-Directives-v2.2.json`.

## Data Model

Generated media is persisted in `message.extra.phoneMedia`:

```
phoneMedia = {
  0:    { urls: [url1, url2, ...], type: 'image', prompt: '...', activeIndex: 0 },
  1:    { urls: [url1],            type: 'image', prompt: '...', activeIndex: 0 },
  vn0:  { type: 'voice_note', text: '...' },
}
```

- **Image keys** are numeric (`0`, `1`, ...) matching the order of `[IMG]` tags
- **Voice note keys** are prefixed (`vn0`, `vn1`, ...) matching the order of `[VN]` tags
- **Legacy format** (`{ url, type, prompt }` without `urls` array) is auto-migrated on interaction

## Processing Flow

### First Generation (message has `[IMG]`/`[VN]` tags)

```
CHARACTER_MESSAGE_RENDERED fires
  |
  ├─ Extract all [IMG] and [VN] matches from message.mes
  ├─ Strip tags from message.mes (regex replace)
  ├─ Strip tags from rendered DOM (Range API — before placeholder replacement)
  |
  ├─ For each [VN] match:
  |   ├─ Find placeholder div (data-phone-vn="N" or fallback by content)
  |   ├─ Replace with interactive waveform player
  |   └─ Bind click handler → /speak voice="CharName" (cleaned text)
  |
  ├─ For each [IMG] match:
  |   ├─ Find placeholder div (data-phone-img="N" or fallback by content)
  |   ├─ Show loading spinner
  |   ├─ Call /imagine quiet=true {prompt}
  |   └─ Replace spinner with image + carousel controls
  |
  ├─ Bind carousel navigation handlers
  └─ Save chat
```

### Restore (page reload — tags already stripped, phoneMedia exists)

```
CHARACTER_MESSAGE_RENDERED fires
  |
  ├─ Detect: no [IMG]/[VN] tags in mes, but phoneMedia exists
  |
  ├─ For each phoneMedia entry:
  |   ├─ Image → find placeholder, insert image at urls[activeIndex]
  |   └─ Voice note → find placeholder, insert player, bind TTS handler
  |
  └─ Bind carousel handlers
```

## Key Implementation Details

### DOM Tag Stripping (`stripTagsFromDOM`)

The `[VN]...[/VN]` content spans multiple DOM nodes (broken by `<br>`, `<em>`, etc.), so per-text-node regex cannot match. The solution uses the **Range API**:

1. Walk all text nodes with `TreeWalker`
2. Find text node containing `[VN]` (open) and `[/VN]` (close)
3. Create a `Range` spanning open to close
4. Call `range.deleteContents()` to remove the entire span

**Critical ordering**: Stripping runs BEFORE placeholder replacement. If it ran after, the Range could delete the newly-inserted player widget when the `[VN]` content encompasses the placeholder's DOM position.

### Image Carousel (`bindCarouselHandlers`)

Replaces the old single-regenerate button with left/right navigation:

- **Left arrow** (`<`): Decrement `activeIndex`, swap `img.src`, update counter. Hidden on first image.
- **Right arrow on non-last image** (`>`): Increment `activeIndex`, swap `img.src`.
- **Right arrow on last image**: Calls `/imagine` to generate a new variant, appends URL to `urls[]`, increments index, saves chat.
- **Counter pill** (`1/3`): Shows on hover, hidden when only one image.
- Arrows and counter appear on hover via CSS opacity transition.

### Voice Note TTS (`bindVoiceNotePlayer`)

- Uses `/speak voice="CharName"` to play with the character's mapped TTS voice (via `name2` import)
- **Text cleaning** (`cleanVnTextForTts`): Strips `*italicized*` and `_italicized_` content before TTS — these represent non-verbal expressions (laughs, sighs, etc.) that shouldn't be spoken
- **Waveform sync** (`waitForTtsPlayback`): The `/speak` command resolves when the TTS job is queued, not when audio finishes. The extension listens for the `#tts_audio` element's `play` and `ended` events to keep the waveform animation running through actual playback. A 15-second safety timeout prevents infinite waiting.

### Placeholder Discovery (`findPlaceholder`)

Two-tier lookup:
1. **Data attribute**: `mesText.find('[data-phone-img="0"]')` — reliable when the LLM follows the directive
2. **Content fallback**: Find Nth `<div>` containing the expected emoji (`📸` for images, `▶` for voice notes) that doesn't already contain phone-ui widgets

### Deduplication (`processedMessages`)

A `Set<messageId>` prevents re-processing on re-renders. Cleared on `CHAT_CHANGED`, individual entries removed on `MESSAGE_SWIPED`.

## Preset Directive Design

### Visual Toolkit Prohibition

Added to the Visual Toolkit's Prohibitions list:
```
- Do not wrap text message bubble content in quotation marks — the bubble itself indicates dialogue.
```
This prevents the LLM from adding double quotes inside text message bubbles, where the bubble styling already implies dialogue.

### Text Message Photos Directive

Instructs the LLM to:
- Generate `data-phone-img="N"` placeholder divs inside phone bubble HTML
- Output `[IMG]...[/IMG]` prompts (100-150 words) describing smartphone-style photos
- Use casual photography style, reference character appearance traits
- Not use "photorealistic"/"realistic", not generate for `{{user}}`

### Text Message Voice Notes Directive

Instructs the LLM to:
- Generate `data-phone-vn="N"` placeholder divs inside phone bubble HTML
- Output `[VN]...[/VN]` speech content written naturally for TTS
- Trigger organically (emotional, multitasking, intimacy contexts)
- Use `*asterisk*` notation for paralinguistic expressions
- Not use both photo and voice note in the same message unless appropriate

### Regex Scripts

Two `promptOnly` regex scripts strip processed `[IMG]` and `[VN]` tags from the prompt context (placement 2), preventing old tags from re-entering conversations and confusing the LLM. They run at all depths (minDepth: 0).
