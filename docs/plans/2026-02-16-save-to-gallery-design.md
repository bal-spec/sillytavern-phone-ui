# Save-to-Gallery Button

Per-image button to optionally save Phone UI generated images to the character gallery.

## Context

Phone UI generates images with `gallery=false` so they don't clutter the character gallery by default. Users want the ability to selectively save specific images they like.

## Design

### Button

- Download/save icon in the **top-right corner** of the image container
- Same visual treatment as existing overlay buttons: 28px circle, `rgba(0,0,0,0.6)` background, appears on hover, `z-index: 2`
- Positioned at `top: 8px; right: 6px`

### States

1. **Default**: Save icon, appears on hover
2. **Saving**: Brief spinner while fetch+upload runs
3. **Success**: Checkmark flash for ~1.5s, then transitions to "already saved" state
4. **Already saved**: Permanent checkmark, dimmed, disabled (not clickable)
5. **Error**: Brief red flash, reverts to default (allows retry)

### Persistence

- `savedToGallery: true` flag added to the media object in `message.extra.phoneMedia[index]`
- Persists across reloads since phoneMedia is saved in chat data
- On restore, button renders directly in "already saved" state

### Save mechanism

1. Fetch image from its existing server URL
2. Convert response blob to base64
3. POST to `/api/images/upload` with `{ image: base64, format: <ext>, ch_name: name2 }`
4. Uses `getRequestHeaders()` from SillyTavern for auth

### Files changed

- `index.js` -- add button HTML to `buildImageContainer()`, add `saveToGallery()` helper, bind click handler in `bindCarouselHandlers()`
- `style.css` -- add `.phone-img-save-btn` styles (top-right overlay button, disabled/saved state)

### Edge cases

- Carousel navigation: save state is per-URL, tracked on the media object which has `urls[]` array. The `savedToGallery` flag should be an array or set of indices that have been saved. When navigating, update button appearance based on whether the current `activeIndex` has been saved.
- Variant generation: new variants start unsaved.
