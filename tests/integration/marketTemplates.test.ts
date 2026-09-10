import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

interface MarketTemplateRow {
  id: string;
  scope: 'curated' | 'private' | 'group';
  created_by: string | null;
  group_id: string | null;
  title: string;
  market_type: string;
  options: string[] | null;
  has_placeholder: boolean;
}

function saveTemplate(
  caller: TestUser,
  overrides: Partial<{
    scope: string;
    groupId: string | null;
    title: string;
    description: string;
    marketType: string;
    options: string[] | null;
    unit: string | null;
  }> = {}
) {
  return caller.client.rpc('create_market_template', {
    p_scope: overrides.scope ?? 'private',
    p_group_id: overrides.groupId ?? null,
    p_title: overrides.title ?? `Will @ finish first? ${Date.now()}-${Math.random()}`,
    p_description: overrides.description ?? 'Whoever the group agrees on.',
    p_market_type: overrides.marketType ?? 'yes_no',
    p_options: overrides.options ?? null,
    p_unit: overrides.unit ?? null,
  });
}

/** Throws on failure so a broken cleanup can't silently leave rows behind and skew a later
    per-scope cap test, same reasoning custom_group_titles.test.ts's deleteTitle() gives. */
async function deleteTemplate(owner: TestUser, id: string): Promise<void> {
  const { error } = await owner.client.rpc('delete_market_template', { p_id: id });
  if (error) throw error;
}

