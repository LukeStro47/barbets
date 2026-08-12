// Node-only side of instrumentation.ts's register(), kept in its own file so Turbopack never
// pulls process.setSourceMapsEnabled into the edge bundle (where it warns as an unsupported
// API even behind an unreachable branch).
//
// Without this, Node leaves Error.stack minified and a production stack reads as one useless
// frame: "at s (.next/server/chunks/ssr/[root-of-the-server]__1s6o8a3._.js:1:12574)". Paired
// with experimental.serverSourceMaps in next.config.mjs, which emits the maps this consumes.
process.setSourceMapsEnabled(true);

// A file with no import or export is a script, not a module, and `await import()` of a script
// is a type error. This makes it a module without adding anything to the bundle.
export {};
