'use strict';

/**
 * TapMind Native Ads - Cocos Creator 3.8 Extension
 * Main entry point for the plugin lifecycle.
 *
 * This plugin hooks into the build pipeline to automatically inject:
 *   - Android: TapMind AdMob Maven repo + Gradle dependency
 *   - iOS: TapMindAdapter CocoaPod
 *
 * No API key, no initialization code, no JS/TS bridge required.
 */

module.exports = {
    /**
     * Called when the plugin is first loaded by Cocos Creator Editor.
     */
    load() {
        console.log('[TapMind Native Ads] Extension loaded successfully.');
        console.log('[TapMind Native Ads] Build hooks registered. Android & iOS SDKs will be injected automatically on every build.');
    },

    /**
     * Called when the plugin is unloaded (e.g. on editor close or plugin disable).
     */
    unload() {
        console.log('[TapMind Native Ads] Extension unloaded.');
    },
};
