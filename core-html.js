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



/* ===== INITIALIZATION ===== */

export function initializeHtmlCore() {
    console.log('Initializing HTML core...');
    setupCopyButton();
    return true;
}
