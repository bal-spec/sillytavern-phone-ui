import { eventSource, event_types, chat, saveChatConditional, name2, getRequestHeaders } from '../../../../script.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

const MODULE_NAME = 'phone-ui';
const IMG_TAG_REGEX = /\[IMG\]\s*([\s\S]*?)\s*\[\/IMG\]/gi;
const VN_TAG_REGEX = /\[VN\]\s*([\s\S]*?)\s*\[\/VN\]/gi;
const STRIP_IMG_TAGS_REGEX = /\[IMG\][\s\S]*?\[\/IMG\]/gi; // used for message.mes stripping (VN tags kept for edit flow)

const BAR_HEIGHTS = [8, 14, 6, 18, 10, 16, 7, 12, 5, 15, 9, 13];

/** Lightbox singleton for full-size image viewing (uses <dialog> for top-layer rendering) */
let lightboxEl = null;

/**
 * Get or create the lightbox dialog element.
 * @returns {HTMLDialogElement}
 */
function getLightbox() {
    if (lightboxEl) return lightboxEl;

    lightboxEl = document.createElement('dialog');
    lightboxEl.className = 'phone-lightbox';

    const img = document.createElement('img');
    img.className = 'phone-lightbox-img';
    lightboxEl.appendChild(img);

    document.body.appendChild(lightboxEl);

    // Close on backdrop click
    lightboxEl.addEventListener('click', (e) => {
        if (e.target === lightboxEl) {
            lightboxEl.close();
        }
    });

    return lightboxEl;
}

/**
 * Open the lightbox with the given image URL.
 * @param {string} url
 */
function openLightbox(url) {
    const lb = getLightbox();
    lb.querySelector('.phone-lightbox-img').src = url;
    lb.showModal();
}

/** Track messages we've already processed */
const processedMessages = new Set();

/**
 * Build waveform bars HTML.
 * @returns {string}
 */
function buildWaveformBars() {
    return BAR_HEIGHTS.map(h =>
        `<span class="phone-vn-bar" style="height:${h}px;"></span>`,
    ).join('');
}

/**
 * Estimate TTS duration from text. Assumes ~150 words per minute.
 * @param {string} text
 * @returns {number} seconds (minimum 2)
 */
function estimateTtsDuration(text) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(2, Math.round(words / 2.5));
}

/**
 * Format seconds as m:ss.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Sanitize text for use in slash command arguments.
 * Strips pipe characters that could chain commands.
 * @param {string} text
 * @returns {string}
 */
function sanitizeForSlashCommand(text) {
    return text.replace(/\|/g, ',');
}

/**
 * Escape a string for safe use in an HTML attribute.
 * @param {string} str
 * @returns {string}
 */
function escapeHtmlAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Save an image to the character gallery by fetching it and re-uploading.
 * @param {string} imageUrl - The server-relative URL of the image (e.g. /user/images/foo.png)
 * @returns {Promise<void>}
 */
async function saveImageToGallery(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

    const blob = await response.blob();
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

    const ext = imageUrl.split('.').pop().split('?')[0] || 'png';
    const charName = name2 || '';

    const uploadResponse = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            image: base64,
            format: ext,
            ch_name: charName,
        }),
    });

    if (!uploadResponse.ok) {
        const err = await uploadResponse.json().catch(() => ({}));
        throw new Error(err.error || 'Gallery upload failed');
    }
}

/**
 * Find the Nth placeholder element in the rendered message by data attribute,
 * falling back to content-based matching.
 * @param {JQuery} mesText - The .mes_text element
 * @param {string} dataAttr - e.g. 'data-phone-img'
 * @param {number} index - The index to find
 * @param {string} fallbackContent - Content to search for (emoji)
 * @returns {JQuery|null}
 */
