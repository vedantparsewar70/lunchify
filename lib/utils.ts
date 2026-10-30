export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDatePretty(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTimePretty(dateStrOrObj: string | Date): string {
  const d = new Date(dateStrOrObj);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const APP_TIMEZONE = 'Asia/Kolkata';

export function getTodayString(timeZone: string = APP_TIMEZONE, at: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(at);
  } catch {
    const d = at;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export function getOffsetDateString(offsetDays: number, timeZone: string = APP_TIMEZONE): string {
  const todayStr = getTodayString(timeZone);
  const [year, month, day] = todayStr.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const targetYear = target.getUTCFullYear();
  const targetMonth = String(target.getUTCMonth() + 1).padStart(2, '0');
  const targetDay = String(target.getUTCDate()).padStart(2, '0');
  return `${targetYear}-${targetMonth}-${targetDay}`;
}

export function isDeadlinePassed(dateStr: string, deadlineTime: string = '08:30', at: Date = new Date()): boolean {
  try {
    const [hours, minutes] = deadlineTime.split(':').map(Number);
    // Explicitly parse in Asia/Kolkata timezone (+05:30)
    const deadline = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+05:30`);
    return at.getTime() > deadline.getTime();
  } catch {
    return false;
  }
}

export function getOrderStatusColor(status: string) {
  switch (status) {
    case 'CONFIRMED':
      return { bg: 'bg-blue-50 text-blue-700 border-blue-200', text: 'Confirmed', badge: 'bg-blue-500' };
    case 'PREPARING':
      return { bg: 'bg-amber-50 text-amber-700 border-amber-200', text: 'Preparing in Kitchen', badge: 'bg-amber-500' };
    case 'READY':
      return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'Ready for Pickup', badge: 'bg-emerald-500' };
    case 'COLLECTED':
      return { bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'Collected by Student', badge: 'bg-purple-500' };
    case 'CANCELLED':
      return { bg: 'bg-rose-50 text-rose-700 border-rose-200', text: 'Cancelled', badge: 'bg-rose-500' };
    case 'PENDING':
      return { bg: 'bg-yellow-50 text-yellow-700 border-yellow-200', text: 'Payment Pending', badge: 'bg-yellow-500' };
    default:
      return { bg: 'bg-slate-50 text-slate-700 border-slate-200', text: status, badge: 'bg-slate-500' };
  }
}
