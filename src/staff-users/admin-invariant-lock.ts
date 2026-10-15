import { Prisma } from '@prisma/client';

/**
 * Serializes transactions that can create the first administrator or remove an
 * administrator. The lock is scoped to the transaction and needs no schema row.
 */
export async function acquireAdministratorInvariantLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw<Array<{ locked: number }>>`
    WITH lock_acquired AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(483819, 104729)
    )
    SELECT 1 AS locked FROM lock_acquired
  `;
}