function findPlaceholder(mesText, dataAttr, index, fallbackContent) {
    const isVn = dataAttr === 'data-phone-vn';

    // Try exact data attribute match first
    const byAttr = mesText.find(`[${dataAttr}="${index}"]`);
    if (byAttr.length) return byAttr.first();

    if (isVn) {
        // Try any [data-phone-vn] attribute (LLM may use wrong index value)
        const anyVnAttr = mesText.find('[data-phone-vn]').not('.phone-vn-wrapper [data-phone-vn]');
        if (anyVnAttr.length) return anyVnAttr.eq(Math.min(index, anyVnAttr.length - 1));

        // Try DOMPurify-prefixed class (LLM mimicking extension HTML)
        const byCustomClass = mesText.find('[class*="custom-phone-vn"]').not('.phone-vn-wrapper [class*="custom-phone-vn"]');
        if (byCustomClass.length) return byCustomClass.eq(Math.min(index, byCustomClass.length - 1));
    }

    // Fallback: find by content — prefer innermost matching element for VN
    const candidates = [];
    mesText.find('div').each(function () {
        const el = $(this);
        if (el.closest('.phone-vn-wrapper, .phone-img-wrapper').length) return;
        const text = el.text();
        if (text.includes(fallbackContent) && !el.find('[class^="phone-"]').length) {
            if (isVn) {
                // Prefer innermost: skip if a child div also matches
                const childMatch = el.find('div').filter(function () {
                    return $(this).text().includes(fallbackContent);
                });
                if (childMatch.length) return;
            }
            candidates.push(el);
        }
    });

    if (isVn && !candidates.length) {
        // Also match elements containing "Voice note" text
        mesText.find('div').each(function () {
            const el = $(this);
            if (el.closest('.phone-vn-wrapper, .phone-img-wrapper').length) return;
            if (/voice\s*note/i.test(el.text()) && !el.find('[class^="phone-"]').length) {
                const childMatch = el.find('div').filter(function () {
                    return /voice\s*note/i.test($(this).text());
                });
                if (childMatch.length) return;
                candidates.push(el);
            }
        });
    }

    if (candidates[index]) return $(candidates[index]);

    return null;
}

/**
 * Restore a previously generated image into its placeholder.
 * @param {JQuery} mesText
 * @param {object} media - { urls, activeIndex, type, prompt } or legacy { url, type, prompt }
 * @param {number} index
 */
function restoreImage(mesText, media, index) {
    const placeholder = findPlaceholder(mesText, 'data-phone-img', index, '\uD83D\uDCF8');
    const urls = media.urls || [media.url];
    const activeIndex = media.activeIndex || 0;
    const currentUrl = urls[activeIndex] || urls[0];
    const savedIndices = media.savedToGallery || [];
    const container = buildImageContainer(currentUrl, media.prompt, urls.length, activeIndex, savedIndices);
    if (placeholder) {
        placeholder.replaceWith(container);
    } else {
        mesText.append(container);
    }
}

/**
 * Build the interactive image container HTML with carousel navigation.
 * @param {string} url
 * @param {string} prompt
 * @param {number} totalImages
 * @param {number} activeIndex
 * @param {number[]} savedIndices - Indices of variants already saved to gallery
 * @returns {string}
 */
function buildImageContainer(url, prompt, totalImages = 1, activeIndex = 0, savedIndices = []) {
    const escapedPrompt = $('<span>').text(prompt).html();
    const hideLeft = activeIndex === 0 ? ' style="display:none;"' : '';
    const counterText = totalImages > 1 ? `${activeIndex + 1}/${totalImages}` : '';
    const counterHidden = totalImages <= 1 ? ' style="display:none;"' : '';
    const isSaved = savedIndices.includes(activeIndex);
    const saveIcon = isSaved ? '&#10003;' : '&#8615;';
    const savedClass = isSaved ? ' saved' : '';
    return `<div class="phone-img-wrapper">
        <div class="phone-img-container">
            <img class="phone-img" src="${escapeHtmlAttr(url)}" alt="Generated image" />
            <button class="phone-img-nav phone-img-nav-left"${hideLeft} title="Previous">\u2039</button>
            <button class="phone-img-nav phone-img-nav-right" title="Next">\u203A</button>
            <span class="phone-img-counter"${counterHidden}>${counterText}</span>
            <button class="phone-img-gallery-btn${savedClass}" title="${isSaved ? 'Saved to gallery' : 'Save to gallery'}">${saveIcon}</button>
            <button class="phone-img-edit-btn" title="Edit prompt">&#9998;</button>
        </div>
        <div class="phone-img-editor" style="display:none;">
            <textarea class="phone-img-editor-textarea">${escapedPrompt}</textarea>
            <div class="phone-img-editor-actions">
                <button class="phone-img-save-btn">Save</button>
                <button class="phone-img-save-gen-btn">Save &amp; Generate</button>
            </div>
        </div>
    </div>`;
}

/**
 * Build a loading placeholder HTML.
 * @returns {string}
 */
function buildLoadingPlaceholder() {
    return `<div class="phone-img-wrapper"></div>`;
}

/**
 * Build the interactive voice note player HTML.
 * @param {string} vnText - The voice note text for the editor
 * @returns {string}
 */
