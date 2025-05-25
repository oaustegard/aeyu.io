/* Core Bluesky API functionality - UPDATED WITH FIXES */

let authToken = null;
let userProfile = null;

/* API endpoints */
const BSKY_API_BASE = 'https://bsky.social/xrpc';
const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

/* Initialize core functionality */
export async function initializeBskyCore() {
    console.log('Initializing Bluesky core...');
    
    /* Set up copy functionality */
    setupCopyButton();
    
    /* Check for stored auth */
    checkStoredAuth();
    
    return true;
}

/* Authentication functions */
export async function authenticateUser(handle, password) {
    console.log('Attempting authentication for:', handle);
    
    try {
        const response = await fetch(`${BSKY_API_BASE}/com.atproto.server.createSession`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                identifier: handle,
                password: password
            })
        });

        if (!response.ok) {
            throw new Error(`Authentication failed: ${response.status}`);
        }

        const data = await response.json();
        authToken = data.accessJwt;
        userProfile = {
            did: data.did,
            handle: data.handle,
            avatar: data.avatar || '',
            displayName: data.displayName || data.handle
        };

        console.log('Authentication successful for:', userProfile.handle);
        return { success: true, profile: userProfile };
        
    } catch (error) {
        console.error('Authentication error:', error);
        return { success: false, error: error.message };
    }
}

export function logout() {
    console.log('Logging out user');
    authToken = null;
    userProfile = null;
}

export function isAuthenticated() {
    return authToken !== null;
}

export function getCurrentUser() {
    return userProfile;
}

export function getAuthToken() {
    return authToken;
}

/* Utility functions */
export function parsePostUrl(url) {
    console.log('Parsing post URL:', url);
    
    const patterns = [
        /https:\/\/bsky\.app\/profile\/([^\/]+)\/post\/([^\/\?]+)/,
        /https:\/\/staging\.bsky\.app\/profile\/([^\/]+)\/post\/([^\/\?]+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return {
                handle: match[1],
                postId: match[2]
            };
        }
    }
    
    throw new Error('Invalid Bluesky post URL format');
}

export function showError(message) {
    console.error('Error:', message);
    const errorEl = document.getElementById('error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

export function hideError() {
    const errorEl = document.getElementById('error');
    if (errorEl) {
        errorEl.style.display = 'none';
    }
}

export function showLoading(buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="loading"></span>' + button.textContent;
    }
}

export function hideLoading(buttonId, originalText) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = false;
        button.textContent = originalText;
    }
}

export function displayOutput(data, format = 'json') {
    console.log('Displaying output:', typeof data);
    
    const outputEl = document.getElementById('output');
    const actionsEl = document.querySelector('.output-actions');
    
    if (outputEl) {
        let content;
        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
        } else {
            content = data;
        }
        
        outputEl.textContent = content;
        
        if (actionsEl) {
            actionsEl.style.display = 'flex';
        }
    }
}

/* Copy functionality */
function setupCopyButton() {
    const copyButton = document.getElementById('copy-button');
    const copyFeedback = document.getElementById('copy-feedback');
    
    if (copyButton) {
        copyButton.addEventListener('click', async () => {
            const output = document.getElementById('output');
            if (output && output.textContent) {
                try {
                    await navigator.clipboard.writeText(output.textContent);
                    
                    if (copyFeedback) {
                        copyFeedback.style.display = 'block';
                        setTimeout(() => {
                            copyFeedback.style.display = 'none';
                        }, 2000);
                    }
                } catch (error) {
                    console.error('Failed to copy:', error);
                }
            }
        });
    }
}

/* Check for stored authentication (placeholder for future localStorage implementation) */
function checkStoredAuth() {
    /* Future: Check localStorage for saved credentials */
    console.log('Checking for stored authentication...');
}

/* ===== COMMON POST PROCESSING FUNCTIONS ===== */

/* Extract post object from different endpoint structures */
export function extractPostFromItem(item, sourceType = 'feed') {
    console.log('Extracting post from item, source type:', sourceType);
    
    switch (sourceType) {
        case 'feed':
            /* Author feed, custom feed, list feed */
            return item.post;
        case 'search':
            /* Search posts - item IS the post */
            return item;
        case 'thread':
            /* Thread structure */
            return item.post;
        default:
            console.warn('Unknown source type:', sourceType);
            return item.post || item;
    }
}

