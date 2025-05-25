/* FILE: bsky-feeds.js */
/* Feed processing functionality for Bluesky content with post type filtering - REFACTORED */

import { 
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput,
    extractPostFromItem,
    detectPostType,
    anonymizePost,
    anonymizePosts,
    extractHandleFromUrl
} from './bsky-core.js';

const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

/* Initialize feed processing */
export function initializeFeedProcessing() {
    console.log('Initializing feed processing...');
    
    setupContentTypeHandlers();
    setupFeedForm();
    updateUIForContentType();
}

/* Set up content type radio button handlers */
function setupContentTypeHandlers() {
    const contentTypeRadios = document.querySelectorAll('input[name="content-type"]');
    
    contentTypeRadios.forEach(radio => {
        radio.addEventListener('change', updateUIForContentType);
    });
}

/* Set up feed form submission */
function setupFeedForm() {
    const feedForm = document.getElementById('feed-form');
    
    if (feedForm) {
        feedForm.addEventListener('submit', handleFeedSubmission);
    }
}

/* Update UI based on selected content type */
function updateUIForContentType() {
    const selectedType = document.querySelector('input[name="content-type"]:checked')?.value;
    const urlLabel = document.getElementById('url-label');
    const urlInput = document.getElementById('url-input');
    const urlHelp = document.getElementById('url-help');
    const postFilters = document.getElementById('post-filters');
    
    const typeConfig = {
        profile: {
            label: 'Bluesky Profile URL',
            placeholder: 'https://bsky.app/profile/username.bsky.social',
            help: 'Enter a user profile URL'
        },
        feed: {
            label: 'Custom Feed URL',
            placeholder: 'https://bsky.app/profile/did:plc:*/feed/*',
            help: 'Enter a custom feed URL'
        },
        list: {
            label: 'List URL',
            placeholder: 'https://bsky.app/profile/*/lists/*',
            help: 'Enter a Bluesky list URL'
        },
        starterpack: {
            label: 'Starter Pack URL',
            placeholder: 'https://bsky.app/starter-pack/*',
            help: 'Enter a starter pack URL'
        }
    };
    
    const config = typeConfig[selectedType] || typeConfig.profile;
    
    if (urlLabel) urlLabel.textContent = config.label;
    if (urlInput) urlInput.placeholder = config.placeholder;
    if (urlHelp) urlHelp.textContent = config.help;
    
    /* Show/hide post filters based on content type */
    if (postFilters) {
        postFilters.style.display = selectedType === 'profile' ? 'block' : 'none';
    }
}

/* Handle feed form submission */
async function handleFeedSubmission(e) {
    e.preventDefault();
    console.log('Handling feed submission...');
    hideError();
    
    const urlInput = document.getElementById('url-input');
    const limitSelect = document.getElementById('limit-select');
    const contentType = document.querySelector('input[name="content-type"]:checked')?.value;
    
    const url = urlInput?.value?.trim();
    const limit = parseInt(limitSelect?.value || '100');
    
    if (!url) {
        showError('Please enter a URL');
        return;
    }
    
    if (!contentType) {
        showError('Please select a content type');
        return;
    }
    
    try {
        showLoading('process-feed');
        
        console.log(`Processing ${contentType} feed: ${url} (limit: ${limit})`);
        
        let posts = [];
        let metadata = {};
        
        switch (contentType) {
            case 'profile':
                const filters = {
                    includePosts: document.getElementById('include-posts')?.checked ?? true,
                    includeReposts: document.getElementById('include-reposts')?.checked ?? false,
                    includeQuotes: document.getElementById('include-quotes')?.checked ?? false
                };
                ({ posts, metadata } = await processProfileFeed(url, limit, filters));
                break;
            case 'feed':
                ({ posts, metadata } = await processCustomFeed(url, limit));
                break;
            case 'list':
                ({ posts, metadata } = await processListFeed(url, limit));
                break;
            case 'starterpack':
                ({ posts, metadata } = await processStarterPackFeed(url, limit));
                break;
            default:
                throw new Error('Invalid content type selected');
        }
        
        const anonymizedPosts = anonymizePosts(posts, {
            sourceType: 'feed', /* All feed endpoints use feed structure */
            includePostType: true,
            includeAltText: true
        });
        
        console.log(`Feed processing completed: ${anonymizedPosts.length} posts`);
        
        const output = {
            metadata: {
                ...metadata,
                contentType: contentType,
                totalPosts: anonymizedPosts.length,
                processedAt: new Date().toISOString()
            },
            posts: anonymizedPosts
        };
        
        displayOutput(output);
        
    } catch (error) {
        console.error('Feed processing error:', error);
        showError(error.message);
    } finally {
        hideLoading('process-feed', 'Process Feed');
    }
}

