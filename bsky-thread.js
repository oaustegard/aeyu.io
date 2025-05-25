/* FILE: bsky-thread.js - REFACTORED using separated core modules */

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
    getAuthToken
} from './core-bsky.js';

/* Initialize thread processing */
export function initializeThreadProcessing() {
    console.log('Initializing thread processing...');
    
    const form = document.getElementById('processor-form');
    const repliesButton = document.getElementById('process-replies');
    const quotesButton = document.getElementById('process-quotes');
    
    if (form && repliesButton) {
        repliesButton.addEventListener('click', async (e) => {
            e.preventDefault();
            await processReplies();
        });
    }
    
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
            condition: (params) => params.get('url'),
            handler: () => {
                const mode = new URLSearchParams(window.location.search).get('mode');
                return mode === 'quotes' ? processQuotes() : processReplies();
            }
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

/* Process replies for a post */
async function processReplies() {
    console.log('Processing replies...');
    
    return handleFormSubmission('process-replies', 'Process Replies', async () => {
        const { handle, postId } = parsePostUrl(getUrlInput());
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        const postUri = await buildPostUri(handle, postId);
        const originalPost = await fetchOriginalPost(postUri);
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=10&parentHeight=0`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', response.status, errorText);
            throw new Error(`Failed to fetch post thread: ${response.status} - ${errorText}`);
        }
        
        const threadData = await response.json();
        console.log('Thread data received:', threadData);
        
        const replies = extractReplies(threadData.thread);
        const anonymizedReplies = anonymizePosts(replies, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true
        });
        
        console.log(`Processed ${anonymizedReplies.length} replies`);
        
        return buildStandardOutput(originalPost, anonymizedReplies, {
            originalPost: postUri,
            totalReplies: anonymizedReplies.length,
            childDataKey: 'replies'
        });
    });
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
        const quotes = await findQuotesUsingGetQuotesAPI(postUri);
        
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        return buildStandardOutput(originalPost, anonymizedQuotes, {
            originalPost: postUri,
            totalQuotes: anonymizedQuotes.length,
            childDataKey: 'quotePosts'
        });
    });
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

/* Extract replies from thread data */
function extractReplies(thread) {
    const replies = [];
    
    function traverseReplies(node) {
        if (node.replies) {
            for (const reply of node.replies) {
                if (reply.post) {
                    replies.push(reply.post);
                }
                traverseReplies(reply);
            }
        }
    }
    
    traverseReplies(thread);
    return replies;
}

/* Legacy function for compatibility */
export function autoProcessThread() {
    console.log('autoProcessThread() called - functionality now handled by core autoProcessFromUrlParams()');
}
