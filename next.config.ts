import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow testing the dev server from other devices on the local network
  // (e.g. a phone at http://192.168.2.41:3000). Without this, Next.js blocks
  // cross-origin requests to its dev resources. Update the IP if your
  // computer's local network address changes.
  allowedDevOrigins: ["192.168.2.41"],
};

export default nextConfig;