/* Filter feed items by type based on user selection */
function filterFeedItemsByType(feedItems, filters) {
    return feedItems.filter(item => {
        const postType = detectPostType(item.post, item);
        
        if (postType === 'repost' && filters.includeReposts) return true;
        if (postType === 'quote' && filters.includeQuotes) return true;
        if ((postType === 'original' || postType === 'thread') && filters.includePosts) return true;
        
        return false;
    });
}

/* Process user profile feed */
async function processProfileFeed(url, limit, filters = null) {
    console.log('Processing profile feed...');
    
    const handle = extractHandleFromUrl(url);
    if (!handle) {
        throw new Error('Invalid profile URL format');
    }
    
    console.log('Extracted handle:', handle);
    
    /* Default filters if not provided */
    const postFilters = filters || {
        includePosts: true,
        includeReposts: false,
        includeQuotes: false
    };
    
    console.log('Post filters:', postFilters);
    
    let allPosts = [];
    let cursor = null;
    const batchSize = Math.min(limit, 100);
    /* Request more than needed since we'll be filtering */
    const requestMultiplier = 2;
    
    while (allPosts.length < limit) {
        const remainingLimit = limit - allPosts.length;
        const currentBatchSize = Math.min(batchSize * requestMultiplier, 100);
        
        console.log(`Fetching profile batch: ${allPosts.length + 1}-${allPosts.length + currentBatchSize}`);
        
        const params = new URLSearchParams({
            actor: handle,
            limit: currentBatchSize.toString()
        });
        
        if (cursor) {
            params.append('cursor', cursor);
        }
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?${params}`);
        
        if (!response.ok) {
            throw new Error(`Profile feed API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`API response: ${data.feed?.length || 0} posts returned`);
        
        if (!data.feed || data.feed.length === 0) {
            console.log('No more posts available');
            break;
        }
        
        /* Filter posts based on type - pass full feed items and preserve type info */
        const filteredBatch = filterFeedItemsByType(data.feed, postFilters);
        console.log(`Filtered batch: ${filteredBatch.length}/${data.feed.length} posts matched filters`);
        
        allPosts.push(...filteredBatch);
        cursor = data.cursor;
        
        if (!cursor) {
            console.log('No more pages available');
            break;
        }
        
        /* If we have enough posts after filtering, break */
        if (allPosts.length >= limit) {
            break;
        }
    }
    
    return {
        posts: allPosts.slice(0, limit),
        metadata: {
            source: url,
            actor: handle,
            feedType: 'profile',
            filters: postFilters
        }
    };
}

/* Process custom feed */
async function processCustomFeed(url, limit) {
    console.log('Processing custom feed...');
    
    const feedUri = extractFeedUriFromUrl(url);
    if (!feedUri) {
        throw new Error('Invalid custom feed URL format');
    }
    
    console.log('Extracted feed URI:', feedUri);
    
    let allPosts = [];
    let cursor = null;
    const batchSize = Math.min(limit, 100);
    
    while (allPosts.length < limit) {
        const remainingLimit = limit - allPosts.length;
        const currentBatchSize = Math.min(batchSize, remainingLimit);
        
        console.log(`Fetching feed batch: ${allPosts.length + 1}-${allPosts.length + currentBatchSize}`);
        
        const params = new URLSearchParams({
            feed: feedUri,
            limit: currentBatchSize.toString()
        });
        
        if (cursor) {
            params.append('cursor', cursor);
        }
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getFeed?${params}`);
        
        if (!response.ok) {
            throw new Error(`Custom feed API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`API response: ${data.feed?.length || 0} posts returned`);
        
        if (!data.feed || data.feed.length === 0) {
            console.log('No more posts available');
            break;
        }
        
        allPosts.push(...data.feed);
        cursor = data.cursor;
        
        if (!cursor) {
            console.log('No more pages available');
            break;
        }
    }
    
    return {
        posts: allPosts.slice(0, limit),
        metadata: {
            source: url,
            feedUri: feedUri,
            feedType: 'custom'
        }
    };
}

