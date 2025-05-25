/* FILE: bsky-quote.js - REFACTORED using separated core modules */

import { 
    showError, 
    hideError, 
    showLoading, 
    hideLoading,
    displayOutput
} from './core-html.js';

import { 
    BSKY_PUBLIC_API,
    parsePostUrl,
    buildPostUri,
    fetchOriginalPost,
    buildStandardOutput,
    anonymizePosts,
    getAuthToken
} from './core-bsky.js';

/* Process quotes for a specific post using the proper API */
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
        
        const postUri = await buildPostUri(handle, postId);
        const originalPost = await fetchOriginalPost(postUri);
        const quotes = await findQuotesForPost(postUri);
        
        const anonymizedQuotes = anonymizePosts(quotes, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true,
            includeQuotedSnippet: true
        });
        
        console.log(`Found ${anonymizedQuotes.length} quotes`);
        
        const output = buildStandardOutput(originalPost, anonymizedQuotes, {
            originalPost: postUri,
            totalQuotes: anonymizedQuotes.length,
            childDataKey: 'quotePosts'
        });
        
        displayOutput(output);
        return output;
        
    } catch (error) {
        console.error('Error processing quotes:', error);
        showError(error.message);
        throw error;
    }
}

/* Find quotes for a specific post using the proper getQuotes API */
async function findQuotesForPost(postUri) {
    console.log('Finding quotes for post URI using getQuotes API:', postUri);
    
    try {
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.getQuotes?uri=${encodeURIComponent(postUri)}&limit=100`);
        
        if (response.ok) {
            const data = await response.json();
            const quotes = data.posts || [];
            console.log(`Found ${quotes.length} quotes via getQuotes API`);
            return quotes;
        } else {
            const errorText = await response.text();
            console.log('getQuotes API failed:', response.status, errorText);
            
            console.log('Falling back to search method...');
            return await searchForQuotes(postUri);
        }
        
    } catch (error) {
        console.error('getQuotes API error:', error);
        console.log('Falling back to search method due to error...');
        return await searchForQuotes(postUri);
    }
}

/* Fallback search method for finding quotes */
async function searchForQuotes(postUri) {
    console.log('Searching for quotes using search fallback:', postUri);
    
    const token = getAuthToken();
    
    try {
        const postIdMatch = postUri.match(/\/app\.bsky\.feed\.post\/(.+)$/);
        if (!postIdMatch) {
            throw new Error('Could not extract post ID from URI');
        }
        
        const postId = postIdMatch[1];
        const searchQuery = postId.substring(0, 12);
        
        const params = new URLSearchParams({
            q: searchQuery,
            limit: '100'
        });
        
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?${params}`, {
            headers
        });
        
        if (!response.ok) {
            console.log('Search failed, returning empty results');
            return [];
        }
        
        const data = await response.json();
        const allPosts = data.posts || [];
        
        const quotes = allPosts.filter(post => {
            if (!post.record?.embed) return false;
            
            const embed = post.record.embed;
            if (embed.$type === 'app.bsky.embed.record') {
                return embed.record?.uri === postUri;
            }
            if (embed.$type === 'app.bsky.embed.recordWithMedia') {
                return embed.record?.record?.uri === postUri;
            }
            
            return false;
        });
        
        console.log(`Found ${quotes.length} quotes via search fallback`);
        return quotes;
        
    } catch (error) {
        console.error('Quote search fallback failed:', error);
        return [];
    }
}

/* Export for use in other modules */
export { findQuotesForPost };
