/* Thread processing functionality for replies - FIXED VERSION */

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
    extractAltText,
    resolveHandleToDid,
    fetchOriginalPost,
    buildPostUri
} from './bsky-core.js';

const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

/* Find quotes using the proper getQuotes API */
async function findQuotesUsingGetQuotesAPI(postUri) {
    console.log('Finding quotes using app.bsky.feed.getQuotes API:', postUri);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getQuotes?uri=${encodeURIComponent(postUri)}&limit=100`);
        
        if (!response.ok) {
            console.error(`getQuotes API failed: ${response.status}`);
            /* If getQuotes fails, fall back to search method */
            return await findQuotesViaSearch(postUri);
        }
        
        const data = await response.json();
        const quotes = data.posts || [];
        
        console.log(`Found ${quotes.length} quotes via getQuotes API`);
        return quotes;
        
    } catch (error) {
        console.error('getQuotes API error:', error);
        /* Fallback to search method */
        return await findQuotesViaSearch(postUri);
    }
}

/* Fallback search method for quotes */
async function findQuotesViaSearch(postUri) {
    console.log('Falling back to search method for quotes:', postUri);
    
    try {
        /* Extract post ID for search */
        const postIdMatch = postUri.match(/\/app\.bsky\.feed\.post\/(.+)$/);
        if (!postIdMatch) {
            console.error('Could not extract post ID from URI');
            return [];
        }
        
        const postId = postIdMatch[1];
        const searchQuery = postId.substring(0, 12); /* Use partial post ID */
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery)}&limit=100`);
        
        if (!response.ok) {
            console.error('Search fallback also failed');
            return [];
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        /* Filter for posts that actually embed/quote the target post */
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
        
        /* Build the post URI with DID resolution */
        const postUri = await buildPostUri(handle, postId);
        
        /* Fetch the original post */
        const originalPost = await fetchOriginalPost(postUri);
        
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
        
        /* Structure output similar to user's example */
        const output = {
            root: originalPost ? anonymizePost(originalPost, {
                includePostType: false,
                includeAltText: true,
                index: 0
            }) : {
                id: 1,
                text: '[Original post could not be fetched]',
                error: 'Failed to fetch original post'
            },
            replies: anonymizedReplies,
            metadata: {
                originalPost: postUri,
                totalReplies: anonymizedReplies.length,
                processedAt: new Date().toISOString()
            }
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
        
        /* Build the post URI with DID resolution */
        const postUri = await buildPostUri(handle, postId);
        
        console.log('Searching for quotes of post:', postUri);
        
        /* Fetch the original post */
        const originalPost = await fetchOriginalPost(postUri);
        
        /* Get quotes using the proper API */
        const quotes = await findQuotesUsingGetQuotesAPI(postUri);
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search', /* Quotes are direct post objects */
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        /* Structure output similar to user's example */
        const output = {
            root: originalPost ? anonymizePost(originalPost, {
                includePostType: false,
                includeAltText: true,
                index: 0
            }) : {
                id: 1,
                text: '[Original post could not be fetched]',
                error: 'Failed to fetch original post'
            },
            quotePosts: anonymizedQuotes,
            metadata: {
                originalPost: postUri,
                totalQuotes: anonymizedQuotes.length,
                processedAt: new Date().toISOString()
            }
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
