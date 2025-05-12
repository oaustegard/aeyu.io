// app.js - Update the utilities array
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
