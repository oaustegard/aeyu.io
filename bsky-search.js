/* FILE: bsky-search.js - REFACTORED using separated core modules */

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
    BSKY_API_BASE,
    authenticateUser,
    logout,
    isAuthenticated,
    getCurrentUser,
    fetchBskyPaginatedData,
    anonymizePosts
} from './core-bsky.js';

/* Initialize search processing */
export function initializeSearchProcessing() {
    console.log('Initializing search processing...');
    
    setupAuthenticationUI();
    setupSearchForm();
    updateUIBasedOnAuth();
    
    /* Auto-process from URL parameters */
    autoProcessFromUrlParams({
        paramMappings: {
            'q': 'search-input',
            'sort': 'sort-radio',
            'limit': 'limit-input'
        },
        autoSubmit: {
            condition: (params) => params.get('q') && isAuthenticated(),
            handler: () => handleSearch({ preventDefault: () => {} })
        }
    });
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
    
    if (!isAuthenticated()) {
        showError('Please authenticate first');
        return;
    }
    
    return handleFormSubmission('process-search', 'Process Search', async () => {
        const searchInput = document.getElementById('search-input');
        const limitSelect = document.getElementById('limit-input');
        const sortRadio = document.querySelector('input[name="sort"]:checked');
        
        const query = searchInput?.value?.trim();
        const limit = parseInt(limitSelect?.value || '100');
        const sort = sortRadio?.value || 'top';
        
        if (!query) {
            throw new Error('Please enter a search query');
        }
        
        console.log(`Searching for: "${query}" (limit: ${limit}, sort: ${sort})`);
        
        /* Determine batch size based on sort type and limit */
        let batchSize = Math.min(limit, 100);
        if (limit > 100 && sort === 'top') {
            batchSize = 25; /* Use smaller batches for better sampling with top sort */
        }
        
        const result = await fetchBskyPaginatedData(
            `${BSKY_API_BASE}/app.bsky.feed.searchPosts`,
            { q: query, sort: sort },
            { 
                limit,
                batchSize,
                authRequired: true,
                dataKey: 'posts'
            }
        );
        
        const anonymizedResults = anonymizePosts(result.data, {
            sourceType: 'search',
            includePostType: false,
            includeAltText: true
        });
        
        console.log(`Search completed: ${anonymizedResults.length} results`);
        
        return {
            metadata: {
                query: query,
                sort: sort,
                totalResults: anonymizedResults.length,
                processedAt: new Date().toISOString()
            },
            posts: anonymizedResults
        };
    });
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

/* Legacy function for compatibility */
export function autoProcessSearch() {
    console.log('autoProcessSearch() called - functionality now handled by core autoProcessFromUrlParams()');
}
