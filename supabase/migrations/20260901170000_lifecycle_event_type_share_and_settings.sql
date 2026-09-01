-- Two new lifecycle event types for the frequency-of-use bundle: share_click (button
-- click tracking, currently unused since SHARE_BUTTONS_ENABLED is off) and
-- settings_update (group settings changes, split basic vs. advanced in metadata).
-- Own migration/transaction, same enum-add rule as group_delete_event_type.
alter type lifecycle_event_type add value 'share_click';
alter type lifecycle_event_type add value 'settings_update';
