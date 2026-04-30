import path from "path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  turbopack: {
    // Keep Turbopack scoped to this repo even if parent folders contain lockfiles.
    root: path.join(__dirname),
  },
};

export default nextConfig;
