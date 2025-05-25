/* FILE: bsky-quote.js - REFACTORED using separated core modules */

import { 
    showError, 
    hideError, 
    showLoading, 
    hideLoading,
    displayOutput,
    handleFormSubmission,
    autoProcessFromUrlParams
} from './core-html.js';

import { 
    BSKY_PUBLIC_API,
    parsePostUrl,
    buildPostUri,
    fetchOriginalPost,
    buildStandardOutput,
    anonymizePosts,
    getAuthToken,
    safeGetCreatedAt
} from './core-bsky.js';

/* Initialize quote processing */
export function initializeQuoteProcessing() {
    console.log('Initializing quote processing...');
    
    const form = document.getElementById('processor-form');
    const quotesButton = document.getElementById('process-quotes');
    
    if (form && quotesButton) {
        quotesButton.addEventListener('click', async (e) => {
            e.preventDefault();
            await processQuotes();
        });
    }
    
    /* Auto-process from URL parameters */
    autoProcessFromUrlParams({
        paramMappings: {
            'url': 'url-input'
        },
        autoSubmit: {
            condition: (params) => params.get('url') && params.get('mode') === 'quotes',
            handler: () => processQuotes()
        }
    });
}

/* Get URL input helper */
function getUrlInput() {
    const urlInput = document.getElementById('url-input');
    const url = urlInput?.value?.trim();
    
    if (!url) {
        throw new Error('Please enter a Bluesky post URL');
    }
    
    return url;
}

/* Process quotes for a post */
async function processQuotes() {
    console.log('Processing quotes...');
    
    return handleFormSubmission('process-quotes', 'Process Quotes', async () => {
        const { handle, postId } = parsePostUrl(getUrlInput());
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        const postUri = await buildPostUri(handle, postId);
        console.log('Searching for quotes of post:', postUri);
        
        const originalPost = await fetchOriginalPost(postUri);
        
        /* Get root post time for relative timing */
        const rootTime = safeGetCreatedAt(originalPost);
        console.log('Root post time:', rootTime);
        
        const quotes = await findQuotesUsingGetQuotesAPI(postUri);
        
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true,
            rootTime: rootTime
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        return buildStandardOutput(originalPost, anonymizedQuotes, {
            originalPost: postUri,
            totalQuotes: anonymizedQuotes.length,
            childDataKey: 'quotePosts'
        });
    });
}

/* Process quotes for a specific post using the proper API (legacy interface) */
export async function processQuotes(postUrl) {
    console.log('Processing quotes for post (legacy interface):', postUrl);
    hideError();
    
    if (!postUrl) {
        showError('Please provide a Bluesky post URL');
        return;
    }
    
    try {
        const { handle, postId } = parsePostUrl(postUrl);
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        const postUri = await buildPostUri(handle, postId);
        const originalPost = await fetchOriginalPost(postUri);
        
        /* Get root post time for relative timing */
        const rootTime = safeGetCreatedAt(originalPost);
        
        const quotes = await findQuotesUsingGetQuotesAPI(postUri);
        
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true,
            rootTime: rootTime
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        const output = buildStandardOutput(originalPost, anonymizedQuotes, {
            originalPost: postUri,
            totalQuotes: anonymizedQuotes.length,
            childDataKey: 'quotePosts'
        });
        
        displayOutput(output);
        return output;
        
    } catch (error) {
        console.error('Error processing quotes:', error);
        showError(error.message);
        throw error;
    }
}

/* Find quotes using the proper getQuotes API */
async function findQuotesUsingGetQuotesAPI(postUri) {
    console.log('Finding quotes using app.bsky.feed.getQuotes API:', postUri);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getQuotes?uri=${encodeURIComponent(postUri)}&limit=100`);
        
        if (!response.ok) {
            console.error(`getQuotes API failed: ${response.status}`);
            return await findQuotesViaSearch(postUri);
        }
        
        const data = await response.json();
        const quotes = data.posts || [];
        
        console.log(`Found ${quotes.length} quotes via getQuotes API`);
        return quotes;
        
    } catch (error) {
        console.error('getQuotes API error:', error);
        return await findQuotesViaSearch(postUri);
    }
}

/* Fallback search method for quotes */
async function findQuotesViaSearch(postUri) {
    console.log('Falling back to search method for quotes:', postUri);
    
    try {
        const postIdMatch = postUri.match(/\/app\.bsky\.feed\.post\/(.+)$/);
        if (!postIdMatch) {
            console.error('Could not extract post ID from URI');
            return [];
        }
        
        const postId = postIdMatch[1];
        const searchQuery = postId.substring(0, 12);
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery)}&limit=100`);
        
        if (!response.ok) {
            console.error('Search fallback also failed');
            return [];
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        const quotes = allPosts.filter(post => {
            if (!post.record?.embed) return false;
            
            const embed = post.record.embed;
            if (embed.$type === 'app.bsky.embed.record') {
                return embed.record?.uri === postUri;
            }
            if (embed.$type === 'app.bsky.embed.recordWithMedia') {
                return embed.record?.record?.uri === postUri;
            }
            
            return false;
        });
        
        console.log(`Found ${quotes.length} quotes via search fallback`);
        return quotes;
        
    } catch (error) {
        console.error('Search fallback failed:', error);
        return [];
    }
}

/* Export for use in other modules (legacy interface) */
export async function findQuotesForPost(postUri) {
    return await findQuotesUsingGetQuotesAPI(postUri);
}
