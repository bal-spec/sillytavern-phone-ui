# Phone UI Extension for SillyTavern

![screenshot](https://github.com/user-attachments/assets/8274c5c5-552a-43eb-8a5c-7f983658ae0f)

A SillyTavern extension that adds interactive phone media to text message / IM conversations. When a character sends a message through a phone-styled UI (via the Visual Toolkit), this extension:

- Generates images from `[IMG]` tags using your configured image generation backend
- Provides an image carousel with left/right navigation and on-demand variant generation
- Turns `[VN]` voice note tags into interactive players with waveform animation and TTS playback
- Works with Zorgonatis/Stabs-EDH preset https://github.com/Zorgonatis/Stabs-EDH

## Requirements

- SillyTavern 1.12+
- **Visual Toolkit** directive enabled in your preset (generates the phone/IM HTML)
- **Image generation** (SD, DALL-E, etc.) configured with the `/imagine` slash command available
- **TTS extension** configured with a voice map entry for your character (for voice notes)

Note that I have tested with GLM 4.7 Thinking and GLM 5 Thinking via nano-gpt.com for chat and image gen and Azure TTS. This was generated with Claude Code and I include the `PLAN.md` file for the recipe.

## Installation

### 1. Install the extension

Copy the `phone-ui` folder into your SillyTavern extensions directory:

```
SillyTavern/public/scripts/extensions/third-party/phone-ui/
```

The folder should contain:
```
phone-ui/
  index.js
  style.css
  manifest.json
  phone-ui-preset-items.json
```

Restart SillyTavern after copying.

### 2. Add preset items

The extension requires prompt directives and regex scripts in your preset to instruct the LLM how to format its output. You have two options:

#### Option A: Use a preset that already includes them

The directives have been merged into `Modified-Stabs-GLM5-Directives-v2.2-phone-ui.json`. Import that preset and the extension will work out of the box.

#### Option B: Add items to your existing preset manually

Open `phone-ui-preset-items.json` for reference. You need to add the following to your preset JSON:

**Prompts** (add to the `prompts` array):

1. **Text Message Photos** — Instructs the LLM to output `[IMG]...[/IMG]` prompts and `data-phone-img` placeholder divs inside phone bubble HTML. Set `enabled: true` to activate.
2. **Text Message Voice Notes** — Instructs the LLM to output `[VN]...[/VN]` speech text and `data-phone-vn` placeholder divs. Set `enabled: true` to activate.

**Prompt order** (add to the `prompt_order` array for character_id `100001`):

Add entries for both directive identifiers so they appear in the prompt. Place them near your other custom directives:

```json
{ "identifier": "1e256e6e-a3b6-4af8-9afd-6d2fd4055662", "enabled": true },
{ "identifier": "b163bc38-9f55-42dd-8108-5958484dc4c2", "enabled": true }
```

**Regex scripts** (add to `replacement_macros.regex_scripts`):

1. **Strip IMG Tags from Context** — Removes `[IMG]...[/IMG]` from the prompt sent to the LLM so previously processed tags don't re-enter the conversation.
2. **Strip VN Tags from Context** — Same for `[VN]...[/VN]` tags.

Both scripts should have `promptOnly: true` and `placement: [2]`.

### 3. Add the no-quotes prohibition (recommended)

In your preset's **Visual Toolkit** directive, add this line to the Prohibitions section:

```
- Do not wrap text message bubble content in quotation marks — the bubble itself indicates dialogue.
```

This prevents the LLM from wrapping text bubble content in double quotes, which looks redundant inside styled message bubbles.

## How It Works

When a character message is rendered:

1. The extension scans `message.mes` for `[IMG]` and `[VN]` tags
2. It strips those tags from the rendered DOM (using the Range API to handle cross-node spans)
3. For each `[VN]` tag, it finds the matching `data-phone-vn` placeholder in the phone UI HTML and replaces it with an interactive waveform player
4. For each `[IMG]` tag, it finds the matching `data-phone-img` placeholder, shows a loading spinner, calls `/imagine` with the prompt, and inserts the result with carousel controls
5. Media URLs and metadata are saved to `message.extra.phoneMedia` in the chat file
6. On page reload, saved media is restored into placeholders without re-generating

## Image Carousel

Each generated image shows left/right arrow navigation on hover:

- **Left arrow**: Browse to the previous image variant (hidden on first image)
- **Right arrow on existing images**: Browse to the next variant
- **Right arrow on the last image**: Generates a new variant using the same prompt
- **Counter pill**: Shows position (e.g. "2/4") on hover

All variants are saved to the chat and persist across reloads.

## Voice Notes

The voice note player shows a play button with animated waveform bars:

- Clicking play sends the voice note text to `/speak` using the current character's TTS voice
- Non-verbal expressions in italics (`*laughs*`, `_sighs_`) are stripped before TTS
- The waveform animation stays active until audio playback finishes (synced via the `#tts_audio` element)

## Troubleshooting

**Images aren't generating**: Make sure your image generation backend is configured and the `/imagine` slash command works. Test with `/imagine a cat` in the chat input.

**Voice notes don't play audio**: Check that TTS is enabled and your character has a voice assigned in the TTS voice map. Test with `/speak Hello` in the chat input.

**Voice notes use the wrong voice**: The extension uses the character name (`name2`) to look up the voice. Make sure your TTS voice map has an entry matching the character's display name.

**`[IMG]` or `[VN]` tags visible in messages**: The Strip IMG/VN Tags regex scripts may be missing or disabled. Check your preset's regex scripts section.

**Player appears at bottom of message instead of inside phone bubble**: The LLM didn't generate the `data-phone-img` / `data-phone-vn` placeholder div, so the extension falls back to appending. This usually means the Photos or Voice Notes directive isn't enabled or the LLM isn't following the placeholder format. Try swiping for a new response.

**Double quotes around text in phone bubbles**: Add the no-quotes prohibition to the Visual Toolkit directive (see step 3 of installation).
