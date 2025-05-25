/* Thread processing functionality for replies - REFACTORED */

import { 
    parsePostUrl, 
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput,
    extractPostFromItem,
    anonymizePost,
    anonymizePosts,
    extractAltText
} from './bsky-core.js';

const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

/* Resolve a handle to a DID using the public API */
async function resolveHandleToDid(handle) {
    console.log('Resolving handle to DID:', handle);
    
    const response = await fetch(`${BSKY_PUBLIC_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    
    if (!response.ok) {
        throw new Error(`Failed to resolve handle: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Resolved DID:', data.did);
    return data.did;
}

/* Find quotes using the public search API */
async function findQuotesUsingPublicAPI(postUri, postId) {
    console.log('Searching for quotes using public API...');
    
    try {
        /* Search for posts containing the post ID - potential quotes */
        const searchQuery = postId.substring(0, 12); /* Use partial post ID */
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery)}&limit=100`);
        
        if (!response.ok) {
            console.log('Public search failed, trying alternative approach');
            return await findQuotesAlternative(postUri, postId);
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        console.log(`Found ${allPosts.length} posts in search, filtering for quotes...`);
        
        /* Filter for posts that actually embed/quote the target post */
        const quotes = allPosts.filter(post => {
            if (!post.record?.embed) return false;
            
            /* Check if embed references our target post */
            const embed = post.record.embed;
            if (embed.$type === 'app.bsky.embed.record') {
                return embed.record?.uri === postUri;
            }
            if (embed.$type === 'app.bsky.embed.recordWithMedia') {
                return embed.record?.record?.uri === postUri;
            }
            
            return false;
        });
        
        console.log(`Found ${quotes.length} actual quotes after filtering`);
        return quotes;
        
    } catch (error) {
        console.error('Quote search failed:', error);
        return [];
    }
}

/* Alternative method for finding quotes if search fails */
async function findQuotesAlternative(postUri, postId) {
    console.log('Trying alternative quote detection method...');
    
    /* Try searching with just the post ID suffix */
    const shortId = postId.slice(-8);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(shortId)}&limit=50`);
        
        if (!response.ok) {
            console.log('Alternative search also failed');
            return [];
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        /* Filter for quotes */
        const quotes = allPosts.filter(post => {
            if (!post.record?.embed) return false;
            const embed = post.record.embed;
            return (embed.$type === 'app.bsky.embed.record' && embed.record?.uri === postUri) ||
                   (embed.$type === 'app.bsky.embed.recordWithMedia' && embed.record?.record?.uri === postUri);
        });
        
        return quotes;
        
    } catch (error) {
        console.error('Alternative quote search failed:', error);
        return [];
    }
}

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
}

/* Process replies for a post */
async function processReplies() {
    console.log('Processing replies...');
    hideError();
    
    const urlInput = document.getElementById('url-input');
    const url = urlInput?.value?.trim();
    
    if (!url) {
        showError('Please enter a Bluesky post URL');
        return;
    }
    
    try {
        showLoading('process-replies');
        
        const { handle, postId } = parsePostUrl(url);
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        /* Try to resolve the handle to get proper DID */
        let postUri;
        try {
            const did = await resolveHandleToDid(handle);
            postUri = `at://${did}/app.bsky.feed.post/${postId}`;
            console.log('Resolved DID:', did, 'Post URI:', postUri);
        } catch (didError) {
            console.log('DID resolution failed, using handle directly:', didError.message);
            postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        }
        
        /* Fetch replies using the public Bluesky API */
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=10&parentHeight=0`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', response.status, errorText);
            throw new Error(`Failed to fetch post thread: ${response.status} - ${errorText}`);
        }
        
        const threadData = await response.json();
        console.log('Thread data received:', threadData);
        
        /* Extract and anonymize replies */
        const replies = extractReplies(threadData.thread);
        const anonymizedReplies = anonymizePosts(replies, {
            sourceType: 'search', /* Replies are direct post objects */
            includePostType: false,
            includeAltText: true
        });
        
        console.log(`Processed ${anonymizedReplies.length} replies`);
        
        const output = {
            metadata: {
                originalPost: postUri,
                totalReplies: anonymizedReplies.length,
                processedAt: new Date().toISOString()
            },
            replies: anonymizedReplies
        };
        
        displayOutput(output);
        
    } catch (error) {
        console.error('Error processing replies:', error);
        showError(error.message);
    } finally {
        hideLoading('process-replies', 'Process Replies');
    }
}

/* Process quotes for a post */
async function processQuotes() {
    console.log('Processing quotes...');
    hideError();
    
    const urlInput = document.getElementById('url-input');
    const url = urlInput?.value?.trim();
    
    if (!url) {
        showError('Please enter a Bluesky post URL');
        return;
    }
    
    try {
        showLoading('process-quotes');
        
        const { handle, postId } = parsePostUrl(url);
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        /* Try to resolve the handle to get proper DID */
        let postUri;
        try {
            const did = await resolveHandleToDid(handle);
            postUri = `at://${did}/app.bsky.feed.post/${postId}`;
        } catch (didError) {
            console.log('DID resolution failed, using handle directly:', didError.message);
            postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        }
        
        console.log('Searching for quotes of post:', postUri);
        
        /* Search for posts that quote this URI using public API */
        const quotes = await findQuotesUsingPublicAPI(postUri, postId);
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search', /* Quotes are direct post objects */
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        const output = {
            metadata: {
                originalPost: postUri,
                totalQuotes: anonymizedQuotes.length,
                processedAt: new Date().toISOString()
            },
            quotes: anonymizedQuotes
        };
        
        displayOutput(output);
        
    } catch (error) {
        console.error('Error processing quotes:', error);
        showError(error.message);
    } finally {
        hideLoading('process-quotes', 'Process Quotes');
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

/* Auto-process based on URL parameters */
export function autoProcessThread() {
    const urlParams = new URLSearchParams(window.location.search);
    const postUrl = urlParams.get('url');
    const mode = urlParams.get('mode');
    
    if (postUrl) {
        console.log('Auto-processing thread from URL params:', postUrl, mode);
        
        const urlInput = document.getElementById('url-input');
        if (urlInput) {
            urlInput.value = postUrl;
            
            if (mode === 'quotes') {
                processQuotes();
            } else {
                processReplies();
            }
        }
    }
}
