# Changelog

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
