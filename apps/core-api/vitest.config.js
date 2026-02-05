import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8', // or 'istanbul'
            reporter: ['text', 'json', 'html'],
            exclude: ['node_modules/', 'dist/', 'src/index.ts'],
        },
    },
    resolve: {
        alias: {
            '@/routes': path.resolve(__dirname, './src/routes'),
            '@/services': path.resolve(__dirname, './src/services'),
            '@/db': path.resolve(__dirname, './src/db'),
            '@/middleware': path.resolve(__dirname, './src/middleware'),
            '@/config': path.resolve(__dirname, './src/config'),
            '@/types': path.resolve(__dirname, './src/types'),
        },
    },
});
