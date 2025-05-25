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
    safeGetCreatedAt
} from './core-bsky.js';

/* Initialize thread processing */
export function initializeThreadProcessing() {
    console.log('Initializing thread processing...');
    
    const form = document.getElementById('processor-form');
    const repliesButton = document.getElementById('process-replies');
    
    if (form && repliesButton) {
        repliesButton.addEventListener('click', async (e) => {
            e.preventDefault();
            await processReplies();
        });
    }
    
    /* Auto-process from URL parameters */
    autoProcessFromUrlParams({
        paramMappings: {
            'url': 'url-input'
        },
        autoSubmit: {
            condition: (params) => params.get('url') && !params.get('mode'),
            handler: () => processReplies()
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
        
        /* Get root post time for relative timing */
        const rootTime = safeGetCreatedAt(originalPost);
        console.log('Root post time:', rootTime);
        
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
            includeAltText: true,
            rootTime: rootTime
        });
        
        console.log(`Processed ${anonymizedReplies.length} replies`);
        
        return buildStandardOutput(originalPost, anonymizedReplies, {
            originalPost: postUri,
            totalReplies: anonymizedReplies.length,
            childDataKey: 'replies'
        });
    });
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
