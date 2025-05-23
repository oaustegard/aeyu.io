/* Thread processing functionality for replies */

import { 
    parsePostUrl, 
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput 
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
        
        /* Try to resolve the handle to get proper DID */
        let postUri;
        try {
            const did = await resolveHandleToDid(handle);
            postUri = `at://${did}/app.bsky.feed.post/${postId}`;
        } catch (didError) {
            console.log('DID resolution failed, using handle directly:', didError.message);
            postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        }
        
        /* For quotes, we would need to search for posts that quote this specific post */
        /* This is a more complex operation that may require the search API */
        console.log('Quote processing not yet fully implemented - this requires search functionality');
        
        const output = {
            metadata: {
                originalPost: postUri,
                totalQuotes: 0,
                processedAt: new Date().toISOString(),
                note: 'Quote processing requires authenticated search API'
            },
            quotes: []
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
