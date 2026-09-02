import type { NextConfig } from "next";
import path from "path";

const apiUrl = process.env.API_URL || "http://127.0.0.1:8000";
const mediaProxyUrl = process.env.MEDIA_PROXY_URL || "http://127.0.0.1:8787";
const comfyuiProxyUrl = process.env.COMFYUI_PROXY_URL || "http://127.0.0.1:8789";
const allowedDevOrigins = (
  process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
    "192.168.1.178",
    "127.0.0.1",
    "localhost",
  ]
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: path.join(__dirname),
  },
  typescript: {
    // Legacy studio 组件逐步收紧类型，迁移期间跳过
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/media-proxy",
        destination: `${mediaProxyUrl}/`,
      },
      {
        source: "/api/comfyui-proxy/:path*",
        destination: `${comfyuiProxyUrl}/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
