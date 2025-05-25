/* Core Bluesky API functionality - separated from generic HTML utilities */

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

/* ===== BLUESKY-SPECIFIC PAGINATION FUNCTIONS (FIXED) ===== */

export async function fetchBskyPaginatedData(endpoint, baseParams, options = {}) {
    console.log('Starting Bluesky paginated fetch:', endpoint);
    console.log('Base params:', baseParams);
    console.log('Options:', options);
    
    const {
        limit = 100,
        dataKey = 'feed',
        cursorKey = 'cursor',
        headers = {},
        authRequired = false,
        requestMultiplier = 1
    } = options;
    
    /* Get auth headers if needed */
    const apiHeaders = getApiHeaders(authRequired);
    const requestHeaders = { ...apiHeaders, ...headers };
    
    const allData = [];
    let cursor = null;
    let requestCount = 0;
    let totalFetched = 0;
    
    /* Calculate how many items to request per API call */
    const itemsPerRequest = Math.min(100, Math.max(25, Math.ceil(limit * requestMultiplier / 4)));
    
    while (allData.length < limit) {
        requestCount++;
        const remainingNeeded = limit - allData.length;
        const requestLimit = Math.min(itemsPerRequest, remainingNeeded);
        
        console.log(`Request ${requestCount}: fetching ${requestLimit} items (${allData.length}/${limit} collected)`);
        
        /* Build URL - CRITICAL: only include cursor if we have one */
        const url = buildBskyApiUrl(endpoint, {
            ...baseParams,
            limit: requestLimit
        }, cursor);
        
        console.log('Request URL:', url);
        
        try {
            const response = await fetch(url, { headers: requestHeaders });
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Response keys:', Object.keys(data));
            
            const items = data[dataKey] || [];
            const newCursor = data[cursorKey] || null;
            
            console.log(`Received ${items.length} items, cursor: ${newCursor ? 'present' : 'none'}`);
            
            if (items.length === 0) {
                console.log('No more items available, stopping pagination');
                break;
            }
            
            allData.push(...items);
            totalFetched += items.length;
            cursor = newCursor;
            
            /* Stop if we've reached the limit or no cursor for next page */
            if (allData.length >= limit || !cursor) {
                break;
            }
            
        } catch (error) {
            console.error(`Pagination request ${requestCount} failed:`, error);
            throw error;
        }
    }
    
    const finalData = allData.slice(0, limit);
    console.log(`Pagination complete: ${finalData.length} items collected in ${requestCount} requests`);
    
    return {
        data: finalData,
        totalFetched: totalFetched,
        requestCount: requestCount
    };
}

export async function fetchBskyPaginatedDataWithFiltering(endpoint, baseParams, filter, options = {}) {
    console.log('Starting filtered Bluesky paginated fetch:', endpoint);
    console.log('Base params:', baseParams);
    console.log('Options:', options);
    
    const {
        limit = 100,
        dataKey = 'feed',
        cursorKey = 'cursor',
        headers = {},
        authRequired = false,
        requestMultiplier = 2,
        maxRequests = 10
    } = options;
    
    /* Get auth headers if needed */
    const apiHeaders = getApiHeaders(authRequired);
    const requestHeaders = { ...apiHeaders, ...headers };
    
    const allData = [];
    let cursor = null;
    let requestCount = 0;
    let totalFetched = 0;
    
    /* For filtering, we need to fetch more per request since some will be filtered out */
    const itemsPerRequest = Math.min(100, Math.max(50, Math.ceil(limit * requestMultiplier / 3)));
    
    while (allData.length < limit && requestCount < maxRequests) {
        requestCount++;
        
        console.log(`Filtered request ${requestCount}: seeking ${limit - allData.length} more items (${allData.length}/${limit} collected)`);
        
        /* Build URL - CRITICAL: only include cursor if we have one */
        const url = buildBskyApiUrl(endpoint, {
            ...baseParams,
            limit: itemsPerRequest
        }, cursor);
        
        console.log('Request URL:', url);
        
        try {
            const response = await fetch(url, { headers: requestHeaders });
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            const items = data[dataKey] || [];
            const newCursor = data[cursorKey] || null;
            
            console.log(`Received ${items.length} items to filter, cursor: ${newCursor ? 'present' : 'none'}`);
            
            if (items.length === 0) {
                console.log('No more items available, stopping pagination');
                break;
            }
            
            /* Apply filter and collect matching items */
            let matchingItems = 0;
            for (const item of items) {
                if (allData.length >= limit) break;
                
                if (filter(item)) {
                    allData.push(item);
                    matchingItems++;
                }
            }
            
            totalFetched += items.length;
            cursor = newCursor;
            
            console.log(`Found ${matchingItems} matching items from ${items.length} total`);
            
            /* Stop if we've reached the limit or no cursor for next page */
            if (allData.length >= limit || !cursor) {
                break;
            }
            
        } catch (error) {
            console.error(`Filtered pagination request ${requestCount} failed:`, error);
            throw error;
        }
    }
    
    const finalData = allData.slice(0, limit);
    console.log(`Filtered pagination complete: ${finalData.length} items collected in ${requestCount} requests`);
    
    return {
        data: finalData,
        totalFetched: totalFetched,
        requestCount: requestCount
    };
}

/* ===== BLUESKY URL BUILDING HELPER ===== */

function buildBskyApiUrl(endpoint, params, cursor = null) {
    const url = new URL(endpoint);
    
    /* Add all base parameters */
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            url.searchParams.set(key, value);
        }
    });
    
    /* CRITICAL FIX: Only add cursor parameter if we actually have a cursor value */
    /* This prevents sending cursor=undefined or cursor=true on first request */
    if (cursor && typeof cursor === 'string' && cursor.length > 0) {
        url.searchParams.set('cursor', cursor);
    }
    
    return url.toString();
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
