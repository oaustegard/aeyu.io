/* FILE: bsky-thread.js - REFACTORED with FIXED THREADING */

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
    anonymizePost,
    safeGetCreatedAt,
    extractPostFromItem
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
        
        /* Process thread hierarchically instead of flattening */
        const processedThread = processThreadNode(threadData.thread, rootTime);
        const replies = extractRepliesFromProcessedNode(processedThread);
        
        console.log(`Processed ${replies.length} replies with hierarchical structure`);
        
        return buildStandardOutput(originalPost, replies, {
            originalPost: postUri,
            totalReplies: replies.length,
            childDataKey: 'replies'
        });
    });
}

/* Process a thread node recursively, maintaining hierarchical structure */
function processThreadNode(node, rootTime) {
    console.log('Processing thread node:', node?.post?.uri);
    
    if (!node?.post) {
        console.log('Invalid node - no post data');
        return null;
    }
    
    /* Extract and anonymize the post */
    const post = extractPostFromItem(node.post, 'thread');
    if (!post) {
        console.log('Failed to extract post from node');
        return null;
    }
    
    const anonymizedPost = anonymizePost(post, {
        includePostType: false,
        includeAltText: true,
        rootTime: rootTime
    });
    
    /* Process replies if they exist */
    if (node.replies && Array.isArray(node.replies) && node.replies.length > 0) {
        console.log(`Processing ${node.replies.length} replies for post ${anonymizedPost.id}`);
        
        /* Filter out invalid replies and sort chronologically */
        const validReplies = node.replies
            .filter(reply => {
                const hasContent = reply?.post?.record?.text || reply?.post?.record?.embed;
                const hasTime = reply?.post?.record?.createdAt;
                if (!hasContent || !hasTime) {
                    console.log('Filtering out invalid reply:', reply?.post?.uri);
                }
                return hasContent && hasTime;
            })
            .sort((a, b) => {
                const timeA = safeGetCreatedAt(a.post);
                const timeB = safeGetCreatedAt(b.post);
                return timeA - timeB; /* Chronological order */
            });
        
        console.log(`Sorted ${validReplies.length} valid replies chronologically`);
        
        /* Recursively process each reply */
        const processedReplies = validReplies
            .map(reply => processThreadNode(reply, rootTime))
            .filter(Boolean);
        
        if (processedReplies.length > 0) {
            anonymizedPost.replies = processedReplies;
            console.log(`Added ${processedReplies.length} processed replies to post ${anonymizedPost.id}`);
        }
    }
    
    return anonymizedPost;
}

/* Extract all replies from a processed hierarchical node into a flat array */
/* This maintains the chronological threading while providing a flat structure for counting */
function extractRepliesFromProcessedNode(processedNode) {
    const allReplies = [];
    
    function collectReplies(node) {
        if (node.replies && Array.isArray(node.replies)) {
            for (const reply of node.replies) {
                allReplies.push(reply);
                collectReplies(reply); /* Recursively collect nested replies */
            }
        }
    }
    
    collectReplies(processedNode);
    return allReplies;
}

/* Legacy function for compatibility */
export function autoProcessThread() {
    console.log('autoProcessThread() called - functionality now handled by core autoProcessFromUrlParams()');
}
