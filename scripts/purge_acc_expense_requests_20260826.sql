\set ON_ERROR_STOP on

-- Direct ACC PostgreSQL purge, database rows only.
-- Protected rows:
--   1. every request_no beginning with ACC
--   2. the exact 121 EXP request numbers approved on 2026-08-26
-- Physical files are intentionally not removed.

\if :{?apply}
\else
\set apply 0
\endif

\if :{?expected_count}
\else
\set expected_count -1
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30min';
SELECT pg_advisory_xact_lock(hashtext('acc_direct_expense_purge_20260826'));

CREATE TEMP TABLE purge_keep_numbers (
    request_no text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO purge_keep_numbers(request_no)
SELECT unnest(ARRAY[
    'EXP-202608-013975',
    'EXP-202608-013974',
    'EXP-202608-013973',
    'EXP-202608-013971',
    'EXP-202608-013970',
    'EXP-202608-013968',
    'EXP-202608-013965',
    'EXP-202608-013963',
    'EXP-202608-013958',
    'EXP-202608-013956',
    'EXP-202608-013955',
    'EXP-202608-013954',
    'EXP-202608-013953',
    'EXP-202608-013952',
    'EXP-202608-013951',
    'EXP-202608-013950',
    'EXP-202608-013947',
    'EXP-202608-013945',
    'EXP-202608-013942',
    'EXP-202608-013939',
    'EXP-202608-013938',
    'EXP-202608-013937',
    'EXP-202608-013936',
    'EXP-202608-013932',
    'EXP-202608-013929',
    'EXP-202608-013928',
    'EXP-202608-013927',
    'EXP-202608-013925',
    'EXP-202608-013924',
    'EXP-202608-013923',
    'EXP-202608-013920',
    'EXP-202608-013919',
    'EXP-202608-013918',
    'EXP-202608-013917',
    'EXP-202608-013915',
    'EXP-202608-013914',
    'EXP-202608-013913',
    'EXP-202608-013912',
    'EXP-202608-013911',
    'EXP-202608-013910',
    'EXP-202608-013907',
    'EXP-202608-013906',
    'EXP-202608-013905',
    'EXP-202608-013904',
    'EXP-202608-013894',
    'EXP-202608-013893',
    'EXP-202608-013892',
    'EXP-202608-013891',
    'EXP-202608-013890',
    'EXP-202608-013885',
    'EXP-202608-013884',
    'EXP-202608-013883',
    'EXP-202608-013882',
    'EXP-202608-013879',
    'EXP-202608-013878',
    'EXP-202608-013876',
    'EXP-202608-013875',
    'EXP-202608-013874',
    'EXP-202608-013873',
    'EXP-202608-013871',
    'EXP-202608-013863',
    'EXP-202608-013861',
    'EXP-202608-013858',
    'EXP-202608-013856',
    'EXP-202608-013855',
    'EXP-202608-013853',
    'EXP-202608-013851',
    'EXP-202608-013850',
    'EXP-202608-013849',
    'EXP-202608-000104',
    'EXP-202608-000103',
    'EXP-202608-000102',
    'EXP-202608-000101',
    'EXP-202608-000100',
    'EXP-202608-000098',
    'EXP-202608-000092',
    'EXP-202608-000091',
    'EXP-202608-000089',
    'EXP-202607-000088',
    'EXP-202607-000087',
    'EXP-202607-000086',
    'EXP-202607-000085',
    'EXP-202607-000084',
    'EXP-202607-000082',
    'EXP-202607-000080',
    'EXP-202607-000075',
    'EXP-202607-000072',
    'EXP-202607-000071',
    'EXP-202607-000068',
    'EXP-202607-000066',
    'EXP-202607-000065',
    'EXP-202607-000064',
    'EXP-202607-000063',
    'EXP-202607-000056',
    'EXP-202607-000055',
    'EXP-202607-000054',
    'EXP-202607-000053',
    'EXP-202607-000051',
    'EXP-202607-000050',
    'EXP-202607-000049',
    'EXP-202607-000042',
    'EXP-202607-000040',
    'EXP-202607-000039',
    'EXP-202607-000037',
    'EXP-202607-000036',
    'EXP-202607-000035',
    'EXP-202607-000033',
    'EXP-202607-000031',
    'EXP-202607-000029',
    'EXP-202607-000028',
    'EXP-202607-000027',
    'EXP-202607-000026',
    'EXP-202607-000025',
    'EXP-202607-000017',
    'EXP-202607-000016',
    'EXP-202607-000015',
    'EXP-202607-000014',
    'EXP-202607-000013',
    'EXP-202607-000012',
    'EXP-202607-000010',
    'EXP-202607-000008'
]::text[]);

CREATE TEMP TABLE purge_keep_count_guard (
    actual_count integer NOT NULL CHECK (actual_count = 121)
) ON COMMIT DROP;

INSERT INTO purge_keep_count_guard
SELECT count(*) FROM purge_keep_numbers;

CREATE TEMP TABLE purge_targets ON COMMIT DROP AS
SELECT request.id, request.request_no, request.status, request.amount
  FROM expense_requests request
 WHERE COALESCE(request.request_no, '') NOT LIKE 'ACC%'
   AND NOT EXISTS (
       SELECT 1
         FROM purge_keep_numbers keep
        WHERE keep.request_no = request.request_no
   );

ALTER TABLE purge_targets ADD PRIMARY KEY (id);

\echo
\echo '=== PROTECTED / TARGET SUMMARY ==='
SELECT (SELECT count(*) FROM purge_keep_numbers) AS approved_keep_numbers,
       (SELECT count(*) FROM expense_requests WHERE request_no LIKE 'ACC%') AS protected_acc_rows,
       (SELECT count(*) FROM expense_requests request
          JOIN purge_keep_numbers keep ON keep.request_no = request.request_no) AS present_keep_rows,
       (SELECT count(*) FROM purge_targets) AS delete_candidates;

\echo
\echo '=== KEEP NUMBERS NOT PRESENT IN THIS DATABASE ==='
SELECT keep.request_no
  FROM purge_keep_numbers keep
  LEFT JOIN expense_requests request ON request.request_no = keep.request_no
 WHERE request.id IS NULL
 ORDER BY keep.request_no;

\echo
\echo '=== DELETE CANDIDATES BY STATUS ==='
SELECT status, count(*) AS rows, sum(amount) AS request_total
  FROM purge_targets
 GROUP BY status
 ORDER BY status;

\echo
\echo '=== RELATED DATA THAT WILL LOSE DATABASE ROWS ==='
SELECT (SELECT count(*) FROM expense_payments payment
         JOIN purge_targets target ON target.id = payment.expense_request_id) AS payments,
       (SELECT COALESCE(sum(payment.amount), 0) FROM expense_payments payment
         JOIN purge_targets target ON target.id = payment.expense_request_id
        WHERE payment.voided_at IS NULL) AS active_payment_total,
       (SELECT count(*) FROM expense_settlements settlement
         JOIN purge_targets target ON target.id = settlement.expense_request_id) AS settlements,
       (SELECT count(*) FROM expense_request_attachments attachment
         JOIN purge_targets target ON target.id = attachment.expense_request_id) AS attachments;

\echo
\echo '=== COMPLETE DELETE CANDIDATE LIST ==='
SELECT request_no, status, amount
  FROM purge_targets
 ORDER BY request_no NULLS FIRST, id;

CREATE TEMP TABLE purge_blockers ON COMMIT DROP AS
SELECT preserved.request_no
  FROM expense_requests preserved
  JOIN purge_targets target ON target.id = preserved.installment_chain_root_id
  LEFT JOIN purge_targets also_target ON also_target.id = preserved.id
 WHERE also_target.id IS NULL;

CREATE TEMP TABLE purge_blocker_guard (
    blocker_count integer NOT NULL CHECK (blocker_count = 0)
) ON COMMIT DROP;

INSERT INTO purge_blocker_guard
SELECT count(*) FROM purge_blockers;

-- Apply mode requires the operator to repeat the exact candidate count shown
-- by the immediately preceding preview. A changed production data set aborts.
CREATE TEMP TABLE purge_expected_count_guard (
    actual_count integer NOT NULL,
    expected_count integer NOT NULL,
    CHECK (actual_count = expected_count)
) ON COMMIT DROP;

\if :apply
INSERT INTO purge_expected_count_guard
SELECT count(*), :expected_count FROM purge_targets;
\endif

-- Explicit deletes cover the non-cascading relationships in the current ACC
-- schema. Other request-owned rows cascade from expense_requests.
DELETE FROM expense_withholding_tax_certificates certificate
 USING purge_targets target
 WHERE certificate.expense_request_id = target.id;

DELETE FROM expense_settlement_items item
 USING expense_settlements settlement, purge_targets target
 WHERE item.settlement_id = settlement.id
   AND settlement.expense_request_id = target.id;

DELETE FROM expense_settlements settlement
 USING purge_targets target
 WHERE settlement.expense_request_id = target.id;

DELETE FROM expense_payments payment
 USING purge_targets target
 WHERE payment.expense_request_id = target.id;

DELETE FROM expense_signature_placements placement
 USING purge_targets target
 WHERE placement.expense_request_id = target.id;

DELETE FROM expense_approval_candidates candidate
 USING approval_request_steps step, purge_targets target
 WHERE candidate.request_step_id = step.id
   AND step.expense_request_id = target.id;

DELETE FROM hr_expense_request_import_map import_map
 USING purge_targets target
 WHERE import_map.expense_request_id = target.id;

DELETE FROM expense_requests request
 USING purge_targets target
 WHERE request.id = target.id;

CREATE TEMP TABLE purge_result_guard (
    remaining_count integer NOT NULL CHECK (remaining_count = 0)
) ON COMMIT DROP;

INSERT INTO purge_result_guard
SELECT count(*)
  FROM expense_requests request
 WHERE COALESCE(request.request_no, '') NOT LIKE 'ACC%'
   AND NOT EXISTS (
       SELECT 1
         FROM purge_keep_numbers keep
        WHERE keep.request_no = request.request_no
   );

\if :apply
COMMIT;
\echo 'PURGE COMMITTED: database rows deleted; physical files were not touched.'
\else
ROLLBACK;
\echo 'PREVIEW VALIDATION COMPLETE: every delete was tested and rolled back; no data changed.'
\endif
