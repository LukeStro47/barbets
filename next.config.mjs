/** @type {import('next').NextConfig} */
const nextConfig = {
  // Default bottom-left position sits directly under BottomNav's Home tab, which now occupies
  // the entire bottom edge — every dev-mode click near Home would hit this badge instead. Dev
  // build only, no effect on `next build`/production.
  devIndicators: { position: 'top-left' },
};

export default nextConfig;