describe('market_templates', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let otherUsers: Record<string, TestUser>;
  let otherGroup: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('mt', ['owner', 'a', 'b']);
    group = await setupGroup(users.owner, [users.a, users.b], { seedAmount: 1000 });

    otherUsers = await createTestUsers('mtout', ['owner']);
    otherGroup = await setupGroup(otherUsers.owner, [], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
    await cleanupTestUsers(otherUsers);
  });

  describe('visibility', () => {
    test('a private template is visible to its creator only', async () => {
      const { data, error } = await saveTemplate(users.owner, { scope: 'private', title: 'Private idea' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;

      const { data: ownRead } = await users.owner.client.from('market_templates').select('id').eq('id', row.id).maybeSingle();
      expect(ownRead?.id).toBe(row.id);

      const { data: otherRead } = await users.a.client.from('market_templates').select('id').eq('id', row.id).maybeSingle();
      expect(otherRead).toBeNull();

      await deleteTemplate(users.owner, row.id);
    });

    test('a group template is visible to every active member of that group, invisible outside it', async () => {
      const { data, error } = await saveTemplate(users.owner, { scope: 'group', groupId: group.id, title: 'Shared idea' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;

      const { data: memberRead } = await users.a.client.from('market_templates').select('id').eq('id', row.id).maybeSingle();
      expect(memberRead?.id).toBe(row.id);

      const { data: outsiderRead } = await otherUsers.owner.client.from('market_templates').select('id').eq('id', row.id).maybeSingle();
      expect(outsiderRead).toBeNull();

      await deleteTemplate(users.owner, row.id);
    });
  });

  describe('create_market_template gating', () => {
    test('rejects scope curated from an ordinary call', async () => {
      const { error } = await saveTemplate(users.owner, { scope: 'curated' });
      expect(error?.message).toMatch(/invalid_operation/);
    });

    test('rejects saving to a group the caller is not a member of', async () => {
      const { error } = await saveTemplate(users.owner, { scope: 'group', groupId: otherGroup.id });
      expect(error?.message).toMatch(/not_found/);
    });

    test('rejects a blank title and an over-length title', async () => {
      const { error: blank } = await saveTemplate(users.owner, { title: '   ' });
      expect(blank?.message).toMatch(/invalid_operation/);

      const { error: tooLong } = await saveTemplate(users.owner, { title: 'x'.repeat(141) });
      expect(tooLong?.message).toMatch(/invalid_operation/);
      expect(tooLong?.message).toMatch(/140 characters/);
    });

    test('multiple_choice: rejects 1 or 11 options, blank/duplicate/over-length labels', async () => {
      const { error: oneOpt } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['Only one'] });
      expect(oneOpt?.message).toMatch(/invalid_operation/);

      const elevenOpts = Array.from({ length: 11 }, (_, i) => `Option ${i}`);
      const { error: elevenErr } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: elevenOpts });
      expect(elevenErr?.message).toMatch(/invalid_operation/);

      const { error: blankLabel } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['A', '  '] });
      expect(blankLabel?.message).toMatch(/invalid_operation/);

      const { error: dup } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['A', 'A'] });
      expect(dup?.message).toMatch(/invalid_operation/);

      const { error: tooLongLabel } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['A', 'x'.repeat(41)] });
      expect(tooLongLabel?.message).toMatch(/invalid_operation/);
    });

    test('rejects an @nickname-shaped option (that syntax is create_market()-only)', async () => {
      const { error } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['A', '@Someone'] });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/@ placeholder/);
    });

    test('rejects a unit on a non-over_under template', async () => {
      const { error } = await saveTemplate(users.owner, { marketType: 'yes_no', unit: 'min' });
      expect(error?.message).toMatch(/invalid_operation/);
    });

    test('accepts a unit on an over_under template', async () => {
      const { data, error } = await saveTemplate(users.owner, { marketType: 'over_under', title: 'How many drinks?', unit: 'drinks' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      await deleteTemplate(users.owner, row.id);
    });
  });

  describe('placeholder counting', () => {
    test('zero @ saves with has_placeholder false', async () => {
      const { data, error } = await saveTemplate(users.owner, { title: 'How many rounds tonight?' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      expect(row.has_placeholder).toBe(false);
      await deleteTemplate(users.owner, row.id);
    });

    test('exactly one @ in the title saves with has_placeholder true', async () => {
      const { data, error } = await saveTemplate(users.owner, { title: 'Will @ finish their drink first?' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      expect(row.has_placeholder).toBe(true);
      await deleteTemplate(users.owner, row.id);
    });

    test('exactly one @ option (multiple_choice) saves with has_placeholder true', async () => {
      const { data, error } = await saveTemplate(users.owner, {
        marketType: 'multiple_choice',
        title: 'Who forgets something at the hotel?',
        options: ['@', 'Nobody'],
      });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      expect(row.has_placeholder).toBe(true);
      await deleteTemplate(users.owner, row.id);
    });

    test('two @ in the title is rejected', async () => {
      const { error } = await saveTemplate(users.owner, { title: 'Will @ out-drink @ tonight?' });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/one @ placeholder/);
    });

    test('two @ options is rejected (as a duplicate label, before placeholder counting even runs)', async () => {
      // Two literal "@" options are, textually, duplicate labels -- so this hits the earlier
      // uniqueness check rather than the placeholder count. Both are correct rejections; this
      // pins down which one fires first now that it matters (see the mixed title+option case
      // below for the placeholder-count message itself).
      const { error } = await saveTemplate(users.owner, { marketType: 'multiple_choice', options: ['@', '@'] });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/unique/);
    });

    test('one @ in the title plus one @ option together is rejected', async () => {
      const { error } = await saveTemplate(users.owner, {
        marketType: 'multiple_choice',
        title: 'Will @ win this?',
        options: ['@', 'Someone else'],
      });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/one @ placeholder/);
    });
  });

  describe('delete_market_template gating', () => {
    test('creator can delete their own', async () => {
      const { data } = await saveTemplate(users.owner);
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      const { error } = await users.owner.client.rpc('delete_market_template', { p_id: row.id });
      expect(error).toBeNull();
      const { data: gone } = await adminClient.from('market_templates').select('id').eq('id', row.id).maybeSingle();
      expect(gone).toBeNull();
    });

    test('a different member of the same group gets forbidden', async () => {
      const { data } = await saveTemplate(users.owner, { scope: 'group', groupId: group.id });
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      const { error } = await users.a.client.rpc('delete_market_template', { p_id: row.id });
      expect(error?.message).toMatch(/forbidden/);
      await deleteTemplate(users.owner, row.id);
    });

    test('a nonexistent id gets not_found', async () => {
      const { error } = await users.owner.client.rpc('delete_market_template', { p_id: '00000000-0000-0000-0000-000000000000' });
      expect(error?.message).toMatch(/not_found/);
    });

    test('a non-member of a group-scoped template\'s group gets not_found, never forbidden', async () => {
      const { data } = await saveTemplate(users.owner, { scope: 'group', groupId: group.id });
      const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;
      const { error } = await otherUsers.owner.client.rpc('delete_market_template', { p_id: row.id });
      expect(error?.message).toMatch(/not_found/);
      await deleteTemplate(users.owner, row.id);
    });
  });

  describe('per-scope cap', () => {
    test('the 31st private template in one scope is rejected, the 30th succeeds', async () => {
      const capUser = (await createTestUsers('mtcap', ['solo'])).solo;
      try {
        const seeded = Array.from({ length: 29 }, (_, i) => ({
          scope: 'private',
          created_by: capUser.id,
          title: `Seeded ${i}`,
          description: '',
          market_type: 'yes_no',
        }));
        const { error: seedErr } = await adminClient.from('market_templates').insert(seeded);
        expect(seedErr).toBeNull();

        // the 30th, via the real RPC, should still succeed.
        const { data, error } = await saveTemplate(capUser, { title: 'The 30th' });
        expect(error).toBeNull();
        const row = (Array.isArray(data) ? data[0] : data) as MarketTemplateRow;

        const { error: overCapErr } = await saveTemplate(capUser, { title: 'One too many' });
        expect(overCapErr?.message).toMatch(/invalid_operation/);

        await deleteTemplate(capUser, row.id);
        await adminClient.from('market_templates').delete().eq('created_by', capUser.id);
      } finally {
        await cleanupTestUsers({ solo: capUser });
      }
    });
  });
});
