import type { Company, DayOfWeekKey } from '../types';

export const WEEKDAYS_META: {
  id: DayOfWeekKey;
  label: string;
  short: string;
  jsDay: number;
}[] = [
  { id: 'monday', label: 'Lundi', short: 'Lun', jsDay: 1 },
  { id: 'tuesday', label: 'Mardi', short: 'Mar', jsDay: 2 },
  { id: 'wednesday', label: 'Mercredi', short: 'Mer', jsDay: 3 },
  { id: 'thursday', label: 'Jeudi', short: 'Jeu', jsDay: 4 },
  { id: 'friday', label: 'Vendredi', short: 'Ven', jsDay: 5 },
  { id: 'saturday', label: 'Samedi', short: 'Sam', jsDay: 6 },
  { id: 'sunday', label: 'Dimanche', short: 'Dim', jsDay: 0 },
];

export const DEFAULT_OPENING_DAYS: DayOfWeekKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
export const DEFAULT_OPENING_TIME = '08:00';
export const DEFAULT_CLOSING_TIME = '18:00';

const VALID_DAY_SET = new Set<DayOfWeekKey>(WEEKDAYS_META.map((d) => d.id));

export function normalizeOpeningDays(days?: unknown): DayOfWeekKey[] {
  if (!Array.isArray(days)) return [];
  const selected = new Set<DayOfWeekKey>();
  for (const item of days) {
    if (typeof item === 'string' && VALID_DAY_SET.has(item as DayOfWeekKey)) {
      selected.add(item as DayOfWeekKey);
    }
  }
  return WEEKDAYS_META.map((d) => d.id).filter((id) => selected.has(id));
}

export function parseTimeMinutes(hhmm?: string): number | null {
  if (typeof hhmm !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatCompanyWorkingHours(
  openingDays: DayOfWeekKey[],
  openingTime: string,
  closingTime: string
): string {
  const ordered = normalizeOpeningDays(openingDays);
  if (ordered.length === 0) return `Fermé · ${openingTime} – ${closingTime}`;

  let daysLabel = '';
  if (ordered.length === 7) {
    daysLabel = '7j/7';
  } else if (
    ordered.length === 6 &&
    !ordered.includes('sunday')
  ) {
    daysLabel = 'Lundi au Samedi';
  } else if (
    ordered.length === 5 &&
    !ordered.includes('saturday') &&
    !ordered.includes('sunday')
  ) {
    daysLabel = 'Lundi au Vendredi';
  } else {
    daysLabel = ordered
      .map((id) => WEEKDAYS_META.find((d) => d.id === id)?.short || id)
      .join(', ');
  }

  return `${daysLabel} · ${openingTime} – ${closingTime}`;
}

export function getCompanySchedule(
  company: Pick<Company, 'openingDays' | 'openingTime' | 'closingTime' | 'workingHours'>
): {
  openingDays: DayOfWeekKey[];
  openingTime: string;
  closingTime: string;
  label: string;
} {
  const normalizedDays = normalizeOpeningDays(company.openingDays);
  const openingDays = normalizedDays.length > 0 ? normalizedDays : DEFAULT_OPENING_DAYS;
  const openingTime =
    parseTimeMinutes(company.openingTime) !== null
      ? company.openingTime!.trim()
      : DEFAULT_OPENING_TIME;
  const closingTime =
    parseTimeMinutes(company.closingTime) !== null
      ? company.closingTime!.trim()
      : DEFAULT_CLOSING_TIME;

  return {
    openingDays,
    openingTime,
    closingTime,
    label: formatCompanyWorkingHours(openingDays, openingTime, closingTime),
  };
}

export function validateBookingSlotForCompany(
  company: Pick<Company, 'name' | 'openingDays' | 'openingTime' | 'closingTime' | 'workingHours'>,
  scheduledDate: string,
  scheduledTime: string
): { valid: true; officialLabel: string } | { valid: false; reason: string; officialLabel: string } {
  const schedule = getCompanySchedule(company);

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((scheduledDate || '').trim());
  if (!dateMatch) {
    return {
      valid: false,
      officialLabel: schedule.label,
      reason: `Veuillez sélectionner une date valide. Horaires officiels de ${company.name} : ${schedule.label}.`,
    };
  }

  const localDate = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3])
  );
  const jsDay = localDate.getDay();
  const dayMeta = WEEKDAYS_META.find((d) => d.jsDay === jsDay);

  if (!dayMeta || !schedule.openingDays.includes(dayMeta.id)) {
    const dayNameLower = (dayMeta?.label || 'ce jour').toLowerCase();
    return {
      valid: false,
      officialLabel: schedule.label,
      reason: `${company.name} est fermée le ${dayNameLower}. Horaires officiels : ${schedule.label}.`,
    };
  }

  const slotMinutes = parseTimeMinutes(scheduledTime);
  const openMinutes = parseTimeMinutes(schedule.openingTime) ?? 8 * 60;
  const closeMinutes = parseTimeMinutes(schedule.closingTime) ?? 18 * 60;

  if (slotMinutes === null) {
    return {
      valid: false,
      officialLabel: schedule.label,
      reason: `Veuillez choisir une heure valide entre ${schedule.openingTime} et ${schedule.closingTime} (${schedule.label}).`,
    };
  }

  if (slotMinutes < openMinutes || slotMinutes > closeMinutes) {
    return {
      valid: false,
      officialLabel: schedule.label,
      reason: `L’heure choisie (${scheduledTime}) est en dehors des horaires d’ouverture de ${company.name}. Horaires officiels : ${schedule.label}.`,
    };
  }

  return { valid: true, officialLabel: schedule.label };
}

export function suggestNextOpenSlotForCompany(
  company: Pick<Company, 'openingDays' | 'openingTime' | 'closingTime' | 'workingHours'>,
  startDateStr?: string
): { scheduledDate: string; scheduledTime: string } {
  const schedule = getCompanySchedule(company);
  const baseMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((startDateStr || '').trim());
  const start = baseMatch
    ? new Date(Number(baseMatch[1]), Number(baseMatch[2]) - 1, Number(baseMatch[3]))
    : new Date();

  for (let offset = 0; offset < 14; offset += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dayMeta = WEEKDAYS_META.find((m) => m.jsDay === d.getDay());
    if (dayMeta && schedule.openingDays.includes(dayMeta.id)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return {
        scheduledDate: `${yyyy}-${mm}-${dd}`,
        scheduledTime: schedule.openingTime,
      };
    }
  }

  const fallback = new Date();
  return {
    scheduledDate: `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`,
    scheduledTime: schedule.openingTime,
  };
}
