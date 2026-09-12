import type { NextConfig } from "next";

/**
 * Static export. There is no server -- see CLAUDE.md.
 *
 * NO basePath AND NO assetPrefix. The app serves from the ROOT of its own
 * domain, app.bellaserviceab.se, so every asset URL is absolute from "/".
 *
 * It used to carry "/Shift-Setter", because GitHub Pages served the repo from
 * a subpath of github.io. Moving to a domain of our own removed the subpath,
 * and a prefix that no longer matches the origin is worse than none: every
 * script, stylesheet and icon 404s and the app hangs on its first paint with
 * nothing on screen but "Laddar...". That is exactly how this was found.
 *
 * Still hardcoded rather than read from an env var, for the reason the prefix
 * always was: a build that forgot the var would deploy green and render a
 * blank page, and the failure would be invisible until somebody opened the
 * site. There is nothing to forget now.
 *
 * Consequence: `npm run dev` serves at http://localhost:3000/
 */
const nextConfig: NextConfig = {
  output: "export",
  // Static hosting has no rewrite layer: /login must resolve to /login/index.html.
  trailingSlash: true,

  // next/image's optimizer needs a server. There isn't one.
  images: { unoptimized: true },

  // `next dev` otherwise appends a block to CLAUDE.md on every run. That file
  // is the invariants document, verified verbatim against the spec; nothing
  // automated may edit it. Its guidance is kept by hand instead, below.
  agentRules: false,

  // A build that ships type errors defeats the point of Phase 1.
  // (Next 16 removed the `eslint` key from NextConfig; lint runs as its own
  // script and as its own CI step instead.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