/* Detect post type with context awareness */
export function detectPostType(post, feedItem = null) {
    console.log('Detecting post type for post:', post.uri);
    
    /* Check for repost (only available in feed items) */
    if (feedItem && feedItem.reason && feedItem.reason.$type === 'app.bsky.feed.defs#reasonRepost') {
        return 'repost';
    }
    
    /* Check for quote post */
    const embed = post.record?.embed;
    if (embed) {
        if (embed.$type === 'app.bsky.embed.record' || embed.$type === 'app.bsky.embed.recordWithMedia') {
            return 'quote';
        }
    }
    
    /* Check for reply */
    const hasReplyField = !!(post.record?.reply);
    if (hasReplyField) {
        /* Check if it's a self-reply (thread continuation) */
        const authorDID = post.author?.did;
        const parentURI = post.record?.reply?.parent?.uri;
        if (authorDID && parentURI) {
            const parentDID = parentURI.split('/')[2]; /* Extract DID from at://DID/... */
            if (authorDID === parentDID) {
                return 'thread'; /* Self-reply is thread continuation */
            }
        }
        return 'reply';
    }
    
    return 'original';
}

/* Extract alt text from various embed structures */
export function extractAltText(embed) {
    console.log('Extracting alt text from embed:', embed?.$type);
    
    if (!embed) return [];
    
    const altTexts = [];
    
    /* Handle different embed types */
    switch (embed.$type) {
        case 'app.bsky.embed.images':
        case 'app.bsky.embed.images#view':
            if (embed.images) {
                embed.images.forEach(img => {
                    if (img.alt) {
                        altTexts.push(img.alt);
                    }
                });
            }
            break;
            
        case 'app.bsky.embed.recordWithMedia':
        case 'app.bsky.embed.recordWithMedia#view':
            if (embed.media && embed.media.images) {
                embed.media.images.forEach(img => {
                    if (img.alt) {
                        altTexts.push(img.alt);
                    }
                });
            }
            break;
            
        default:
            /* Other embed types don't typically have alt text */
            break;
    }
    
    return altTexts;
}

/* Detect if post has media (excluding pure quote embeds) */
export function hasMedia(post) {
    const embed = post.record?.embed;
    if (!embed) return false;
    
    /* Images or external media */
    if (embed.$type === 'app.bsky.embed.images' || 
        embed.$type === 'app.bsky.embed.external' ||
        embed.$type === 'app.bsky.embed.recordWithMedia') {
        return true;
    }
    
    /* Pure quote embed is not considered media */
    if (embed.$type === 'app.bsky.embed.record') {
        return false;
    }
    
    return false;
}

/* Detect if post has links */
export function hasLinks(post) {
    const facets = post.record?.facets;
    if (!facets) return false;
    
    return facets.some(facet => 
        facet.features?.some(feature => 
            feature.$type === 'app.bsky.richtext.facet#link'
        )
    );
}

/* Standardized anonymization function */
export function anonymizePost(post, options = {}) {
    console.log('Anonymizing post:', post.uri);
    
    const {
        includePostType = true,
        includeAltText = true,
        includeQuotedSnippet = false,
        postType = null,
        feedItem = null,
        index = 0
    } = options;
    
    /* Extract basic post data */
    const anonymized = {
        id: `post_${index + 1}`,
        text: post.record?.text || '',
        createdAt: post.record?.createdAt || post.indexedAt || '',
        likeCount: post.likeCount || 0,
        replyCount: post.replyCount || 0,
        repostCount: post.repostCount || 0,
        hasMedia: hasMedia(post),
        hasLinks: hasLinks(post),
        language: post.record?.langs?.[0] || 'unknown'
    };
    
    /* Add quote count if available */
    if (post.quoteCount !== undefined) {
        anonymized.quoteCount = post.quoteCount;
    }
    
    /* Add post type if requested */
    if (includePostType) {
        anonymized.postType = postType || detectPostType(post, feedItem);
    }
    
    /* Add alt text if requested and available */
    if (includeAltText) {
        const altTexts = extractAltText(post.record?.embed);
        if (altTexts.length > 0) {
            anonymized.altText = altTexts;
        }
        
        /* Also check the view embed for alt text */
        const viewAltTexts = extractAltText(post.embed);
        if (viewAltTexts.length > 0) {
            anonymized.altText = anonymized.altText ? 
                [...anonymized.altText, ...viewAltTexts] : viewAltTexts;
        }
    }
    
    /* Add quoted post snippet if requested */
    if (includeQuotedSnippet && anonymized.postType === 'quote') {
        const snippet = extractQuotedTextSnippet(post.record?.embed);
        if (snippet) {
            anonymized.quotedPostSnippet = snippet;
        }
    }
    
    return anonymized;
}

