import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

// 后端地址：本地开发默认 localhost:3001；Docker 容器内通过环境变量 BACKEND_URL=backend:3001
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // 容器化部署：输出 standalone 产物（.next/standalone 自带最小 node_modules，镜像更小）
  output: "standalone",
  experimental: {
    // 上传文档的请求体会经 rewrite 代理转发到后端。
    // Next 默认只透传前 10MB，超出部分被丢弃并告警「Request body exceeded 10MB」，
    // 表现为文件看似上传成功、实际内容被截断。这里与上传弹窗的 50MB 提示对齐。
    // 注意选项名：middlewareClientMaxBodySize 已废弃，现名 proxyClientMaxBodySize。
    proxyClientMaxBodySize: "50mb",
    // rewrite 代理默认 30s 超时：解析 PDF（Unstructured 云 + 图片语义化）实测约 30s+，
    // 会触发代理超时导致前端收到 500。调大到 120s，覆盖慢解析场景。
    proxyTimeout: 120_000,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default withAui(nextConfig);
