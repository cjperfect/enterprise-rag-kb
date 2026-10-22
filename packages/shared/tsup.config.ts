import { defineConfig } from "tsup";

export default defineConfig({
  // 保留子路径入口，供 @enterprise-rag-kb/shared/interfaces 等按需引用
  entry: [
    "src/index.ts",
    "src/enums/index.ts",
    "src/interfaces/index.ts",
    "src/constants/index.ts",
    "src/events/index.ts",
  ],
  format: ["cjs", "esm"], // 后端 Nest(CJS) 与 ai-engine(ESM) 都需要
  splitting: false, // 该包只有类型与常量，无需代码分割
  sourcemap: false,
  clean: true, // 每次构建前清理 dist，避免残留旧的编译产物
  target: "node20",
  dts: true, // 生成 .d.ts / .d.cts，供两侧消费方取类型
  outDir: "./dist",
});
