/**
 * Per-date service state for parent orders.
 *
 * One paid order can cover several service dates (one payment, one refund ID). Preparation and
 * handover are tracked per date in `order.serviceDates[date]`, so giving Monday's meal never marks
 * Tuesday's meal as given. The order-level `orderStatus` is derived: it is the least advanced
 * status across the order's dates, so an order is COLLECTED only when every date was handed over.
 *
 * Orders saved before per-date tracking have no `serviceDates`; their order-level status applies
 * to every date (that is what it meant when it was written). No migration is needed: the first
 * per-date write copies that status to every date, then changes only the requested one.
 */

export const SERVICE_STEPS = ['CONFIRMED', 'PREPARING', 'READY', 'COLLECTED'] as const;
export type ServiceStatus = (typeof SERVICE_STEPS)[number];

export interface ServiceDateState {
  status: ServiceStatus;
  collectedAt?: string | null;
  collectedBy?: string | null;
  revertedAt?: string | null;
  revertedBy?: string | null;
  updatedAt?: string | null;
}

export class ServiceDateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ServiceDateError';
    this.status = status;
  }
}

/** The order fields this module reads (a Firestore order document satisfies it). */
export interface ServiceOrder {
  orderStatus?: string;
  paymentStatus?: string;
  collectedAt?: string | null;
  serviceDates?: Record<string, Partial<ServiceDateState>> | null;
}

export function isServiceStatus(value: unknown): value is ServiceStatus {
  return SERVICE_STEPS.includes(value as ServiceStatus);
}

/** Sorted, distinct service dates of an order's items. */
export function orderServiceDates(items: Array<{ date?: string | null }>): string[] {
  return Array.from(new Set(items.map((it) => it.date).filter((d): d is string => Boolean(d)))).sort();
}

function legacyStatus(order: ServiceOrder): ServiceStatus {
  return isServiceStatus(order.orderStatus) ? order.orderStatus : 'CONFIRMED';
}

/** Status of one service date: CANCELLED for a cancelled order, otherwise the date's own status. */
export function serviceStatusFor(order: ServiceOrder, date: string): ServiceStatus | 'CANCELLED' {
  if (order.orderStatus === 'CANCELLED') return 'CANCELLED';
  const entry = order.serviceDates?.[date];
  return isServiceStatus(entry?.status) ? entry.status : legacyStatus(order);
}

/** Per-date state for every date, filling dates without an entry from the legacy order status. */
export function serviceStatesFor(order: ServiceOrder, dates: string[]): Record<string, ServiceDateState> {
  const states: Record<string, ServiceDateState> = {};
  for (const date of dates) {
    const entry = order.serviceDates?.[date];
    states[date] = entry && isServiceStatus(entry.status) ? { ...entry, status: entry.status } : { status: legacyStatus(order) };
  }
  return states;
}

/** Least advanced status across the dates (COLLECTED only when every date is collected). */
export function overallServiceStatus(states: Record<string, ServiceDateState>): ServiceStatus {
  const indexes = Object.values(states).map((s) => SERVICE_STEPS.indexOf(s.status));
  return indexes.length ? SERVICE_STEPS[Math.min(...indexes)] : 'CONFIRMED';
}

/**
 * The service date a status change applies to. A single-date order may omit it (older screens
 * and scripts do); a multi-date order must name it, so one click can never cover several days.
 */
export function resolveServiceDate(dates: string[], requested: unknown): string {
  if (typeof requested === 'string' && requested) {
    if (!dates.includes(requested)) {
      throw new ServiceDateError(`This order has no meal on ${requested}.`, 400);
    }
    return requested;
  }
  if (dates.length === 1) return dates[0];
  if (dates.length === 0) throw new ServiceDateError('This order has no meals to update.', 400);
  throw new ServiceDateError('This order covers several days. Choose the service date to update.', 400);
}

export interface ServiceUpdate {
  serviceDates: Record<string, ServiceDateState>;
  orderStatus: ServiceStatus;
  collectedAt?: string;
  updatedAt: string;
}

/**
 * Computes the writes for moving one service date to `status`. Pure: the caller reads the order
 * and its items inside a transaction and applies the returned fields.
 * - Only paid, non-cancelled orders move forward (CONFIRMED is the undo and is always allowed).
 * - A date already given cannot be given again (409); a given date can only be reverted to CONFIRMED.
 * - Reverting keeps the original handover time and records who reverted it.
 * - `order.collectedAt` keeps the first handover of any date, so staff can never cancel and refund
 *   an order once any part of it was handed over (see cancelOrderWithRefund).
 */
export function applyServiceStatus(
  order: ServiceOrder,
  dates: string[],
  date: string,
  status: ServiceStatus,
  actorId: string,
  now: string
): ServiceUpdate {
  if (order.orderStatus === 'CANCELLED') {
    throw new ServiceDateError('This order has already been cancelled and cannot be modified.');
  }
  if (status !== 'CONFIRMED' && order.paymentStatus !== 'PAID') {
    throw new ServiceDateError('Cannot mark an unpaid, pending or refunded order as prepared or collected.');
  }

  const states = serviceStatesFor(order, dates);
  const current = states[date];
  if (current.status === 'COLLECTED') {
    if (status === 'COLLECTED') {
      throw new ServiceDateError(`The meal for ${date} has already been marked as given.`, 409);
    }
    if (status !== 'CONFIRMED') {
      throw new ServiceDateError('Collected orders can only be reverted back to active.');
    }
    states[date] = { ...current, status, revertedAt: now, revertedBy: actorId, updatedAt: now };
  } else if (status === 'COLLECTED') {
    states[date] = { ...current, status, collectedAt: now, collectedBy: actorId, updatedAt: now };
  } else {
    states[date] = { ...current, status, updatedAt: now };
  }

  const update: ServiceUpdate = { serviceDates: states, orderStatus: overallServiceStatus(states), updatedAt: now };
  if (status === 'COLLECTED' && !order.collectedAt) update.collectedAt = now;
  return update;
}
