import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html } from 'htm/preact';

// Main App component
function App() {
    const [loading, setLoading] = useState(false);
    const [utilities, setUtilities] = useState([
        { 
            name: 'Post Processor', 
            description: 'Extract replies and quotes from Bluesky posts',
            icon: '💬',
            url: '/bsky-posts.html'
        },
        { 
            name: 'Search Posts', 
            description: 'Search and analyze Bluesky posts',
            icon: '🔍',
            url: '/bsky-search.html'
        },
        { 
            name: 'Feed Processor', 
            description: 'Extract posts from profiles, feeds, lists, or starter packs',
            icon: '📊',
            url: '/bsky-feeds.html'
        }
    ]);

    return html`
        <div class="container mx-auto px-4 py-8">
            <header class="text-center mb-12">
                <h1 class="text-4xl font-bold mb-4 bluesky-gradient bg-clip-text text-transparent">
                    aeyu.io
                </h1>
                <p class="text-xl text-gray-600">Bluesky Utilities</p>
            </header>

            <main>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${utilities.map(util => html`
                        <a href=${util.url} class="card cursor-pointer hover:shadow-lg transition-shadow">
                            <div class="text-3xl mb-3">${util.icon}</div>
                            <h3 class="text-xl font-semibold mb-2">${util.name}</h3>
                            <p class="text-gray-600">${util.description}</p>
                        </a>
                    `)}
                </div>
            </main>

            <footer class="mt-16 text-center text-gray-500">
                <p>Created by <a href="https://austegard.com" class="text-blue-500 hover:underline">Oskar Austegard</a></p>
            </footer>
        </div>
    `;
}

// Error boundary component
function ErrorBoundary({ children }) {
    const [hasError, setHasError] = useState(false);

    if (hasError) {
        return html`
            <div class="container mx-auto px-4 py-8 text-center">
                <h2 class="text-2xl font-bold text-red-600 mb-4">Something went wrong</h2>
                <button 
                    class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    onClick=${() => setHasError(false)}
                >
                    Try again
                </button>
            </div>
        `;
    }

    return children;
}

// Mount the app
render(html`<${ErrorBoundary}><${App} /><//>`, document.getElementById('app'));
