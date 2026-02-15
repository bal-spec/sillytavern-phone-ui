# Changelog

## 1.2.1

### Security

- **Sanitize slash command arguments**: Image prompts and voice note text passed to `/imagine` and `/speak` are now sanitized to prevent pipe `|` characters from being interpreted as command chaining by SillyTavern's slash command parser.
- **Escape voice name in `/speak`**: Strip double quotes from the character name to prevent quote breakout in the voice parameter.
- **Escape image URL in HTML**: Image `src` attributes are now HTML-escaped to prevent attribute injection from crafted URLs in stored chat data.

## 1.2.0

### Bug Fixes

- **Fix duplicate VN player rendering**: When the LLM's inline placeholder HTML didn't match what `findPlaceholder` expected, the extension would append a working player at the bottom while the static placeholder remained visible. Now uses a multi-tier fallback (saved ref → broadened search → VN position marker → append) and cleans up orphan placeholders after insertion.

### Known Issues

- **Restore on page reload fails silently**: `CHARACTER_MESSAGE_RENDERED` does not fire for existing messages when a chat is loaded after a page reload. The image and VN player are not restored until `/phone-ui` is run manually. This is a SillyTavern event issue, not a phone-ui bug — the extension correctly handles the restore when the event does fire.

## 1.1.0

### New Features

- **Image prompt editor**: Pencil edit button overlaid on images (appears on hover) opens an inline editor to modify the prompt. "Save" updates the prompt; "Save & Generate" regenerates the image with the new prompt.
- **Voice notes**: `[VN]...[/VN]` tags are replaced with interactive waveform players that play back via TTS using the character's voice. Includes an edit button to modify the speech text and re-play.
- **`/phone-ui` slash command**: Manually re-process all character messages when the extension fails to trigger automatically.
- **Spinner overlay**: A spinning indicator is shown on the dimmed image during variant generation (carousel right arrow and Save & Generate).
- **Voice note loading state**: Play button shows a spinner while TTS is rendering.
- **Duration estimate**: Voice note player displays an estimated duration based on word count.

### Improvements

- Updated installation docs with SillyTavern UI install method (paste repo URL).
- Added troubleshooting entry for manually re-triggering the extension.

## 1.0.0

- Initial release
- Image generation from `[IMG]` tags with carousel navigation and variant generation
- Media persistence in chat history via `message.extra.phoneMedia`
- Restore on reload without re-generating
