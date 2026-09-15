import { redirect } from 'next/navigation';

/** Kept so old bookmarks and in-app links to /settings/edit land on the live rules screen. */
export default async function EditGroupSettingsRedirect({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  redirect(`/groups/${groupId}/settings/rules`);
}
