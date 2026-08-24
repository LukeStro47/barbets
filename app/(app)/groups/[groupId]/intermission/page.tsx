import { redirect } from 'next/navigation';

/** The season-over state now lives directly on the group hub (see .../[groupId]/page.tsx's
 * `intermission` branch) instead of a separate page reached through a banner. This route stays
 * only so any old link/bookmark still lands somewhere real. */
export default async function IntermissionRedirect({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  redirect(`/groups/${groupId}`);
}
