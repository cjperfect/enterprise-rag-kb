import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"], // 你的入口文件
  // 只产 ESM：pi 三包本身是 ESM-only（exports 仅 import 条件），
  // ai-engine 以原生 import 引用它们，Node 解析 ESM→ESM，pi 内部 CJS 依赖照常工作。
  // 消费方（NestJS，CJS）用 Node 22 的 require(ESM) 加载本包。
  format: ["esm"],
  splitting: false, // 后端项目通常不需要代码分割
  sourcemap: false, // 方便生产环境调试
  clean: true, // 每次构建前清理 dist 目录
  target: "node20", // 目标 Node.js 版本（建议 Node 20+）
  dts: true, // 生成类型声明文件
  outDir: "./dist",
});