function buildVoiceNotePlayer(vnText) {
    const escapedText = $('<span>').text(vnText).html();
    const duration = formatDuration(estimateTtsDuration(vnText));
    return `<div class="phone-vn-wrapper">
        <div class="phone-vn-container">
            <button class="phone-vn-play-btn" title="Play voice note">&#9654;</button>
            <div class="phone-vn-waveform">${buildWaveformBars()}</div>
            <span class="phone-vn-duration">${duration}</span>
            <button class="phone-vn-edit-btn" title="Edit voice note text">&#9998;</button>
        </div>
        <div class="phone-vn-editor" style="display:none;">
            <textarea class="phone-vn-editor-textarea">${escapedText}</textarea>
            <div class="phone-vn-editor-actions">
                <button class="phone-vn-save-btn">Save</button>
                <button class="phone-vn-save-play-btn">Save &amp; Play</button>
            </div>
        </div>
    </div>`;
}

/**
 * Strip [IMG]...[/IMG] and [VN]...[/VN] spans from the DOM using Range API.
 * Works across element boundaries (tags split by <br>, <em>, etc.).
 * Preserves all event bindings on unrelated elements.
 * For VN tags, inserts invisible marker spans at each [VN] position before deletion.
 * @param {JQuery} mesText
 * @returns {HTMLElement[]} Array of VN marker elements inserted at each [VN] position
 */
function stripTagsFromDOM(mesText) {
    const root = mesText[0];
    const tagNames = ['IMG', 'VN'];
    const vnMarkers = [];

    for (const tag of tagNames) {
        const openPattern = `[${tag}]`;
        const closePattern = `[/${tag}]`;

        // Repeat until no more pairs found
        while (true) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            let openNode = null, openOffset = -1;
            let closeNode = null, closeOffset = -1;
            let textNode;

            while ((textNode = walker.nextNode())) {
                const val = textNode.nodeValue;
                if (!openNode) {
                    const idx = val.indexOf(openPattern);
                    if (idx !== -1) {
                        openNode = textNode;
                        openOffset = idx;
                    }
                }
                if (openNode) {
                    const idx = textNode.nodeValue.indexOf(closePattern);
                    if (idx !== -1) {
                        closeNode = textNode;
                        closeOffset = idx + closePattern.length;
                        break;
                    }
                }
            }

            if (!openNode || !closeNode) break;

            // For VN tags, insert invisible marker before deleting
            if (tag === 'VN') {
                const marker = document.createElement('span');
                marker.className = 'phone-vn-marker';
                marker.style.display = 'none';
                openNode.parentNode.insertBefore(marker, openNode.splitText(openOffset));
                // Recalculate: splitting moved content to a new text node
                const newTextNode = marker.nextSibling;
                openNode = newTextNode;
                openOffset = 0;
                vnMarkers.push(marker);
            }

            const range = document.createRange();
            range.setStart(openNode, openOffset);
            range.setEnd(closeNode, closeOffset);
            range.deleteContents();

            // Clean up empty text nodes left behind
            if (openNode.parentNode && openNode.nodeValue === '') openNode.remove();
            if (closeNode !== openNode && closeNode.parentNode && closeNode.nodeValue === '') closeNode.remove();
        }
    }

    return vnMarkers;
}

/**
 * Remove static LLM-generated VN placeholder elements that weren't replaced
 * by the interactive player. Cleans up orphan placeholders to prevent duplicates.
 * @param {JQuery} mesText
 */
function removeStaticVnPlaceholders(mesText) {
    // Remove elements with data-phone-vn attribute not inside a .phone-vn-wrapper
    mesText.find('[data-phone-vn]').each(function () {
        if (!$(this).closest('.phone-vn-wrapper').length) $(this).remove();
    });

    // Remove DOMPurify-prefixed VN classes not inside a .phone-vn-wrapper
    mesText.find('[class*="custom-phone-vn"]').each(function () {
        if (!$(this).closest('.phone-vn-wrapper').length) $(this).remove();
    });

    // Remove divs with "Voice note" + ▶ text that aren't part of .phone-vn-wrapper
    mesText.find('div').each(function () {
        const el = $(this);
        if (el.closest('.phone-vn-wrapper').length) return;
        const text = el.text();
        if (/voice\s*note/i.test(text) && text.includes('\u25B6') && !el.find('.phone-vn-wrapper').length) {
            el.remove();
        }
    });

    // Clean up VN markers
    mesText.find('.phone-vn-marker').remove();
}

/**
 * Clean voice note text for TTS by removing non-verbal expressions.
 * Strips italicized content (*laughs*, _sighs_) which represents
 * paralinguistic or emotional expressions not meant to be spoken.
 * @param {string} text
 * @returns {string}
 */
