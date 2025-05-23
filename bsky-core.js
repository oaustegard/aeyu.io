/* Core Bluesky API functionality */

let authToken = null;
let userProfile = null;

/* API endpoints */
const BSKY_API_BASE = 'https://bsky.social/xrpc';

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
