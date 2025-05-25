/* Core HTML/DOM functionality - separated from Bluesky-specific logic */

/* ===== DOM MANIPULATION UTILITIES ===== */

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

/* ===== COPY FUNCTIONALITY ===== */

export function setupCopyButton() {
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

/* ===== GENERIC FORM SUBMISSION WRAPPER ===== */

export async function handleFormSubmission(buttonId, buttonText, processor) {
    hideError();
    
    try {
        showLoading(buttonId);
        const result = await processor();
        
        if (result && typeof result === 'object') {
            displayOutput(result);
        }
        
        return result;
        
    } catch (error) {
        console.error('Form submission error:', error);
        showError(error.message);
        throw error;
    } finally {
        hideLoading(buttonId, buttonText);
    }
}

/* ===== URL PARAMETER AUTO-PROCESSOR ===== */

export function autoProcessFromUrlParams(config) {
    const urlParams = new URLSearchParams(window.location.search);
    
    /* Set form values based on URL parameters */
    Object.entries(config.paramMappings).forEach(([paramName, elementId]) => {
        const value = urlParams.get(paramName);
        if (value) {
            setElementValue(elementId, value);
        }
    });
    
    /* Trigger UI updates if needed */
    if (config.uiUpdater) {
        config.uiUpdater();
    }
    
    /* Auto-submit if conditions are met */
    if (config.autoSubmit && config.autoSubmit.condition(urlParams)) {
        setTimeout(() => {
            config.autoSubmit.handler();
        }, 100);
    }
}

/* Helper function to set element values based on type */
function setElementValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (element.type === 'radio') {
        const radio = document.querySelector(`input[name="${element.name}"][value="${value}"]`);
        if (radio) radio.checked = true;
    } else if (element.type === 'checkbox') {
        element.checked = value === 'true';
    } else {
        element.value = value;
    }
}

/* ===== GENERIC HTTP UTILITIES ===== */

export async function validateApiResponse(response, context = 'API call') {
    console.log(`Validating ${context} response:`, response.status);
    
    if (!response.ok) {
        let errorMessage = `${context} failed: ${response.status}`;
        
        try {
            const errorText = await response.text();
            if (errorText) {
                errorMessage += ` - ${errorText}`;
            }
        } catch (e) {
            /* Ignore error text parsing failures */
        }
        
        throw new Error(errorMessage);
    }
    
    const data = await response.json();
    console.log(`${context} successful:`, Object.keys(data));
    
    return data;
}

/* ===== GENERIC PAGINATION HANDLER ===== */
/* NOTE: These generic functions are kept for non-Bluesky APIs that might need different cursor handling */

export async function fetchPaginatedData(endpoint, baseParams, options = {}) {
    console.log('Starting generic paginated fetch:', endpoint);
    
    const {
        limit = 100,
        batchSize = 100,
        maxBatchSize = 100,
        headers = {},
        dataKey = 'data',
        cursorKey = 'cursor',
        requestMultiplier = 1
    } = options;
    
    let allData = [];
    let cursor = null;
    const effectiveBatchSize = Math.min(batchSize, maxBatchSize);
    
    while (allData.length < limit) {
        const remainingLimit = limit - allData.length;
        const currentBatchSize = Math.min(effectiveBatchSize * requestMultiplier, maxBatchSize);
        
        console.log(`Fetching batch: ${allData.length + 1}-${allData.length + currentBatchSize}`);
        
        const params = new URLSearchParams(baseParams);
        params.set('limit', currentBatchSize.toString());
        
        /* Generic cursor handling - add cursor parameter if we have one */
        if (cursor) {
            params.set(cursorKey, cursor);
        }
        
        const response = await fetch(`${endpoint}?${params}`, { headers });
        const data = await validateApiResponse(response, `Paginated fetch (${endpoint})`);
        
        const batch = data[dataKey] || [];
        console.log(`API response: ${batch.length} items returned`);
        
        if (batch.length === 0) {
            console.log('No more data available');
            break;
        }
        
        allData.push(...batch);
        cursor = data[cursorKey];
        
        if (!cursor) {
            console.log('No more pages available');
            break;
        }
    }
    
    return {
        data: allData.slice(0, limit),
        totalFetched: allData.length,
        hasMore: !!cursor
    };
}

/* ===== GENERIC PAGINATION WITH FILTERING ===== */

export async function fetchPaginatedDataWithFiltering(endpoint, baseParams, filter, options = {}) {
    console.log('Starting generic filtered paginated fetch:', endpoint);
    
    const {
        limit = 100,
        requestMultiplier = 2,
        maxAttempts = 5,
        ...paginationOptions
    } = options;
    
    let filteredData = [];
    let attempts = 0;
    let lastResult = null;
    
    while (filteredData.length < limit && attempts < maxAttempts) {
        const remainingLimit = limit - filteredData.length;
        const fetchSize = Math.min(remainingLimit * requestMultiplier, 100);
        
        /* Use cursor from last result if available */
        const currentParams = { ...baseParams };
        if (lastResult && lastResult.hasMore) {
            currentParams.cursor = lastResult.cursor;
        }
        
        lastResult = await fetchPaginatedData(endpoint, currentParams, {
            ...paginationOptions,
            limit: fetchSize,
            batchSize: fetchSize
        });
        
        const batch = lastResult.data;
        const filteredBatch = batch.filter(filter);
        
        console.log(`Filtered batch: ${filteredBatch.length}/${batch.length} items matched filter`);
        
        filteredData.push(...filteredBatch);
        attempts++;
        
        if (!lastResult.hasMore) {
            console.log('No more data available from API');
            break;
        }
    }
    
    return {
        data: filteredData.slice(0, limit),
        totalFetched: filteredData.length,
        attempts
    };
}

/* ===== INITIALIZATION ===== */

export function initializeHtmlCore() {
    console.log('Initializing HTML core...');
    setupCopyButton();
    return true;
}
