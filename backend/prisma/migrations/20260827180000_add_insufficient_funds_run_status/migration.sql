-- AlterEnum for RecurringPaymentRunStatus: add INSUFFICIENT_FUNDS
-- PostgreSQL enums cannot be altered in place; append the new value.
ALTER TYPE "RecurringPaymentRunStatus" ADD VALUE IF NOT EXISTS 'INSUFFICIENT_FUNDS';