import type { NextConfig } from "next";

// Local dev only: when testing through a tunnel (cloudflared/ngrok) so
// GitHub can reach the webhook/setup routes, Next's dev server blocks
// cross-origin HMR/asset requests unless the tunnel's hostname is
// allow-listed here. Set SHIPSAFE_TUNNEL_URL to the tunnel's HTTPS
// origin (see docs/GITHUB_INTEGRATION.md § Local development).
const tunnelHost = process.env.SHIPSAFE_TUNNEL_URL
  ? new URL(process.env.SHIPSAFE_TUNNEL_URL).host
  : undefined;

const nextConfig: NextConfig = {
  allowedDevOrigins: tunnelHost ? [tunnelHost] : undefined,
};

export default nextConfig;
