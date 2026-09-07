import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is asking, and on behalf of which office.
 *
 * `officeId` is the tenant key that every query is narrowed by.
 * `isSuperAdmin` lifts that narrowing - only the platform owner gets it, and
 * it is the single place in the codebase where cross-office reads are possible.
 */
export interface TenantContext {
  officeId: string | null;
  isSuperAdmin: boolean;
  userId?: string | null;
  actor?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const TenantStore = {
  run<T>(context: TenantContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  get(): TenantContext | undefined {
    return storage.getStore();
  },

  /**
   * Scope a unit of work to one office (webhook handlers, cron jobs).
   *
   * The callback is awaited *inside* the scope deliberately. Prisma promises
   * are lazy - the query is only issued once something awaits them - so
   * returning one unawaited would execute it after the scope had closed, with
   * no tenant filter attached.
   */
  async runAsOffice<T>(officeId: string, fn: () => T | Promise<T>, actor = 'system'): Promise<T> {
    return storage.run({ officeId, isSuperAdmin: false, actor }, async () => {
      return await fn();
    });
  },

  /** Platform-level work that legitimately spans every office. */
  async runAsSuperAdmin<T>(fn: () => T | Promise<T>, userId?: string): Promise<T> {
    return storage.run(
      { officeId: null, isSuperAdmin: true, userId, actor: 'super-admin' },
      async () => {
        return await fn();
      },
    );
  },

  requireOfficeId(): string {
    const officeId = storage.getStore()?.officeId;
    if (!officeId) {
      throw new Error('No office in scope: this operation requires a tenant context.');
    }
    return officeId;
  },
};
