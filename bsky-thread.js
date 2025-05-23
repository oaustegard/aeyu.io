/* Thread processing functionality for replies */

import { 
    parsePostUrl, 
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput 
} from './bsky-core.js';

const BSKY_API_BASE = 'https://bsky.social/xrpc';

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
        
        /* Get the original post to find its URI */
        const postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        
        /* Fetch replies using the Bluesky API */
        const response = await fetch(`${BSKY_API_BASE}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=10&parentHeight=0`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch post thread: ${response.status}`);
        }
        
        const threadData = await response.json();
        console.log('Thread data received:', threadData);
        
        /* Extract and anonymize replies */
        const replies = extractReplies(threadData.thread);
        const anonymizedReplies = anonymizeReplies(replies);
        
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
        
        /* For quotes, we need to search for posts that quote this specific post */
        const postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        
        /* This is a placeholder - the actual Bluesky API for finding quotes may differ */
        /* For now, we'll simulate the structure */
        const quotes = await fetchQuotes(postUri);
        const anonymizedQuotes = anonymizeQuotes(quotes);
        
        console.log(`Processed ${anonymizedQuotes.length} quotes`);
        
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

/* Anonymize reply data */
function anonymizeReplies(replies) {
    return replies.map((reply, index) => ({
        id: `reply_${index + 1}`,
        text: reply.record?.text || '',
        createdAt: reply.record?.createdAt || '',
        likeCount: reply.likeCount || 0,
        replyCount: reply.replyCount || 0,
        repostCount: reply.repostCount || 0,
        hasMedia: !!(reply.record?.embed),
        hasLinks: !!(reply.record?.facets?.some(f => f.features?.some(feat => feat.$type === 'app.bsky.richtext.facet#link')))
    }));
}

/* Fetch quotes for a post (placeholder implementation) */
async function fetchQuotes(postUri) {
    console.log('Fetching quotes for:', postUri);
    
    /* This would require a more complex API call or search */
    /* For now, return empty array as placeholder */
    return [];
}

/* Anonymize quote data */
function anonymizeQuotes(quotes) {
    return quotes.map((quote, index) => ({
        id: `quote_${index + 1}`,
        text: quote.record?.text || '',
        createdAt: quote.record?.createdAt || '',
        likeCount: quote.likeCount || 0,
        replyCount: quote.replyCount || 0,
        repostCount: quote.repostCount || 0,
        hasMedia: !!(quote.record?.embed),
        hasLinks: !!(quote.record?.facets?.some(f => f.features?.some(feat => feat.$type === 'app.bsky.richtext.facet#link')))
    }));
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
