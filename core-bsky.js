/* Core Bluesky API functionality - separated from generic HTML utilities */

import { fetchPaginatedData, fetchPaginatedDataWithFiltering } from './core-html.js';

/* ===== AUTHENTICATION STATE ===== */

let authToken = null;
let userProfile = null;

/* ===== API ENDPOINTS ===== */

const BSKY_API_BASE = 'https://bsky.social/xrpc';
const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

/* ===== AUTHENTICATION FUNCTIONS ===== */

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

/* ===== AUTHENTICATION HEADER BUILDER ===== */

export function getApiHeaders(requireAuth = false) {
    const headers = {};
    const token = getAuthToken();
    
    if (requireAuth && !token) {
        throw new Error('Authentication required but no token available');
    }
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
}

/* ===== BLUESKY API UTILITIES ===== */

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

export function extractDidFromUri(uri) {
    console.log('Extracting DID from URI:', uri);
    
    const match = uri.match(/^at:\/\/([^\/]+)/);
    return match ? match[1] : null;
}

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

/* ===== BLUESKY-SPECIFIC PAGINATION WRAPPERS ===== */

export async function fetchBskyPaginatedData(endpoint, baseParams, options = {}) {
    const bskyOptions = {
        headers: getApiHeaders(options.authRequired),
        dataKey: options.dataKey || 'posts',
        cursorKey: 'cursor',
        ...options
    };
    
    return fetchPaginatedData(endpoint, baseParams, bskyOptions);
}

export async function fetchBskyPaginatedDataWithFiltering(endpoint, baseParams, filter, options = {}) {
    const bskyOptions = {
        headers: getApiHeaders(options.authRequired),
        dataKey: options.dataKey || 'posts',
        cursorKey: 'cursor',
        ...options
    };
    
    return fetchPaginatedDataWithFiltering(endpoint, baseParams, filter, bskyOptions);
}

/* ===== POST PROCESSING FUNCTIONS ===== */

export function extractPostFromItem(item, sourceType = 'feed') {
    console.log('Extracting post from item, source type:', sourceType);
    
    switch (sourceType) {
        case 'feed':
            return item.post;
        case 'search':
            return item;
        case 'thread':
            return item.post;
        default:
            console.warn('Unknown source type:', sourceType);
            return item.post || item;
    }
}

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
            const parentDID = parentURI.split('/')[2];
            if (authorDID === parentDID) {
                return 'thread';
            }
        }
        return 'reply';
    }
    
    return 'original';
}

export function extractAltText(embed) {
    console.log('Extracting alt text from embed:', embed?.$type);
    
    if (!embed) return [];
    
    const altTexts = [];
    
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
            break;
    }
    
    return altTexts;
}

export function hasMedia(post) {
    const embed = post.record?.embed;
    if (!embed) return false;
    
    if (embed.$type === 'app.bsky.embed.images' || 
        embed.$type === 'app.bsky.embed.external' ||
        embed.$type === 'app.bsky.embed.recordWithMedia') {
        return true;
    }
    
    if (embed.$type === 'app.bsky.embed.record') {
        return false;
    }
    
    return false;
}

export function hasLinks(post) {
    const facets = post.record?.facets;
    if (!facets) return false;
    
    return facets.some(facet => 
        facet.features?.some(feature => 
            feature.$type === 'app.bsky.richtext.facet#link'
        )
    );
}

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
    
    if (post.quoteCount !== undefined) {
        anonymized.quoteCount = post.quoteCount;
    }
    
    if (includePostType) {
        anonymized.postType = postType || detectPostType(post, feedItem);
    }
    
    if (includeAltText) {
        const altTexts = extractAltText(post.record?.embed);
        if (altTexts.length > 0) {
            anonymized.altText = altTexts;
        }
        
        const viewAltTexts = extractAltText(post.embed);
        if (viewAltTexts.length > 0) {
            anonymized.altText = anonymized.altText ? 
                [...anonymized.altText, ...viewAltTexts] : viewAltTexts;
        }
    }
    
    if (includeQuotedSnippet && anonymized.postType === 'quote') {
        const snippet = extractQuotedTextSnippet(post.record?.embed);
        if (snippet) {
            anonymized.quotedPostSnippet = snippet;
        }
    }
    
    return anonymized;
}

function extractQuotedTextSnippet(embed) {
    if (!embed) return null;
    
    let quotedText = null;
    
    if (embed.$type === 'app.bsky.embed.record') {
        quotedText = embed.record?.value?.text;
    } else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
        quotedText = embed.record?.record?.value?.text;
    }
    
    if (quotedText) {
        return quotedText.length > 100 ? quotedText.substring(0, 100) + '...' : quotedText;
    }
    
    return null;
}

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

/* ===== STANDARD OUTPUT BUILDER ===== */

export function buildStandardOutput(rootPost, childData, metadata = {}) {
    const output = {
        metadata: {
            processedAt: new Date().toISOString(),
            ...metadata
        }
    };
    
    if (rootPost) {
        output.root = anonymizePost(rootPost, {
            includePostType: false,
            includeAltText: true,
            index: 0
        });
    }
    
    if (metadata.childDataKey && childData) {
        output[metadata.childDataKey] = childData;
    }
    
    return output;
}

/* ===== ORIGINAL POST FETCHER ===== */

export async function fetchOriginalPost(postUri) {
    console.log('Fetching original post:', postUri);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getPosts?uris=${encodeURIComponent(postUri)}`);
        
        if (response.ok) {
            const data = await response.json();
            if (data.posts && data.posts.length > 0) {
                console.log('Successfully fetched original post via getPosts');
                return data.posts[0];
            }
        }
        
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

/* ===== INITIALIZATION ===== */

export function initializeBskyCore() {
    console.log('Initializing Bluesky core...');
    checkStoredAuth();
    return true;
}

function checkStoredAuth() {
    console.log('Checking for stored authentication...');
}

/* ===== EXPORTS ===== */

export { BSKY_API_BASE, BSKY_PUBLIC_API };
