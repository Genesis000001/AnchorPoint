import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

interface AppliedMigrationRow {
  migration_name: string;
}

function getMigrationDirNames(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((entry) =>
    fs.statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory()
  );
}

async function getAppliedMigrationNames(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<AppliedMigrationRow[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return new Set(rows.map((row) => row.migration_name));
}

/**
 * Verifies that every migration committed under prisma/migrations has been
 * applied to the connected database. In production, a mismatch aborts the
 * boot instead of letting the server serve requests against a stale schema.
 * Pass --skip-migration-check to bypass this (development use only).
 */
export async function checkMigrationsOnStartup(): Promise<void> {
  if (process.argv.includes('--skip-migration-check')) {
    logger.warn('Skipping database migration check (--skip-migration-check flag present).');
    return;
  }

  const migrationDirs = getMigrationDirNames();
  if (migrationDirs.length === 0) {
    return;
  }

  let appliedMigrations: Set<string>;
  try {
    appliedMigrations = await getAppliedMigrationNames();
  } catch (error) {
    logger.error('Migration startup check: failed to read migration history from the database.', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    return;
  }

  const pending = migrationDirs.filter((name) => !appliedMigrations.has(name));
  if (pending.length === 0) {
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    logger.error(`Migration startup check: pending database migrations detected: ${pending.join(', ')}. Aborting boot.`);
    process.exit(1);
  }

  logger.warn(`Migration startup check: pending database migrations detected: ${pending.join(', ')}. Continuing because NODE_ENV is not "production".`);
}
