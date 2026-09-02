import type { NextConfig } from "next";

/**
 * Static export. There is no server -- see CLAUDE.md.
 *
 * basePath is hardcoded, not read from an env var, on purpose. GitHub Pages
 * serves this repo from https://tabxzzxtab.github.io/Shift-Setter/, so every
 * asset URL needs the prefix. Deriving it from an env var means a CI job that
 * forgets to set it deploys green and renders a blank page -- the failure is
 * invisible until someone opens the site. Hardcoding makes dev and prod agree.
 *
 * Consequence: `npm run dev` serves at http://localhost:3000/Shift-Setter/
 */
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/Shift-Setter",
  assetPrefix: "/Shift-Setter",

  // Static hosting has no rewrite layer: /login must resolve to /login/index.html.
  trailingSlash: true,

  // next/image's optimizer needs a server. There isn't one.
  images: { unoptimized: true },

  // A build that ships type errors defeats the point of Phase 1.
  // (Next 16 removed the `eslint` key from NextConfig; lint runs as its own
  // script and as its own CI step instead.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
