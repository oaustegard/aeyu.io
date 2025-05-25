/* Search functionality for Bluesky posts - REFACTORED */

import { 
    authenticateUser,
    logout,
    isAuthenticated,
    getCurrentUser,
    getAuthToken,
    showError, 
    hideError, 
    showLoading, 
    hideLoading, 
    displayOutput,
    anonymizePosts
} from './bsky-core.js';

const BSKY_API_BASE = 'https://bsky.social/xrpc';

/* Initialize search processing */
export function initializeSearchProcessing() {
    console.log('Initializing search processing...');
    
    setupAuthenticationUI();
    setupSearchForm();
    updateUIBasedOnAuth();
}

/* Set up authentication UI */
function setupAuthenticationUI() {
    const authButton = document.getElementById('auth-button');
    const logoutButton = document.getElementById('logout-button');
    const limitSelect = document.getElementById('limit-input');
    const sortRadios = document.querySelectorAll('input[name="sort"]');
    
    if (authButton) {
        authButton.addEventListener('click', handleAuthentication);
    }
    
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
    
    /* Show/hide pagination warning based on settings */
    if (limitSelect && sortRadios.length > 0) {
        const updateWarning = () => {
            const limit = parseInt(limitSelect.value);
            const sortValue = document.querySelector('input[name="sort"]:checked')?.value;
            const warning = document.getElementById('pagination-warning');
            
            if (warning) {
                warning.style.display = (limit > 100 && sortValue === 'top') ? 'block' : 'none';
            }
        };
        
        limitSelect.addEventListener('change', updateWarning);
        sortRadios.forEach(radio => radio.addEventListener('change', updateWarning));
        updateWarning();
    }
}

/* Set up search form */
function setupSearchForm() {
    const searchForm = document.getElementById('search-form');
    const processButton = document.getElementById('process-search');
    
    if (searchForm && processButton) {
        searchForm.addEventListener('submit', handleSearch);
    }
}

/* Handle authentication */
async function handleAuthentication() {
    console.log('Handling authentication...');
    hideError();
    
    const handleInput = document.getElementById('handle-input');
    const passwordInput = document.getElementById('password-input');
    
    const handle = handleInput?.value?.trim();
    const password = passwordInput?.value?.trim();
    
    if (!handle || !password) {
        showAuthError('Please enter both handle and password');
        return;
    }
    
    try {
        showLoading('auth-button');
        
        const result = await authenticateUser(handle, password);
        
        if (result.success) {
            showAuthSuccess();
            updateUIBasedOnAuth();
            console.log('Authentication successful');
        } else {
            showAuthError(result.error || 'Authentication failed');
        }
        
    } catch (error) {
        console.error('Authentication error:', error);
        showAuthError(error.message);
    } finally {
        hideLoading('auth-button', 'Authenticate');
    }
}

/* Handle logout */
function handleLogout() {
    console.log('Handling logout...');
    logout();
    updateUIBasedOnAuth();
    hideAuthSuccess();
    hideAuthError();
}

/* Handle search submission */
async function handleSearch(e) {
    e.preventDefault();
    console.log('Handling search...');
    hideError();
    
    if (!isAuthenticated()) {
        showError('Please authenticate first');
        return;
    }
    
    const searchInput = document.getElementById('search-input');
    const limitSelect = document.getElementById('limit-input');
    const sortRadio = document.querySelector('input[name="sort"]:checked');
    
    const query = searchInput?.value?.trim();
    const limit = parseInt(limitSelect?.value || '100');
    const sort = sortRadio?.value || 'top';
    
    if (!query) {
        showError('Please enter a search query');
        return;
    }
    
    try {
        showLoading('process-search');
        
        console.log(`Searching for: "${query}" (limit: ${limit}, sort: ${sort})`);
        
        let allResults = [];
        let cursor = null;
        let batchSize = Math.min(limit, 100);
        
        /* If large limit with top sort, use smaller batches for better sampling */
        if (limit > 100 && sort === 'top') {
            batchSize = 25;
        }
        
        while (allResults.length < limit) {
            const remainingLimit = limit - allResults.length;
            const currentBatchSize = Math.min(batchSize, remainingLimit);
            
            console.log(`Fetching batch: ${allResults.length + 1}-${allResults.length + currentBatchSize}`);
            
            const batch = await searchPosts(query, currentBatchSize, sort, cursor);
            
            if (!batch.posts || batch.posts.length === 0) {
                console.log('No more results available');
                break;
            }
            
            allResults.push(...batch.posts);
            cursor = batch.cursor;
            
            if (!cursor) {
                console.log('No more pages available');
                break;
            }
        }
        
        /* Trim to exact limit if we got more */
        if (allResults.length > limit) {
            allResults = allResults.slice(0, limit);
        }
        
        const anonymizedResults = anonymizePosts(allResults, {
            sourceType: 'search',
            includePostType: false, /* Search results don't have full context for post type detection */
            includeAltText: true
        });
        
        console.log(`Search completed: ${anonymizedResults.length} results`);
        
        const output = {
            metadata: {
                query: query,
                sort: sort,
                totalResults: anonymizedResults.length,
                processedAt: new Date().toISOString()
            },
            posts: anonymizedResults
        };
        
        displayOutput(output);
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message);
    } finally {
        hideLoading('process-search', 'Process Search');
    }
}

