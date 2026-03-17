// ==UserScript==
// @name         Vinted - Filter by Likes
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Hides Vinted catalog items below a minimum number of likes (favourites)
// @author       Michele Golino
// @match        https://www.vinted.it/catalog*
// @match        https://www.vinted.it/catalog/*
// @grant        GM_xmlhttpRequest
// @connect      www.vinted.it
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration ---
    const MIN_LIKES = 100;
    const API_DELAY_MS = 800;
    const API_BASE_URL = 'https://www.vinted.it/api/v2/items';

    // --- Utilities ---

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetches a single item from the Vinted API and returns its favourite count.
     * Retries automatically on rate limit (code 106).
     */
    function fetchItemLikes(itemId) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${API_BASE_URL}/${itemId}`,
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.code === 106) {
                            // Rate limit hit — retry after 2 seconds
                            setTimeout(() => fetchItemLikes(itemId).then(resolve), 2000);
                            return;
                        }
                        resolve({
                            id: String(itemId),
                            likes: data.item?.favourite_count ?? 0
                        });
                    } catch {
                        resolve({ id: String(itemId), likes: 0 });
                    }
                },
                onerror: () => resolve({ id: String(itemId), likes: 0 })
            });
        });
    }

    /**
     * Tries to read the likes count directly from the DOM.
     * Returns null if not available (not rendered by Vinted on this card type).
     */
    function getLikesFromDOM(card) {
        const favBtn = card.querySelector('[data-testid$="--favourite"]');
        if (!favBtn) return null;

        // Some card types render the count as a visible text element
        const countEl = favBtn.querySelector('[data-testid="favourite-count-text"]');
        if (countEl) {
            const val = parseInt(countEl.textContent.trim());
            if (!isNaN(val)) return val;
        }

        // Fallback: parse from aria-label (e.g. "Aggiunto ai preferiti da 28 utenti")
        const ariaLabel = favBtn.getAttribute('aria-label') || '';
        const match = ariaLabel.match(/da (\d+) utenti/);
        if (match) return parseInt(match[1]);

        return null;
    }

    /**
     * Adds a likes badge overlay on a card element.
     */
    function addBadge(card, count) {
        if (card.querySelector('.vfl-badge')) return;

        const badge = document.createElement('div');
        badge.className = 'vfl-badge';
        badge.textContent = `❤️ ${count}`;
        badge.style.cssText = `
            position: absolute;
            top: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.72);
            color: #fff;
            font-size: 12px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 12px;
            z-index: 999;
            pointer-events: none;
            letter-spacing: 0.3px;
        `;
        card.style.position = 'relative';
        card.appendChild(badge);
    }

    // --- Main ---

    async function run() {
        // Run only on catalog pages
        if (!window.location.pathname.startsWith('/catalog')) return;

        const cards = document.querySelectorAll(
            'div.new-item-box__container[data-testid^="product-item-id-"]'
        );
        if (!cards.length) return;

        // Build a map of itemId -> card element
        const cardMap = {};
        cards.forEach(card => {
            const id = card.getAttribute('data-testid').replace('product-item-id-', '');
            cardMap[id] = card;
        });

        const ids = Object.keys(cardMap);
        const likeMap = {};
        const needsAPI = [];

        // First pass: read likes from DOM where available
        ids.forEach(id => {
            const likes = getLikesFromDOM(cardMap[id]);
            if (likes !== null) {
                likeMap[id] = likes;
            } else {
                needsAPI.push(id);
            }
        });

        // Second pass: fetch remaining items from API sequentially with delay
        for (const id of needsAPI) {
            await sleep(API_DELAY_MS);
            const result = await fetchItemLikes(id);
            likeMap[id] = result.likes;
        }

        // Apply filter
        ids.forEach(id => {
            const card = cardMap[id];
            const likes = likeMap[id] ?? 0;
            const gridItem = card.closest('[data-testid="grid-item"]') || card.parentElement;

            if (likes < MIN_LIKES) {
                gridItem.style.display = 'none';
            } else {
                addBadge(card, likes);
            }
        });
    }

    window.addEventListener('load', () => setTimeout(run, 2500));

})();