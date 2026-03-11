import { defineConfig } from 'vite';

export default defineConfig({
    base: '/Diamondbacks-Giveaway/',
    server: {
        proxy: {
            '/apify-api': {
                target: 'https://api.apify.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/apify-api/, ''),
                secure: true,
            },
            '/graph-api': {
                target: 'https://graph.facebook.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/graph-api/, ''),
                secure: true,
            },
        },
    },
});
