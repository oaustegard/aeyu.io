/* Quote processing functionality for Bluesky posts */

import { 
    parsePostUrl, 
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput,
    getAuthToken 
} from './bsky-core.js';

const BSKY_API_BASE = 'https://bsky.social/xrpc';

/* Process quotes for a specific post */
export async function processQuotes(postUrl) {
    console.log('Processing quotes for post:', postUrl);
    hideError();
    
    if (!postUrl) {
        showError('Please provide a Bluesky post URL');
        return;
    }
    
    try {
        const { handle, postId } = parsePostUrl(postUrl);
        console.log('Parsed URL - Handle:', handle, 'Post ID:', postId);
        
        const postUri = `at://${handle}/app.bsky.feed.post/${postId}`;
        
        /* Find quotes by searching for posts that embed this specific post */
        const quotes = await findQuotesForPost(postUri);
        const anonymizedQuotes = anonymizeQuotes(quotes);
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        const output = {
            metadata: {
                originalPost: postUri,
                totalQuotes: anonymizedQuotes.length,
                processedAt: new Date().toISOString()
            },
            quotes: anonymizedQuotes
        };
        
        displayOutput(output);
        return output;
        
    } catch (error) {
        console.error('Error processing quotes:', error);
        showError(error.message);
        throw error;
    }
}

/* Find quotes for a specific post */
async function findQuotesForPost(postUri) {
    console.log('Finding quotes for post URI:', postUri);
    
    /* Method 1: Try to use the post's quote count and fetch quotes directly */
    const directQuotes = await fetchDirectQuotes(postUri);
    if (directQuotes.length > 0) {
        return directQuotes;
    }
    
    /* Method 2: Search for posts that might quote this URI */
    const searchQuotes = await searchForQuotes(postUri);
    
    return searchQuotes;
}

/* Attempt to fetch quotes directly from the post */
async function fetchDirectQuotes(postUri) {
    console.log('Attempting to fetch direct quotes for:', postUri);
    
    try {
        /* This endpoint may not exist or may require different parameters */
        /* This is a placeholder implementation */
        const response = await fetch(`${BSKY_API_BASE}/app.bsky.feed.getQuotes?uri=${encodeURIComponent(postUri)}`);
        
        if (response.ok) {
            const data = await response.json();
            return data.posts || [];
        }
        
        console.log('Direct quotes endpoint not available or returned error');
        return [];
        
    } catch (error) {
        console.log('Direct quotes fetch failed:', error.message);
        return [];
    }
}

/* Search for posts that quote the given URI */
async function searchForQuotes(postUri) {
    console.log('Searching for quotes of:', postUri);
    
    const token = getAuthToken();
    
    try {
        /* Extract the post ID from the URI for search */
        const postIdMatch = postUri.match(/\/app\.bsky\.feed\.post\/(.+)$/);
        if (!postIdMatch) {
            throw new Error('Could not extract post ID from URI');
        }
        
        const postId = postIdMatch[1];
        
        /* Search for posts containing the post ID (potential quotes) */
        const searchQuery = postId.substring(0, 10); /* Use partial ID to find quotes */
        
        const params = new URLSearchParams({
            q: searchQuery,
            limit: '100'
        });
        
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`${BSKY_API_BASE}/app.bsky.feed.searchPosts?${params}`, {
            headers
        });
        
        if (!response.ok) {
            console.log('Search failed, returning empty results');
            return [];
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        /* Filter for posts that actually embed/quote the target post */
        const quotes = allPosts.filter(post => {
            if (!post.record?.embed) return false;
            
            /* Check if embed references our target post */
            const embed = post.record.embed;
            if (embed.$type === 'app.bsky.embed.record') {
                return embed.record?.uri === postUri;
            }
            if (embed.$type === 'app.bsky.embed.recordWithMedia') {
                return embed.record?.record?.uri === postUri;
            }
            
            return false;
        });
        
        console.log(`Found ${quotes.length} quotes via search`);
        return quotes;
        
    } catch (error) {
        console.error('Quote search failed:', error);
        return [];
    }
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
        hasMedia: hasNonQuoteMedia(quote.record?.embed),
        hasLinks: !!(quote.record?.facets?.some(f => 
            f.features?.some(feat => feat.$type === 'app.bsky.richtext.facet#link')
        )),
        language: quote.record?.langs?.[0] || 'unknown',
        quotedPostText: extractQuotedText(quote.record?.embed)
    }));
}

/* Check if post has media beyond the quoted post */
function hasNonQuoteMedia(embed) {
    if (!embed) return false;
    
    /* If it's just a record embed (quote), no additional media */
    if (embed.$type === 'app.bsky.embed.record') {
        return false;
    }
    
    /* If it's record with media, then yes it has media */
    if (embed.$type === 'app.bsky.embed.recordWithMedia') {
        return true;
    }
    
    /* Other embed types indicate media */
    return true;
}

/* Extract text from the quoted post */
function extractQuotedText(embed) {
    if (!embed) return null;
    
    if (embed.$type === 'app.bsky.embed.record') {
        return embed.record?.value?.text || null;
    }
    
    if (embed.$type === 'app.bsky.embed.recordWithMedia') {
        return embed.record?.record?.value?.text || null;
    }
    
    return null;
}

/* Export for use in other modules */
export { findQuotesForPost, anonymizeQuotes };
