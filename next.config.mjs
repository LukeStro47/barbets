/** @type {import('next').NextConfig} */
const nextConfig = {
  // Default bottom-left position sits directly under BottomNav's Home tab, which now occupies
  // the entire bottom edge — every dev-mode click near Home would hit this badge instead. Dev
  // build only, no effect on `next build`/production.
  devIndicators: { position: 'top-left' },

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
