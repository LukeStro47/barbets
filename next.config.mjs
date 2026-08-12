/** @type {import('next').NextConfig} */
const nextConfig = {
  // Default bottom-left position sits directly under BottomNav's Home tab, which now occupies
  // the entire bottom edge — every dev-mode click near Home would hit this badge instead. Dev
  // build only, no effect on `next build`/production.
  devIndicators: { position: 'top-left' },

  // Server stacks in production are otherwise minified to a single unreadable frame
  // ("at s (.next/server/chunks/ssr/[root-of-the-server]__1s6o8a3._.js:1:12574)"), which makes
  // the stack in a Slack error card worth nothing: it names no file, no function, no line.
  // This emits maps for the server bundle; instrumentation.ts turns on Node's consumption of
  // them, and the two together are what make a reported error point at real source.
  experimental: { serverSourceMaps: true },

  async redirects() {
    return [
      // /help was a page whose entire content was "email us". /feedback is the same conversation
      // with a form that files it, so the route folds into it rather than being two doors to one
      // thing. Kept as a redirect, not deleted: printed/linked /help URLs are out in the world.
      { source: '/help', destination: '/feedback', permanent: true },
    ];
  },
};

export default nextConfig;
