/** Renders a multiple_choice option label. The mockups (4h2, 4i) set an "@nickname" option in the
 *  same ink weight as any other option, so this is a plain pass-through now; kept as a component
 *  so every option label still routes through one place. */
export function OptionLabel({ label }: { label: string; className?: string }) {
  return <>{label}</>;
}
