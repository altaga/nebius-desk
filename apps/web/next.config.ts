import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three", "@pixiv/three-vrm"],
};

export default nextConfig;
