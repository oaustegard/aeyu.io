/* FILE: bsky-feeds.js - REFACTORED using separated core modules */

import { 
    showError, 
    hideError,
    displayOutput,
    handleFormSubmission,
    autoProcessFromUrlParams
} from './core-html.js';

import { 
    BSKY_PUBLIC_API,
    extractHandleFromUrl,
    detectPostType,
    anonymizePosts,
    fetchBskyPaginatedData,
    fetchBskyPaginatedDataWithFiltering
} from './core-bsky.js';

/* Initialize feed processing */
export function initializeFeedProcessing() {
    console.log('Initializing feed processing...');
    
    setupContentTypeHandlers();
    setupFeedForm();
    updateUIForContentType();
    
    /* Auto-process from URL parameters */
    autoProcessFromUrlParams({
        paramMappings: {
            'url': 'url-input',
            'type': 'content-type-radio',
            'limit': 'limit-select',
            'posts': 'include-posts',
            'reposts': 'include-reposts', 
            'quotes': 'include-quotes'
        },
        uiUpdater: updateUIForContentType,
        autoSubmit: {
            condition: (params) => params.get('url'),
            handler: () => handleFeedSubmission({ preventDefault: () => {} })
        }
    });
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
    
    if (postFilters) {
        postFilters.style.display = selectedType === 'profile' ? 'block' : 'none';
    }
}

/* Handle feed form submission */
async function handleFeedSubmission(e) {
    e.preventDefault();
    
    return handleFormSubmission('process-feed', 'Process Feed', async () => {
        const urlInput = document.getElementById('url-input');
        const limitSelect = document.getElementById('limit-select');
        const contentType = document.querySelector('input[name="content-type"]:checked')?.value;
        
        const url = urlInput?.value?.trim();
        const limit = parseInt(limitSelect?.value || '100');
        
        if (!url) throw new Error('Please enter a URL');
        if (!contentType) throw new Error('Please select a content type');
        
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
            sourceType: 'feed',
            includePostType: true,
            includeAltText: true
        });
        
        console.log(`Feed processing completed: ${anonymizedPosts.length} posts`);
        
        return {
            metadata: {
                ...metadata,
                contentType: contentType,
                totalPosts: anonymizedPosts.length,
                processedAt: new Date().toISOString()
            },
            posts: anonymizedPosts
        };
    });
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
    
    const postFilters = filters || {
        includePosts: true,
        includeReposts: false,
        includeQuotes: false
    };
    
    console.log('Extracted handle:', handle, 'Filters:', postFilters);
    
    const result = await fetchBskyPaginatedDataWithFiltering(
        `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed`,
        { actor: handle },
        (item) => filterFeedItemsByType([item], postFilters).length > 0,
        { 
            limit, 
            dataKey: 'feed',
            requestMultiplier: 2
        }
    );
    
    return {
        posts: result.data,
        metadata: {
            source: url,
            actor: handle,
            feedType: 'profile',
            filters: postFilters,
            totalFetched: result.totalFetched
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
    
    const result = await fetchBskyPaginatedData(
        `${BSKY_PUBLIC_API}/app.bsky.feed.getFeed`,
        { feed: feedUri },
        { 
            limit,
            dataKey: 'feed'
        }
    );
    
    return {
        posts: result.data,
        metadata: {
            source: url,
            feedUri: feedUri,
            feedType: 'custom',
            totalFetched: result.totalFetched
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
    
    const result = await fetchBskyPaginatedData(
        `${BSKY_PUBLIC_API}/app.bsky.feed.getListFeed`,
        { list: listUri },
        { 
            limit,
            dataKey: 'feed'
        }
    );
    
    return {
        posts: result.data,
        metadata: {
            source: url,
            listUri: listUri,
            feedType: 'list',
            totalFetched: result.totalFetched
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
    
    const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.graph.getStarterPack?starterPack=${encodeURIComponent(starterPackUri)}`);
    
    if (!response.ok) {
        throw new Error(`Starter pack API error: ${response.status}`);
    }
    
    const starterPackData = await response.json();
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
    
    let allPosts = [];
    const postsPerUser = Math.ceil(limit / listItems.length);
    
    for (const item of listItems) {
        if (allPosts.length >= limit) break;
        
        const userHandle = item.subject?.handle;
        if (!userHandle) continue;
        
        try {
            console.log(`Fetching posts from user: ${userHandle}`);
            
            const userResult = await fetchBskyPaginatedData(
                `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed`,
                { actor: userHandle },
                { 
                    limit: Math.min(postsPerUser, limit - allPosts.length),
                    dataKey: 'feed'
                }
            );
            
            allPosts.push(...userResult.data);
            console.log(`Added ${userResult.data.length} posts from ${userHandle}`);
            
        } catch (error) {
            console.error(`Failed to fetch posts from ${userHandle}:`, error);
        }
    }
    
    return {
        posts: allPosts.slice(0, limit),
        metadata: {
            source: url,
            starterPackUri: starterPackUri,
            feedType: 'starterpack',
            userCount: listItems.length,
            totalFetched: allPosts.length
        }
    };
}

/* URI extraction functions */
function extractFeedUriFromUrl(url) {
    const match = url.match(/https:\/\/bsky\.app\/profile\/([^\/]+)\/feed\/([^\/\?]+)/);
    if (match) {
        const did = match[1];
        const rkey = match[2];
        return `at://${did}/app.bsky.feed.generator/${rkey}`;
    }
    return null;
}

function extractListUriFromUrl(url) {
    const match = url.match(/https:\/\/bsky\.app\/profile\/([^\/]+)\/lists\/([^\/\?]+)/);
    if (match) {
        const handle = match[1];
        const rkey = match[2];
        return `at://${handle}/app.bsky.graph.list/${rkey}`;
    }
    return null;
}

function extractStarterPackUriFromUrl(url) {
    let match = url.match(/https:\/\/bsky\.app\/starter-pack\/([^\/]+)\/([^\/\?]+)/);
    if (match) {
        const creator = match[1];
        const rkey = match[2];
        return `at://${creator}/app.bsky.graph.starterpack/${rkey}`;
    }
    
    match = url.match(/https:\/\/bsky\.app\/starter-pack-short\/([^\/\?]+)/);
    if (match) {
        throw new Error('Short starter pack URLs are not supported. Please use the full URL format.');
    }
    
    return null;
}

/* Legacy function for compatibility */
export function autoProcessFeed() {
    console.log('autoProcessFeed() called - functionality now handled by core autoProcessFromUrlParams()');
}
