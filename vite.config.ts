import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  // 지구 데이터를 불러오는 동안 기다리려고 최상위 await를 쓴다
  build: { target: 'es2022', assetsInlineLimit: () => true },
  test: { include: ['src/**/*.test.ts'] },
});
