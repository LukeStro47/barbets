/** Rendered whenever the current URL doesn't match anything under this parallel `@modal` slot —
 * navigating anywhere else (including "Compare with someone" pushing to the `vs` route) needs
 * this to fall back to nothing, or the last-opened modal would stay stuck on screen. */
export default function Default() {
  return null;
}
