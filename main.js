/* FILE: main.js - Combined initialization for all modules */

import { initializeHtmlCore } from './core-html.js';
import { initializeBskyCore } from './core-bsky.js';
import { initializeFeedProcessing } from './bsky-feeds.js';
import { initializeSearchProcessing } from './bsky-search.js';
import { initializeThreadProcessing } from './bsky-thread.js';

/* Initialize all core functionality */
export async function initializeApplication() {
    console.log('Initializing Bluesky application...');
    
    try {
        /* Initialize core modules */
        console.log('1. Initializing HTML core...');
        initializeHtmlCore();
        
        console.log('2. Initializing Bluesky core...');
        initializeBskyCore();
        
        /* Initialize feature modules based on what's available in the DOM */
        if (document.getElementById('feed-form')) {
            console.log('3. Initializing feed processing...');
            initializeFeedProcessing();
        }
        
        if (document.getElementById('search-form')) {
            console.log('4. Initializing search processing...');
            initializeSearchProcessing();
        }
        
        if (document.getElementById('processor-form')) {
            console.log('5. Initializing thread processing...');
            initializeThreadProcessing();
        }
        
        console.log('Application initialization complete!');
        return true;
        
    } catch (error) {
        console.error('Application initialization failed:', error);
        return false;
    }
}

/* Auto-initialize when DOM is ready */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
} else {
    initializeApplication();
}

/* Export core functionality for direct access if needed */
export * from './core-html.js';
export * from './core-bsky.js';