/* Extract snippet from quoted post */
function extractQuotedTextSnippet(embed) {
    if (!embed) return null;
    
    let quotedText = null;
    
    if (embed.$type === 'app.bsky.embed.record') {
        quotedText = embed.record?.value?.text;
    } else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
        quotedText = embed.record?.record?.value?.text;
    }
    
    /* Return first 100 characters as snippet */
    if (quotedText) {
        return quotedText.length > 100 ? quotedText.substring(0, 100) + '...' : quotedText;
    }
    
    return null;
}

/* Extract handle from various URL formats */
export function extractHandleFromUrl(url) {
    console.log('Extracting handle from URL:', url);
    
    const patterns = [
        /https:\/\/bsky\.app\/profile\/([^\/\?]+)/,
        /https:\/\/staging\.bsky\.app\/profile\/([^\/\?]+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }
    
    return null;
}

/* Extract DID from AT URI */
export function extractDidFromUri(uri) {
    console.log('Extracting DID from URI:', uri);
    
    const match = uri.match(/^at:\/\/([^\/]+)/);
    return match ? match[1] : null;
}

/* Resolve a handle to a DID using the public API */
export async function resolveHandleToDid(handle) {
    console.log('Resolving handle to DID:', handle);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
        
        if (!response.ok) {
            throw new Error(`Failed to resolve handle: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Resolved DID:', data.did);
        return data.did;
        
    } catch (error) {
        console.error('Handle resolution error:', error);
        throw error;
    }
}

/* Build a post URI from handle/DID and post ID, with optional DID resolution */
export async function buildPostUri(handle, postId, resolveDid = true) {
    console.log('Building post URI for handle:', handle, 'postId:', postId);
    
    if (resolveDid && !handle.startsWith('did:')) {
        try {
            const did = await resolveHandleToDid(handle);
            const uri = `at://${did}/app.bsky.feed.post/${postId}`;
            console.log('Built DID-based URI:', uri);
            return uri;
        } catch (error) {
            console.log('DID resolution failed, using handle directly:', error.message);
        }
    }
    
    const uri = `at://${handle}/app.bsky.feed.post/${postId}`;
    console.log('Built handle-based URI:', uri);
    return uri;
}

/* Batch anonymize posts with unified options */
export function anonymizePosts(posts, options = {}) {
    console.log('Batch anonymizing posts:', posts.length);
    
    return posts.map((post, index) => {
        const postObj = extractPostFromItem(post, options.sourceType);
        return anonymizePost(postObj, {
            ...options,
            index,
            feedItem: options.sourceType === 'feed' ? post : null
        });
    });
}

/* Fetch original post data - shared utility */
export async function fetchOriginalPost(postUri) {
    console.log('Fetching original post:', postUri);
    
    try {
        /* Try getPosts first - more efficient */
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getPosts?uris=${encodeURIComponent(postUri)}`);
        
        if (response.ok) {
            const data = await response.json();
            if (data.posts && data.posts.length > 0) {
                console.log('Successfully fetched original post via getPosts');
                return data.posts[0];
            }
        }
        
        /* Fallback to getPostThread */
        console.log('getPosts failed, trying getPostThread...');
        const threadResponse = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=0&parentHeight=0`);
        
        if (!threadResponse.ok) {
            throw new Error(`Failed to fetch original post: ${threadResponse.status}`);
        }
        
        const threadData = await threadResponse.json();
        if (threadData.thread?.post) {
            console.log('Successfully fetched original post via getPostThread');
            return threadData.thread.post;
        }
        
        throw new Error('No post data found in response');
        
    } catch (error) {
        console.error('Error fetching original post:', error);
        return null;
    }
}
