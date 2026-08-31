-- Rollback: remove INSUFFICIENT_FUNDS from RecurringPaymentRunStatus.
-- Any runs in INSUFFICIENT_FUNDS are reassigned to FAILED first.
UPDATE "RecurringPaymentRun" SET "status" = 'FAILED' WHERE "status" = 'INSUFFICIENT_FUNDS';