/* Process list feed */
async function processListFeed(url, limit) {
    console.log('Processing list feed...');
    
    const listUri = extractListUriFromUrl(url);
    if (!listUri) {
        throw new Error('Invalid list URL format');
    }
    
    console.log('Extracted list URI:', listUri);
    
    let allPosts = [];
    let cursor = null;
    const batchSize = Math.min(limit, 100);
    
    while (allPosts.length < limit) {
        const remainingLimit = limit - allPosts.length;
        const currentBatchSize = Math.min(batchSize, remainingLimit);
        
        console.log(`Fetching list batch: ${allPosts.length + 1}-${allPosts.length + currentBatchSize}`);
        
        const params = new URLSearchParams({
            list: listUri,
            limit: currentBatchSize.toString()
        });
        
        if (cursor) {
            params.append('cursor', cursor);
        }
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getListFeed?${params}`);
        
        if (!response.ok) {
            throw new Error(`List feed API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`API response: ${data.feed?.length || 0} posts returned`);
        
        if (!data.feed || data.feed.length === 0) {
            console.log('No more posts available');
            break;
        }
        
        allPosts.push(...data.feed);
        cursor = data.cursor;
        
        if (!cursor) {
            console.log('No more pages available');
            break;
        }
    }
    
    return {
        posts: allPosts.slice(0, limit),
        metadata: {
            source: url,
            listUri: listUri,
            feedType: 'list'
        }
    };
}

/* Process starter pack feed */
async function processStarterPackFeed(url, limit) {
    console.log('Processing starter pack feed...');
    
    const starterPackUri = extractStarterPackUriFromUrl(url);
    if (!starterPackUri) {
        throw new Error('Invalid starter pack URL format');
    }
    
    console.log('Extracted starter pack URI:', starterPackUri);
    
    /* First, get the starter pack info */
    const params = new URLSearchParams({
        starterPack: starterPackUri
    });
    
    const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.graph.getStarterPack?${params}`);
    
    if (!response.ok) {
        throw new Error(`Starter pack API error: ${response.status}`);
    }
    
    const starterPackData = await response.json();
    console.log('Starter pack data:', starterPackData);
    
    const listItems = starterPackData.starterPack?.list?.listItemsSample || [];
    console.log(`Found ${listItems.length} users in starter pack`);
    
    if (listItems.length === 0) {
        return {
            posts: [],
            metadata: {
                source: url,
                starterPackUri: starterPackUri,
                feedType: 'starterpack',
                userCount: 0
            }
        };
    }
    
    /* Get posts from each user in the starter pack */
    let allPosts = [];
    const postsPerUser = Math.ceil(limit / listItems.length);
    
    for (const item of listItems) {
        if (allPosts.length >= limit) break;
        
        const userHandle = item.subject?.handle;
        if (!userHandle) continue;
        
        try {
            console.log(`Fetching posts from user: ${userHandle}`);
            
            const userParams = new URLSearchParams({
                actor: userHandle,
                limit: Math.min(postsPerUser, limit - allPosts.length).toString()
            });
            
            const userResponse = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?${userParams}`);
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                const userPosts = userData.feed || [];
                allPosts.push(...userPosts);
                console.log(`Added ${userPosts.length} posts from ${userHandle}`);
            }
        } catch (error) {
            console.error(`Failed to fetch posts from ${userHandle}:`, error);
            /* Continue with other users */
        }
    }
    
    return {
        posts: allPosts.slice(0, limit),
        metadata: {
            source: url,
            starterPackUri: starterPackUri,
            feedType: 'starterpack',
            userCount: listItems.length
        }
    };
}

