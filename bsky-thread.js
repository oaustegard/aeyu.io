/* FILE: bsky-thread.js - REFACTORED using separated core modules with FIXED THREADING */

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
        
        /* Validate thread data structure */
        if (!threadData?.thread) {
            throw new Error('Invalid thread data: missing thread object');
        }
        
        /* Process the flat replies array into hierarchical structure */
        const processedReplies = processFlatReplies(threadData.thread.replies || [], rootTime);
        
        console.log(`Processed ${processedReplies.length} top-level replies with hierarchical structure`);
        
        /* Get total count including nested replies */
        const totalReplyCount = countAllReplies(processedReplies);
        
        return buildStandardOutput(originalPost, processedReplies, {
            originalPost: postUri,
            totalReplies: totalReplyCount,
            childDataKey: 'replies'
        });
    });
}

/* Process flat replies array into hierarchical structure with chronological sorting */
function processFlatReplies(flatReplies, rootTime) {
    console.log(`Processing ${flatReplies.length} flat replies into hierarchical structure`);
    
    if (!flatReplies || flatReplies.length === 0) {
        return [];
    }
    
    /* Build a map of all posts by URI for quick lookup */
    const postMap = new Map();
    const rootUri = getRootUriFromReplies(flatReplies);
    
    /* Process each reply and build the lookup map */
    flatReplies.forEach(replyItem => {
        if (!replyItem?.post) return;
        
        const post = extractPostFromItem(replyItem.post, 'thread');
        if (!post) return;
        
        const anonymizedPost = anonymizePost(post, {
            includePostType: false,
            includeAltText: true,
            rootTime: rootTime
        });
        
        /* Add metadata for hierarchy building */
        anonymizedPost._uri = replyItem.post.uri;
        anonymizedPost._parentUri = replyItem.post.record?.reply?.parent?.uri || rootUri;
        anonymizedPost._createdAt = safeGetCreatedAt(replyItem.post);
        anonymizedPost.replies = []; /* Initialize empty replies array */
        
        postMap.set(replyItem.post.uri, anonymizedPost);
    });
    
    console.log(`Built post map with ${postMap.size} entries`);
    
    /* Build hierarchical structure by linking children to parents */
    const topLevelReplies = [];
    
    postMap.forEach(post => {
        const parentUri = post._parentUri;
        
        if (parentUri === rootUri) {
            /* This is a top-level reply */
            topLevelReplies.push(post);
        } else {
            /* This is a nested reply - find its parent */
            const parentPost = postMap.get(parentUri);
            if (parentPost) {
                parentPost.replies.push(post);
            } else {
                /* Parent not found - treat as top-level */
                console.log(`Parent not found for ${post._uri}, treating as top-level`);
                topLevelReplies.push(post);
            }
        }
    });
    
    /* Sort all reply arrays chronologically (recursive) */
    function sortRepliesChronologically(replies) {
        replies.sort((a, b) => a._createdAt - b._createdAt);
        replies.forEach(reply => {
            if (reply.replies && reply.replies.length > 0) {
                sortRepliesChronologically(reply.replies);
            }
        });
    }
    
    sortRepliesChronologically(topLevelReplies);
    
    /* Clean up internal metadata before returning */
    function cleanupMetadata(replies) {
        replies.forEach(reply => {
            delete reply._uri;
            delete reply._parentUri;
            delete reply._createdAt;
            if (reply.replies && reply.replies.length > 0) {
                cleanupMetadata(reply.replies);
            }
        });
    }
    
    cleanupMetadata(topLevelReplies);
    
    console.log(`Built hierarchical structure with ${topLevelReplies.length} top-level replies`);
    return topLevelReplies;
}

/* Get the root URI from the first reply's root reference */
function getRootUriFromReplies(replies) {
    if (replies.length > 0 && replies[0]?.post?.record?.reply?.root?.uri) {
        return replies[0].post.record.reply.root.uri;
    }
    return null;
}

/* Count total replies including nested ones */
function countAllReplies(replies) {
    let count = 0;
    
    function countRecursive(replyArray) {
        replyArray.forEach(reply => {
            count++;
            if (reply.replies && reply.replies.length > 0) {
                countRecursive(reply.replies);
            }
        });
    }
    
    countRecursive(replies);
    return count;
}

/* Legacy function for compatibility */
export function autoProcessThread() {
    console.log('autoProcessThread() called - functionality now handled by core autoProcessFromUrlParams()');
}
