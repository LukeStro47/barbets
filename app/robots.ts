import type { MetadataRoute } from 'next';

/**
 * Nothing in this project should be indexed.
 *
 * Every route here is either behind auth (so a crawler gets the login screen) or has a public
 * counterpart on the marketing site, which owns the canonical /privacy, /terms and /how-it-works
 * and is the origin that carries a sitemap. Leaving this open would also mean indexing
 * app.mybarbets.com and barbets.vercel.app as two complete copies of the same app.
 *
 * Note this file is also served from mybarbets.com for as long as that domain still points at
 * this deployment. That is intended: the marketing project serves its own permissive robots.txt
 * the moment the domain moves across, so the only window where mybarbets.com is disallowed is one
 * where it is still just a login splash and has nothing worth indexing anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
