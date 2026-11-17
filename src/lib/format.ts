import type { Commune, OrderStatus, Quartier } from '../types';

export function formatFcfa(amount: number): string {
  return `${Math.round(amount).toLocaleString('fr-FR')} FCFA`;
}

export function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

export function estimateScooterEtaMinutes(distanceKm: number): number {
  // Electric scooter average speed in Libreville urban traffic ~22 km/h + 2 min buffer
  return Math.max(1, Math.round((distanceKm / 22) * 60 + 1));
}

export function findNearestQuartier(
  point: { lat: number; lng: number },
  communes: Commune[]
): { commune: Commune; quartier: Quartier; distanceKm: number } | null {
  let bestCommune: Commune | null = null;
  let bestQuartier: Quartier | null = null;
  let bestDist = Infinity;

  for (const c of communes) {
    for (const q of c.quartiers) {
      const d = haversineKm(point, q);
      if (d < bestDist) {
        bestDist = d;
        bestCommune = c;
        bestQuartier = q;
      }
    }
  }

  if (!bestCommune || !bestQuartier) return null;
  return {
    commune: bestCommune,
    quartier: bestQuartier,
    distanceKm: Number(bestDist.toFixed(2)),
  };
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' }
> = {
  pending_company: { label: 'En attente prestataire', tone: 'amber' },
  negotiating_company_turn: { label: 'Négociation · Réponse entreprise', tone: 'amber' },
  negotiating_client_turn: { label: 'Contre-proposition reçue', tone: 'amber' },
  confirmed: { label: 'Confirmée · Prix verrouillé', tone: 'green' },
  en_route: { label: 'Équipe en route (GPS actif)', tone: 'green' },
  arrived: { label: 'Équipe arrivée sur place', tone: 'green' },
  in_progress: { label: 'Intervention en cours', tone: 'green' },
  awaiting_client_validation: { label: 'Validation client attendue', tone: 'amber' },
  completed: { label: 'Terminée & payée', tone: 'green' },
  disputed: { label: 'Réclamation ouverte', tone: 'red' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  airtel_money: 'Airtel Money',
  moov_money: 'Moov Money',
  cash: 'Espèces à la fin',
  card: 'Carte bancaire',
};
