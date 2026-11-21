/*
 * Square SDK seam — intentionally disabled.
 *
 * LITEcrib is a test-token showcase. Square is NOT wired to checkout, payouts,
 * or real-money play. This module exists only so the integration point is
 * obvious and reviewable when real Square credentials + SDK choice arrive.
 *
 * Rules for the eventual implementation:
 *   - Never put a Square access token, application secret or location secret in
 *     browser code, config.js, or a PWA cache. Tokens are minted server-side.
 *   - Keep cfg.features.squareEnabled false until the server token exchange,
 *     webhook verification, and jurisdiction/real-money review are complete.
 *   - Continue to show "test tokens have no cash value" copy everywhere.
 */
(function (root) {
    'use strict';

    var cfg = (root && root.LITECRIB_CONFIG) || {};
    var square = cfg.square || {};

    var api = {
        isEnabled: function () {
            return square.enabled === true && cfg.features && cfg.features.squareEnabled === true;
        },
        status: function () {
            return {
                enabled: this.isEnabled(),
                mode: square.mode || 'test',
                currency: square.currency || 'USD',
                note: square.note || 'Test-token showcase only. No real-money checkout is enabled.'
            };
        },
        // Future: load the chosen Square Web SDK and call the relay for a
        // short-lived client token. Returns a disabled result today so callers
        // can be written before credentials exist without faking a payment.
        init: async function () {
            return { ok: false, disabled: true, reason: 'Square SDK is not configured for this test-token build.', status: this.status() };
        }
    };

    root.LITEcribSquare = api;
})(typeof window !== 'undefined' ? window : globalThis);
