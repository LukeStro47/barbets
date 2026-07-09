-- New market type: multiple_choice. One pool, 2-10 mutually exclusive
-- options, parimutuel across the winning option. This is its own migration
-- file/transaction because Postgres will not let a newly added enum value be
-- used (in a query, a CHECK constraint literal, etc.) within the same
-- transaction that added it — the value must be committed first.
alter type market_type add value 'multiple_choice';