/* Extract feed URI from feed URL */
function extractFeedUriFromUrl(url) {
    /* Pattern: https://bsky.app/profile/{did}/feed/{rkey} */
    const match = url.match(/https:\/\/bsky\.app\/profile\/([^\/]+)\/feed\/([^\/\?]+)/);
    if (match) {
        const did = match[1];
        const rkey = match[2];
        return `at://${did}/app.bsky.feed.generator/${rkey}`;
    }
    
    return null;
}

/* Extract list URI from list URL */
function extractListUriFromUrl(url) {
    /* Pattern: https://bsky.app/profile/{handle}/lists/{rkey} */
    const match = url.match(/https:\/\/bsky\.app\/profile\/([^\/]+)\/lists\/([^\/\?]+)/);
    if (match) {
        const handle = match[1];
        const rkey = match[2];
        /* Note: We'll need to resolve handle to DID for proper AT URI */
        /* For now, try with handle and let the API handle resolution */
        return `at://${handle}/app.bsky.graph.list/${rkey}`;
    }
    
    return null;
}

/* Extract starter pack URI from starter pack URL */
function extractStarterPackUriFromUrl(url) {
    /* Pattern: https://bsky.app/starter-pack/{creator}/{rkey} or https://bsky.app/starter-pack-short/{code} */
    
    /* Long format */
    let match = url.match(/https:\/\/bsky\.app\/starter-pack\/([^\/]+)\/([^\/\?]+)/);
    if (match) {
        const creator = match[1];
        const rkey = match[2];
        return `at://${creator}/app.bsky.graph.starterpack/${rkey}`;
    }
    
    /* Short format - these need special handling, but for now return the full URL */
    match = url.match(/https:\/\/bsky\.app\/starter-pack-short\/([^\/\?]+)/);
    if (match) {
        /* Short URLs need to be resolved differently */
        /* For now, return null and let the user use the full format */
        throw new Error('Short starter pack URLs are not supported. Please use the full URL format.');
    }
    
    return null;
}

/* Auto-process feed based on URL parameters */
export function autoProcessFeed() {
    const urlParams = new URLSearchParams(window.location.search);
    const feedUrl = urlParams.get('url');
    const contentType = urlParams.get('type');
    const limit = urlParams.get('limit');
    const includePosts = urlParams.get('posts');
    const includeReposts = urlParams.get('reposts');
    const includeQuotes = urlParams.get('quotes');
    
    if (feedUrl) {
        console.log('Auto-processing feed from URL params:', feedUrl, contentType);
        
        const urlInput = document.getElementById('url-input');
        if (urlInput) {
            urlInput.value = feedUrl;
        }
        
        if (contentType && ['profile', 'feed', 'list', 'starterpack'].includes(contentType)) {
            const typeRadio = document.querySelector(`input[name="content-type"][value="${contentType}"]`);
            if (typeRadio) {
                typeRadio.checked = true;
                updateUIForContentType();
            }
        }
        
        if (limit) {
            const limitSelect = document.getElementById('limit-select');
            if (limitSelect) {
                limitSelect.value = limit;
            }
        }
        
        /* Set filter checkboxes for profile type */
        if (contentType === 'profile') {
            if (includePosts !== null) {
                const postsCheckbox = document.getElementById('include-posts');
                if (postsCheckbox) postsCheckbox.checked = includePosts === 'true';
            }
            if (includeReposts !== null) {
                const repostsCheckbox = document.getElementById('include-reposts');
                if (repostsCheckbox) repostsCheckbox.checked = includeReposts === 'true';
            }
            if (includeQuotes !== null) {
                const quotesCheckbox = document.getElementById('include-quotes');
                if (quotesCheckbox) quotesCheckbox.checked = includeQuotes === 'true';
            }
        }
        
        /* Auto-submit after a short delay to allow UI updates */
        setTimeout(() => {
            const feedForm = document.getElementById('feed-form');
            if (feedForm) {
                handleFeedSubmission({ preventDefault: () => {} });
            }
        }, 100);
    }
}