function cleanVnTextForTts(text) {
    return text
        .replace(/\*[^*]+\*/g, '')
        .replace(/_[^_]+_/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Main handler for CHARACTER_MESSAGE_RENDERED.
 * @param {number} messageId
 */
async function onCharacterMessageRendered(messageId) {
    if (processedMessages.has(messageId)) return;

    const message = chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    const messageText = message.mes;
    if (!messageText) return;

    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
    const mesText = messageElement.find('.mes_text');
    if (!mesText.length) return;

    // Check for restore vs first-gen
    const hasImgTags = /\[IMG\]/i.test(messageText);
    const hasVnTags = /\[VN\]/i.test(messageText);
    const phoneMedia = message.extra?.phoneMedia;

    // VN tags now persist in message.mes, so VN restore is detected by having phoneMedia vn entries
    const hasVnMedia = phoneMedia && Object.keys(phoneMedia).some(k => k.startsWith('vn'));
    const hasImgMedia = phoneMedia && Object.keys(phoneMedia).some(k => !k.startsWith('vn'));

    // IMG restore: no IMG tags in mes but phoneMedia has image entries (tags were stripped on first gen)
    // VN restore: VN tags in mes AND phoneMedia has vn entries (tags kept, media already generated)
    const imgNeedsGen = hasImgTags;
    const vnNeedsGen = hasVnTags && !hasVnMedia;

    // Restore mode — nothing needs first-gen processing
    if (!imgNeedsGen && !vnNeedsGen && phoneMedia && Object.keys(phoneMedia).length > 0) {
        processedMessages.add(messageId);
        const vnMarkers = stripTagsFromDOM(mesText);
        for (const [idxStr, media] of Object.entries(phoneMedia)) {
            if (media.type === 'image') {
                const idx = parseInt(idxStr, 10);
                restoreImage(mesText, media, idx);
            }
            if (media.type === 'voice_note') {
                const idx = parseInt(idxStr.replace('vn', ''), 10);
                restoreVoiceNote(mesText, media, idx, messageId, vnMarkers);
            }
        }
        removeStaticVnPlaceholders(mesText);
        bindCarouselHandlers(mesText, messageId);
        return;
    }

    if (!hasImgTags && !hasVnTags) return;

    processedMessages.add(messageId);

    // Collect all matches
    const imgMatches = [...messageText.matchAll(IMG_TAG_REGEX)];
    const vnMatches = [...messageText.matchAll(VN_TAG_REGEX)];

    if (!message.extra) message.extra = {};
    if (!message.extra.phoneMedia) message.extra.phoneMedia = {};

    // Strip [IMG] tags from message text (VN tags kept for edit flow)
    message.mes = message.mes.replace(STRIP_IMG_TAGS_REGEX, '').trim();

    // Collect VN placeholder references BEFORE stripTagsFromDOM (which may delete them)
    const vnPlaceholderRefs = vnMatches.map((_, i) => findPlaceholder(mesText, 'data-phone-vn', i, '\u25B6'));

    // Strip from rendered DOM — returns VN position markers
    const vnMarkers = stripTagsFromDOM(mesText);

    // Process voice notes (non-blocking — user clicks to play)
    for (let i = 0; i < vnMatches.length; i++) {
        const vnText = vnMatches[i][1].trim();
        if (!vnText) continue;

        console.log(`[${MODULE_NAME}] Found [VN] tag #${i} in message ${messageId}`);

        const playerHtml = buildVoiceNotePlayer(vnText);
        let inserted = false;

        // Try saved placeholder reference (if still in DOM)
        const savedRef = vnPlaceholderRefs[i];
        if (savedRef && savedRef[0]?.isConnected) {
            savedRef.replaceWith(playerHtml);
            inserted = true;
        }

        // Try improved findPlaceholder
        if (!inserted) {
            const placeholder = findPlaceholder(mesText, 'data-phone-vn', i, '\u25B6');
            if (placeholder) {
                placeholder.replaceWith(playerHtml);
                inserted = true;
            }
        }

        // Try VN marker from stripTagsFromDOM
        if (!inserted && vnMarkers[i]?.isConnected) {
            $(vnMarkers[i]).replaceWith(playerHtml);
            inserted = true;
        }

        // Fallback: append to end
        if (!inserted) {
            mesText.append(playerHtml);
        }

        // Bind click-to-play and edit handler on the newly inserted player
        const wrapper = mesText.find('.phone-vn-wrapper').eq(i);
        const player = wrapper.find('.phone-vn-container');
        bindVoiceNotePlayer(player, messageId, i);
        bindVnEditHandler(wrapper, messageId, i);

        message.extra.phoneMedia[`vn${i}`] = { type: 'voice_note', text: vnText };
    }

    // Clean up any remaining LLM-generated static VN placeholders
    removeStaticVnPlaceholders(mesText);

    // Process images sequentially
    for (let i = 0; i < imgMatches.length; i++) {
        const prompt = imgMatches[i][1].trim();
        if (!prompt) continue;

        console.log(`[${MODULE_NAME}] Found [IMG] tag #${i} in message ${messageId}: ${prompt.substring(0, 80)}...`);

        const placeholder = findPlaceholder(mesText, 'data-phone-img', i, '\uD83D\uDCF8');

        // Insert an empty wrapper to reserve the image's layout slot
        const loadingHtml = buildLoadingPlaceholder();
        if (placeholder) {
            placeholder.replaceWith(loadingHtml);
        } else {
            mesText.append(loadingHtml);
        }
        const loadingWrapper = mesText.find('.phone-img-wrapper').not(':has(.phone-img)').last();

        try {
            const result = await executeSlashCommandsWithOptions(
                `/imagine quiet=true gallery=false ${sanitizeForSlashCommand(prompt)}`,
                { handleParserErrors: true, handleExecutionErrors: true },
            );

            const imageUrl = result?.pipe;
            if (!imageUrl) {
                console.warn(`[${MODULE_NAME}] /imagine returned no image URL for tag #${i}`);
                loadingWrapper.replaceWith('<div class="phone-img-wrapper"><div class="phone-img-loading">Image generation failed</div></div>');
                continue;
            }

            console.log(`[${MODULE_NAME}] Image #${i} generated: ${imageUrl}`);

            const containerHtml = buildImageContainer(imageUrl, prompt, 1, 0);
            loadingWrapper.replaceWith(containerHtml);

            message.extra.phoneMedia[i] = { urls: [imageUrl], type: 'image', prompt, activeIndex: 0 };
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to generate image #${i}:`, error);
            loadingWrapper.replaceWith('<div class="phone-img-wrapper"><div class="phone-img-loading">Image generation failed</div></div>');
        }
    }

    // Bind carousel navigation handlers
    bindCarouselHandlers(mesText, messageId);

    await saveChatConditional();
    console.log(`[${MODULE_NAME}] Processed message ${messageId}: ${imgMatches.length} images, ${vnMatches.length} voice notes`);
}

/**
 * Restore a voice note placeholder with an interactive player.
 * @param {JQuery} mesText
 * @param {object} media
 * @param {number} index
 * @param {number} messageId
 * @param {HTMLElement[]} [vnMarkers] - Position markers from stripTagsFromDOM
 */
function restoreVoiceNote(mesText, media, index, messageId, vnMarkers) {
    const playerHtml = buildVoiceNotePlayer(media.text);
    let inserted = false;

    // Try findPlaceholder (improved with broader VN matching)
    const placeholder = findPlaceholder(mesText, 'data-phone-vn', index, '\u25B6');
    if (placeholder) {
        placeholder.replaceWith(playerHtml);
        inserted = true;
    }

    // Try VN marker from stripTagsFromDOM
    if (!inserted && vnMarkers?.[index]?.isConnected) {
        $(vnMarkers[index]).replaceWith(playerHtml);
        inserted = true;
    }

    // Fallback: append to end
    if (!inserted) {
        mesText.append(playerHtml);
    }

    const wrapper = mesText.find('.phone-vn-wrapper').last();
    if (wrapper.length) {
        const player = wrapper.find('.phone-vn-container');
        bindVoiceNotePlayer(player, messageId, index);
        bindVnEditHandler(wrapper, messageId, index);
    }
}

/**
 * Wait for the TTS audio element to finish playback.
 * @returns {Promise<void>}
 */
function waitForTtsPlayback() {
    const audioEl = document.getElementById('tts_audio');

    if (!audioEl) {
        const resolved = Promise.resolve();
        return { started: resolved, ended: resolved };
    }

    let resolveStarted, resolveEnded;
    const started = new Promise((r) => { resolveStarted = r; });
    const ended = new Promise((r) => { resolveEnded = r; });

    let hasStarted = false;

    const cleanup = () => {
        audioEl.removeEventListener('play', onPlay);
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('error', onError);
        clearTimeout(timeout);
    };

    const onPlay = () => {
        hasStarted = true;
        resolveStarted();
    };
    const onEnded = () => { cleanup(); resolveEnded(); };
    const onError = () => { cleanup(); resolveStarted(); resolveEnded(); };

    audioEl.addEventListener('play', onPlay);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('error', onError);

    // Safety timeout — if nothing plays within 15s, resolve anyway
    const timeout = setTimeout(() => {
        if (!hasStarted) { cleanup(); resolveStarted(); resolveEnded(); }
    }, 15000);

    return { started, ended };
}

/**
 * Bind click-to-play handler on a voice note player element.
 * Reads current text from phoneMedia so edits are reflected without re-binding.
 * @param {JQuery} player
 * @param {number} messageId
 * @param {number} vnIndex
 */
function bindVoiceNotePlayer(player, messageId, vnIndex) {
    const playBtn = player.find('.phone-vn-play-btn');
    const waveform = player.find('.phone-vn-waveform');

    playBtn.off('click').on('click', async function () {
        if (playBtn.hasClass('playing') || playBtn.hasClass('loading')) return;

        playBtn.addClass('loading').empty();

        try {
            const message = chat[messageId];
            const vnText = message?.extra?.phoneMedia?.[`vn${vnIndex}`]?.text;
            if (!vnText) {
                console.warn(`[${MODULE_NAME}] No voice note text found for vn${vnIndex}`);
                return;
            }
            const voice = name2 || 'default';
            const ttsText = cleanVnTextForTts(vnText);
            if (!ttsText) {
                console.warn(`[${MODULE_NAME}] Voice note text empty after cleaning`);
                return;
            }
            const { started, ended } = waitForTtsPlayback();
            await executeSlashCommandsWithOptions(
                `/speak voice="${voice.replace(/"/g, '')}" ${sanitizeForSlashCommand(ttsText)}`,
                { handleParserErrors: true, handleExecutionErrors: true },
            );
            await started;

            playBtn.removeClass('loading').addClass('playing').html('&#9646;&#9646;');
            waveform.addClass('playing');

            await ended;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Voice note playback failed:`, error);
        } finally {
            playBtn.removeClass('playing loading').html('&#9654;');
            waveform.removeClass('playing');
        }
    });
}

/**
 * Replace the content of the Nth [VN]...[/VN] tag in message text.
 * @param {string} mes - The message text
 * @param {number} index - Which VN tag to replace (0-based)
 * @param {string} newText - The new content
 * @returns {string}
 */
function replaceNthVnTag(mes, index, newText) {
    let count = 0;
    // Use a fresh regex to avoid lastIndex issues with the global VN_TAG_REGEX
    const regex = /\[VN\]\s*([\s\S]*?)\s*\[\/VN\]/gi;
    return mes.replace(regex, (match, content) => {
        if (count++ === index) {
            return `[VN]${newText}[/VN]`;
        }
        return match;
    });
}

/**
 * Bind edit button and save handlers on a voice note wrapper.
 * @param {JQuery} wrapper - The .phone-vn-wrapper element
 * @param {number} messageId
 * @param {number} vnIndex
 */
function bindVnEditHandler(wrapper, messageId, vnIndex) {
    const editBtn = wrapper.find('.phone-vn-edit-btn');
    const editor = wrapper.find('.phone-vn-editor');
    const textarea = wrapper.find('.phone-vn-editor-textarea');
    const saveBtn = wrapper.find('.phone-vn-save-btn');
    const savePlayBtn = wrapper.find('.phone-vn-save-play-btn');

    editBtn.off('click').on('click', function () {
        if (editor.is(':visible')) {
            editor.hide();
        } else {
            // Refresh textarea with current text from phoneMedia
            const message = chat[messageId];
            const currentText = message?.extra?.phoneMedia?.[`vn${vnIndex}`]?.text || '';
            textarea.val(currentText);
            editor.show();
        }
    });

    async function saveVnText() {
        const newText = textarea.val().trim();
        if (!newText) return;

        const message = chat[messageId];
        if (!message) return;

        // Update phoneMedia
        if (message.extra?.phoneMedia?.[`vn${vnIndex}`]) {
            message.extra.phoneMedia[`vn${vnIndex}`].text = newText;
        }

        // Update [VN] tag in message.mes
        message.mes = replaceNthVnTag(message.mes, vnIndex, newText);

        editor.hide();
        wrapper.find('.phone-vn-duration').text(formatDuration(estimateTtsDuration(newText)));
        await saveChatConditional();
        console.log(`[${MODULE_NAME}] Updated VN text for vn${vnIndex} in message ${messageId}`);
    }

    saveBtn.off('click').on('click', async function () {
        await saveVnText();
    });

    savePlayBtn.off('click').on('click', async function () {
        await saveVnText();

        // Trigger playback with the new text
        const playBtn = wrapper.find('.phone-vn-play-btn');
        playBtn.trigger('click');
    });
}

/**
 * Bind edit button and save handlers on an image wrapper.
 * @param {JQuery} wrapper - The .phone-img-wrapper element
 * @param {number} messageId
 * @param {number} imgIndex
 */
function bindImageEditHandler(wrapper, messageId, imgIndex) {
    const editBtn = wrapper.find('.phone-img-edit-btn');
    const editor = wrapper.find('.phone-img-editor');
    const textarea = wrapper.find('.phone-img-editor-textarea');
    const saveBtn = wrapper.find('.phone-img-save-btn');
    const saveGenBtn = wrapper.find('.phone-img-save-gen-btn');

    editBtn.off('click').on('click', function () {
        if (editor.is(':visible')) {
            editor.hide();
        } else {
            const message = chat[messageId];
            const currentPrompt = message?.extra?.phoneMedia?.[imgIndex]?.prompt || '';
            textarea.val(currentPrompt);
            editor.show();
        }
    });

    saveBtn.off('click').on('click', async function () {
        const newPrompt = textarea.val().trim();
        if (!newPrompt) return;

        const message = chat[messageId];
        if (!message?.extra?.phoneMedia?.[imgIndex]) return;

        message.extra.phoneMedia[imgIndex].prompt = newPrompt;
        editor.hide();
        await saveChatConditional();
        console.log(`[${MODULE_NAME}] Updated prompt for image #${imgIndex} in message ${messageId}`);
    });

    saveGenBtn.off('click').on('click', async function () {
        const newPrompt = textarea.val().trim();
        if (!newPrompt) return;

        const message = chat[messageId];
        const media = message?.extra?.phoneMedia?.[imgIndex];
        if (!media) return;

        media.prompt = newPrompt;
        editor.hide();

        const container = wrapper.find('.phone-img-container');
        const img = container.find('.phone-img');
        const leftBtn = container.find('.phone-img-nav-left');
        const rightBtn = container.find('.phone-img-nav-right');
        const counter = container.find('.phone-img-counter');

        img.addClass('fading');
        const spinner = $('<div class="phone-img-overlay-spinner"></div>');
        container.append(spinner);
        editBtn.prop('disabled', true);
        rightBtn.prop('disabled', true);

        try {
            const result = await executeSlashCommandsWithOptions(
                `/imagine quiet=true gallery=false ${sanitizeForSlashCommand(newPrompt)}`,
                { handleParserErrors: true, handleExecutionErrors: true },
            );

            const newUrl = result?.pipe;
            if (newUrl) {
                media.urls.push(newUrl);
                media.activeIndex = media.urls.length - 1;
                img.attr('src', newUrl);
                counter.text(`${media.activeIndex + 1}/${media.urls.length}`).show();
                leftBtn.show();
                await saveChatConditional();
                console.log(`[${MODULE_NAME}] Generated new image with updated prompt for #${imgIndex} in message ${messageId}`);
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Image generation failed:`, error);
        } finally {
            img.removeClass('fading');
            spinner.remove();
            editBtn.prop('disabled', false);
            rightBtn.prop('disabled', false);
        }
    });
}

/**
 * Bind carousel navigation handlers on all image containers within a message.
 * @param {JQuery} mesText
 * @param {number} messageId
 */
function bindCarouselHandlers(mesText, messageId) {
    mesText.find('.phone-img-wrapper').each(function (i) {
        const wrapper = $(this);
        const container = wrapper.find('.phone-img-container');
        const img = container.find('.phone-img');
        const leftBtn = container.find('.phone-img-nav-left');
        const rightBtn = container.find('.phone-img-nav-right');
        const counter = container.find('.phone-img-counter');
        const galleryBtn = container.find('.phone-img-gallery-btn');

        bindImageEditHandler(wrapper, messageId, i);

        // Gallery save button
        galleryBtn.off('click').on('click', async function () {
            if (galleryBtn.hasClass('saved') || galleryBtn.hasClass('saving')) return;

            const message = chat[messageId];
            const media = message?.extra?.phoneMedia?.[i];
            if (!media) return;

            const currentUrl = img.attr('src');
            galleryBtn.addClass('saving').empty();

            try {
                await saveImageToGallery(currentUrl);

                if (!media.savedToGallery) media.savedToGallery = [];
                const idx = media.activeIndex ?? 0;
                if (!media.savedToGallery.includes(idx)) {
                    media.savedToGallery.push(idx);
                }

                // Flash checkmark bright, then settle into dimmed saved state
                galleryBtn.removeClass('saving').html('&#10003;').css('color', '#25d366');
                setTimeout(() => {
                    galleryBtn.addClass('saved').attr('title', 'Saved to gallery');
                }, 1500);

                await saveChatConditional();
                console.log(`[${MODULE_NAME}] Saved image #${i} variant ${media.activeIndex} to gallery for message ${messageId}`);
            } catch (error) {
                console.error(`[${MODULE_NAME}] Gallery save failed:`, error);
                galleryBtn.removeClass('saving').addClass('error').html('&#8615;');
                setTimeout(() => galleryBtn.removeClass('error'), 1500);
            }
        });

        // Click image to open lightbox
        img.off('click.lightbox').on('click.lightbox', function () {
            openLightbox($(this).attr('src'));
        });

        leftBtn.off('click').on('click', function () {
            const message = chat[messageId];
            const media = message?.extra?.phoneMedia?.[i];
            if (!media) return;

            // Migrate legacy format
            if (media.url && !media.urls) {
                media.urls = [media.url];
                media.activeIndex = 0;
                delete media.url;
            }

            if (media.activeIndex <= 0) return;

            media.activeIndex--;
            img.attr('src', media.urls[media.activeIndex]);
            counter.text(`${media.activeIndex + 1}/${media.urls.length}`);
            leftBtn.toggle(media.activeIndex > 0);

            // Sync gallery save button state
            const isSaved = (media.savedToGallery || []).includes(media.activeIndex);
            galleryBtn.toggleClass('saved', isSaved)
                .html(isSaved ? '&#10003;' : '&#8615;')
                .attr('title', isSaved ? 'Saved to gallery' : 'Save to gallery')
                .css('color', '');
        });

        rightBtn.off('click').on('click', async function () {
            const message = chat[messageId];
            const media = message?.extra?.phoneMedia?.[i];
            if (!media) return;

            // Migrate legacy format
            if (media.url && !media.urls) {
                media.urls = [media.url];
                media.activeIndex = 0;
                delete media.url;
            }

            const isLast = media.activeIndex >= media.urls.length - 1;

            if (!isLast) {
                // Navigate to next existing image
                media.activeIndex++;
                img.attr('src', media.urls[media.activeIndex]);
                counter.text(`${media.activeIndex + 1}/${media.urls.length}`).show();
                leftBtn.show();

                // Sync gallery save button state
                const isSaved = (media.savedToGallery || []).includes(media.activeIndex);
                galleryBtn.toggleClass('saved', isSaved)
                    .html(isSaved ? '&#10003;' : '&#8615;')
                    .attr('title', isSaved ? 'Saved to gallery' : 'Save to gallery')
                    .css('color', '');
                return;
            }

            // Generate a new image variant
            img.addClass('fading');
            const spinner = $('<div class="phone-img-overlay-spinner"></div>');
            container.append(spinner);
            rightBtn.prop('disabled', true);

            try {
                const result = await executeSlashCommandsWithOptions(
                    `/imagine quiet=true gallery=false ${sanitizeForSlashCommand(media.prompt)}`,
                    { handleParserErrors: true, handleExecutionErrors: true },
                );

                const newUrl = result?.pipe;
                if (newUrl) {
                    media.urls.push(newUrl);
                    media.activeIndex = media.urls.length - 1;
                    img.attr('src', newUrl);
                    counter.text(`${media.activeIndex + 1}/${media.urls.length}`).show();
                    leftBtn.show();

                    // New variant starts unsaved
                    galleryBtn.removeClass('saved').html('&#8615;').attr('title', 'Save to gallery').css('color', '');

                    await saveChatConditional();
                    console.log(`[${MODULE_NAME}] Generated variant #${media.activeIndex} for image #${i} in message ${messageId}`);
                }
            } catch (error) {
                console.error(`[${MODULE_NAME}] Image generation failed:`, error);
            } finally {
                img.removeClass('fading');
                spinner.remove();
                rightBtn.prop('disabled', false);
            }
        });
    });
}

/**
 * Reprocess all character messages to restore images and voice notes.
 */
async function reprocessAllMessages() {
    processedMessages.clear();
    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;
        await onCharacterMessageRendered(i);
    }
}

// Restore images and voice notes when a chat is loaded
eventSource.on(event_types.CHAT_CHANGED, () => {
    processedMessages.clear();
    // Delay to ensure DOM is rendered by printMessages()
    requestAnimationFrame(() => reprocessAllMessages());
});

// Clear tracking for swiped messages
eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
    processedMessages.delete(messageId);
});

// Main listener
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);

// Slash command to manually re-process messages
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'phone-ui',
    callback: async () => {
        await reprocessAllMessages();
        return 'Reprocessed all messages';
    },
    helpString: 'Re-process all character messages for [IMG] and [VN] tags. Use when the extension fails to trigger automatically.',
}));

console.log(`[${MODULE_NAME}] Extension loaded — listening for [IMG] and [VN] tags`);