/* Search posts using Bluesky API */
async function searchPosts(query, limit = 25, sort = 'top', cursor = null) {
    console.log(`API call: searching for "${query}", limit=${limit}, sort=${sort}, cursor=${cursor ? 'present' : 'none'}`);
    
    const token = getAuthToken();
    if (!token) {
        throw new Error('No authentication token available');
    }
    
    const params = new URLSearchParams({
        q: query,
        limit: limit.toString(),
        sort: sort
    });
    
    if (cursor) {
        params.append('cursor', cursor);
    }
    
    const response = await fetch(`${BSKY_API_BASE}/app.bsky.feed.searchPosts?${params}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`API response: ${data.posts?.length || 0} posts returned`);
    
    return data;
}

/* Update UI based on authentication status */
function updateUIBasedOnAuth() {
    const authSection = document.getElementById('search-auth-section');
    const authInfo = document.getElementById('auth-info');
    const searchForm = document.getElementById('search-form');
    const authAvatar = document.getElementById('auth-avatar');
    const authHandle = document.getElementById('auth-handle');
    
    if (isAuthenticated()) {
        const user = getCurrentUser();
        
        if (authSection) authSection.style.display = 'none';
        if (authInfo) authInfo.style.display = 'flex';
        if (searchForm) searchForm.style.display = 'block';
        
        if (authAvatar && user.avatar) {
            authAvatar.src = user.avatar;
        }
        if (authHandle) {
            authHandle.textContent = user.displayName || user.handle;
        }
    } else {
        if (authSection) authSection.style.display = 'block';
        if (authInfo) authInfo.style.display = 'none';
        if (searchForm) searchForm.style.display = 'none';
    }
}

/* Show authentication success */
function showAuthSuccess() {
    const successEl = document.getElementById('auth-success');
    if (successEl) {
        successEl.style.display = 'block';
    }
}

/* Hide authentication success */
function hideAuthSuccess() {
    const successEl = document.getElementById('auth-success');
    if (successEl) {
        successEl.style.display = 'none';
    }
}

/* Show authentication error */
function showAuthError(message) {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

/* Hide authentication error */
function hideAuthError() {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
        errorEl.style.display = 'none';
    }
}

/* Auto-process search based on URL parameters */
export function autoProcessSearch() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    const sort = urlParams.get('sort');
    const limit = urlParams.get('limit');
    
    if (query) {
        console.log('Auto-processing search from URL params:', query);
        
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = query;
        }
        
        if (sort && ['top', 'latest'].includes(sort)) {
            const sortRadio = document.getElementById(`sort-${sort}`);
            if (sortRadio) {
                sortRadio.checked = true;
            }
        }
        
        if (limit) {
            const limitSelect = document.getElementById('limit-input');
            if (limitSelect) {
                limitSelect.value = limit;
            }
        }
        
        /* Only auto-search if already authenticated */
        if (isAuthenticated()) {
            const searchForm = document.getElementById('search-form');
            if (searchForm) {
                handleSearch({ preventDefault: () => {} });
            }
        }
    }
}
