import { eventSource, event_types, chat, saveChatConditional, name2 } from '../../../../script.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';

const MODULE_NAME = 'phone-ui';
const IMG_TAG_REGEX = /\[IMG\]\s*([\s\S]*?)\s*\[\/IMG\]/gi;
const VN_TAG_REGEX = /\[VN\]\s*([\s\S]*?)\s*\[\/VN\]/gi;
const STRIP_IMG_TAGS_REGEX = /\[IMG\][\s\S]*?\[\/IMG\]/gi; // used for message.mes stripping (VN tags kept for edit flow)

const BAR_HEIGHTS = [8, 14, 6, 18, 10, 16, 7, 12, 5, 15, 9, 13];

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
 * Find the Nth placeholder element in the rendered message by data attribute,
 * falling back to content-based matching.
 * @param {JQuery} mesText - The .mes_text element
 * @param {string} dataAttr - e.g. 'data-phone-img'
 * @param {number} index - The index to find
 * @param {string} fallbackContent - Content to search for (emoji)
 * @returns {JQuery|null}
 */
function findPlaceholder(mesText, dataAttr, index, fallbackContent) {
    // Try data attribute first
    const byAttr = mesText.find(`[${dataAttr}="${index}"]`);
    if (byAttr.length) return byAttr.first();

    // Fallback: find by content (Nth occurrence of the emoji)
    const candidates = [];
    mesText.find('div').each(function () {
        const el = $(this);
        if (el.text().includes(fallbackContent) && !el.find('[class^="phone-"]').length) {
            candidates.push(el);
        }
    });
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
    const container = buildImageContainer(currentUrl, media.prompt, urls.length, activeIndex);
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
 * @returns {string}
 */
function buildImageContainer(url, prompt, totalImages = 1, activeIndex = 0) {
    const escapedPrompt = $('<span>').text(prompt).html();
    const hideLeft = activeIndex === 0 ? ' style="display:none;"' : '';
    const counterText = totalImages > 1 ? `${activeIndex + 1}/${totalImages}` : '';
    const counterHidden = totalImages <= 1 ? ' style="display:none;"' : '';
    return `<div class="phone-img-container">
        <img class="phone-img" src="${url}" alt="Generated image" />
        <button class="phone-img-nav phone-img-nav-left"${hideLeft} title="Previous">\u2039</button>
        <button class="phone-img-nav phone-img-nav-right" title="Next">\u203A</button>
        <span class="phone-img-counter"${counterHidden}>${counterText}</span>
        <details class="phone-img-details">
            <summary>prompt</summary>
            <div class="phone-img-prompt">${escapedPrompt}</div>
        </details>
    </div>`;
}

/**
 * Build a loading placeholder HTML.
 * @returns {string}
 */
function buildLoadingPlaceholder() {
    return `<div class="phone-img-loading">
        <div class="phone-img-spinner"></div>
        <div>Generating image...</div>
    </div>`;
}

/**
 * Build the interactive voice note player HTML.
 * @param {string} vnText - The voice note text for the editor
 * @returns {string}
 */
function buildVoiceNotePlayer(vnText) {
    const escapedText = $('<span>').text(vnText).html();
    return `<div class="phone-vn-wrapper">
        <div class="phone-vn-container">
            <button class="phone-vn-play-btn" title="Play voice note">&#9654;</button>
            <div class="phone-vn-waveform">${buildWaveformBars()}</div>
            <span class="phone-vn-duration">0:07</span>
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
 * @param {JQuery} mesText
 */
function stripTagsFromDOM(mesText) {
    const root = mesText[0];
    const tagNames = ['IMG', 'VN'];

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

            const range = document.createRange();
            range.setStart(openNode, openOffset);
            range.setEnd(closeNode, closeOffset);
            range.deleteContents();

            // Clean up empty text nodes left behind
            if (openNode.nodeValue === '') openNode.remove();
            if (closeNode !== openNode && closeNode.parentNode && closeNode.nodeValue === '') closeNode.remove();
        }
    }
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
        stripTagsFromDOM(mesText);
        for (const [idxStr, media] of Object.entries(phoneMedia)) {
            if (media.type === 'image') {
                const idx = parseInt(idxStr, 10);
                restoreImage(mesText, media, idx);
            }
            if (media.type === 'voice_note') {
                const idx = parseInt(idxStr.replace('vn', ''), 10);
                restoreVoiceNote(mesText, media, idx, messageId);
            }
        }
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

    // Strip from rendered DOM BEFORE processing placeholders,
    // so Range deletion doesn't remove players we're about to insert
    stripTagsFromDOM(mesText);

    // Process voice notes (non-blocking — user clicks to play)
    for (let i = 0; i < vnMatches.length; i++) {
        const vnText = vnMatches[i][1].trim();
        if (!vnText) continue;

        console.log(`[${MODULE_NAME}] Found [VN] tag #${i} in message ${messageId}`);

        const placeholder = findPlaceholder(mesText, 'data-phone-vn', i, '\u25B6');
        const playerHtml = buildVoiceNotePlayer(vnText);

        if (placeholder) {
            placeholder.replaceWith(playerHtml);
        } else {
            mesText.append(playerHtml);
        }

        // Bind click-to-play and edit handler on the newly inserted player
        const wrapper = mesText.find('.phone-vn-wrapper').eq(i);
        const player = wrapper.find('.phone-vn-container');
        bindVoiceNotePlayer(player, messageId, i);
        bindVnEditHandler(wrapper, messageId, i);

        message.extra.phoneMedia[`vn${i}`] = { type: 'voice_note', text: vnText };
    }

    // Process images sequentially
    for (let i = 0; i < imgMatches.length; i++) {
        const prompt = imgMatches[i][1].trim();
        if (!prompt) continue;

        console.log(`[${MODULE_NAME}] Found [IMG] tag #${i} in message ${messageId}: ${prompt.substring(0, 80)}...`);

        const placeholder = findPlaceholder(mesText, 'data-phone-img', i, '\uD83D\uDCF8');

        // Show loading state
        const loadingHtml = buildLoadingPlaceholder();
        let loadingEl;
        if (placeholder) {
            placeholder.replaceWith(loadingHtml);
            loadingEl = mesText.find('.phone-img-loading').last();
        } else {
            mesText.append(loadingHtml);
            loadingEl = mesText.find('.phone-img-loading').last();
        }

        try {
            const result = await executeSlashCommandsWithOptions(
                `/imagine quiet=true ${prompt}`,
                { handleParserErrors: true, handleExecutionErrors: true },
            );

            const imageUrl = result?.pipe;
            if (!imageUrl) {
                console.warn(`[${MODULE_NAME}] /imagine returned no image URL for tag #${i}`);
                loadingEl.replaceWith('<div class="phone-img-loading">Image generation failed</div>');
                continue;
            }

            console.log(`[${MODULE_NAME}] Image #${i} generated: ${imageUrl}`);

            const containerHtml = buildImageContainer(imageUrl, prompt, 1, 0);
            loadingEl.replaceWith(containerHtml);

            message.extra.phoneMedia[i] = { urls: [imageUrl], type: 'image', prompt, activeIndex: 0 };
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to generate image #${i}:`, error);
            loadingEl.replaceWith('<div class="phone-img-loading">Image generation failed</div>');
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
 */
function restoreVoiceNote(mesText, media, index, messageId) {
    const placeholder = findPlaceholder(mesText, 'data-phone-vn', index, '\u25B6');
    const playerHtml = buildVoiceNotePlayer(media.text);
    if (placeholder) {
        placeholder.replaceWith(playerHtml);
    } else {
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
    return new Promise((resolve) => {
        const audioEl = document.getElementById('tts_audio');
        if (!audioEl) {
            resolve();
            return;
        }

        let started = false;
        const onPlay = () => { started = true; };
        const onEnded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); resolve(); };

        const cleanup = () => {
            audioEl.removeEventListener('play', onPlay);
            audioEl.removeEventListener('ended', onEnded);
            audioEl.removeEventListener('error', onError);
            clearTimeout(timeout);
        };

        audioEl.addEventListener('play', onPlay);
        audioEl.addEventListener('ended', onEnded);
        audioEl.addEventListener('error', onError);

        // Safety timeout — if nothing plays within 15s, resolve anyway
        const timeout = setTimeout(() => {
            if (!started) { cleanup(); resolve(); }
        }, 15000);
    });
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
        if (playBtn.hasClass('playing')) return;

        playBtn.addClass('playing').html('&#9646;&#9646;');
        waveform.addClass('playing');

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
            const playbackDone = waitForTtsPlayback();
            await executeSlashCommandsWithOptions(
                `/speak voice="${voice}" ${ttsText}`,
                { handleParserErrors: true, handleExecutionErrors: true },
            );
            await playbackDone;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Voice note playback failed:`, error);
        } finally {
            playBtn.removeClass('playing').html('&#9654;');
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
 * Bind carousel navigation handlers on all image containers within a message.
 * @param {JQuery} mesText
 * @param {number} messageId
 */
function bindCarouselHandlers(mesText, messageId) {
    mesText.find('.phone-img-container').each(function (i) {
        const container = $(this);
        const img = container.find('.phone-img');
        const leftBtn = container.find('.phone-img-nav-left');
        const rightBtn = container.find('.phone-img-nav-right');
        const counter = container.find('.phone-img-counter');

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
                return;
            }

            // Generate a new image variant
            img.addClass('fading');
            rightBtn.prop('disabled', true);

            try {
                const result = await executeSlashCommandsWithOptions(
                    `/imagine quiet=true ${media.prompt}`,
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
                    console.log(`[${MODULE_NAME}] Generated variant #${media.activeIndex} for image #${i} in message ${messageId}`);
                }
            } catch (error) {
                console.error(`[${MODULE_NAME}] Image generation failed:`, error);
            } finally {
                img.removeClass('fading');
                rightBtn.prop('disabled', false);
            }
        });
    });
}

// Clear processed set when chat changes
eventSource.on(event_types.CHAT_CHANGED, () => {
    processedMessages.clear();
});

// Clear tracking for swiped messages
eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
    processedMessages.delete(messageId);
});

// Main listener
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);

console.log(`[${MODULE_NAME}] Extension loaded — listening for [IMG] and [VN] tags`);
