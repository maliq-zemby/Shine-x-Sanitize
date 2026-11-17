import { useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  MessageSquare,
  Navigation,
  Phone,
  Send,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatFcfa, formatTime, ORDER_STATUS_META, PAYMENT_METHOD_LABEL } from '../lib/format';
import type { Agent, NotificationItem, Order, PaymentRecord } from '../types';
import { MapTracking, type MapMarkerItem } from './MapTracking';

interface ClientOrderTrackerProps {
  orders: Order[];
  agents: Agent[];
  notifications: NotificationItem[];
  mapsApiKey: string;
  preferredPaymentMethod?: PaymentRecord['method'];
  defaultPayPhone?: string;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onOrderUpdated: () => void;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ClientOrderTracker({
  orders,
  agents,
  notifications,
  mapsApiKey,
  preferredPaymentMethod,
  defaultPayPhone,
  selectedOrderId,
  onSelectOrder,
  onOrderUpdated,
}: ClientOrderTrackerProps) {
  const activeOrder =
    orders.find((o) => o.id === selectedOrderId) || orders[0] || null;

  const [newOfferInput, setNewOfferInput] = useState<string>('');
  const [chatText, setChatText] = useState('');
  const [chatPhoto, setChatPhoto] = useState<string | undefined>(undefined);
  const [payMethod, setPayMethod] = useState<PaymentRecord['method']>(
    preferredPaymentMethod || 'airtel_money'
  );
  const [payPhone, setPayPhone] = useState(defaultPayPhone || '+241 07 84 31 19');
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('Tache persistante ou zone oubliée');
  const [disputeDetails, setDisputeDetails] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!activeOrder) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center space-y-3">
        <p className="text-lg font-semibold text-[#0F172A]">Aucune commande enregistrée</p>
        <p className="text-sm text-[#475569]">
          Configurez votre première prestation pour suivre les négociations et le trajet GPS.
        </p>
      </div>
    );
  }

  const statusMeta = ORDER_STATUS_META[activeOrder.status];
  const assignedAgents = agents.filter((a) => activeOrder.assignedAgentIds.includes(a.id));
  const leadAgent = assignedAgents[0];

  const clientNotifs = notifications
    .filter((n) => n.orderId === activeOrder.id && n.targetRole === 'client')
    .slice(0, 5);

  const isTrackingLive = activeOrder.gpsActive && activeOrder.status === 'en_route';
  const hasArrivedOrDone = [
    'arrived',
    'in_progress',
    'awaiting_client_validation',
    'completed',
  ].includes(activeOrder.status);

  const mapMarkers: MapMarkerItem[] = [
    {
      id: 'client_home',
      position: activeOrder.clientLocation,
      label: `Domicile · ${activeOrder.quartierName}`,
      sublabel: activeOrder.addressDetails,
      kind: 'client',
    },
    ...(isTrackingLive
      ? assignedAgents.map((ag) => ({
          id: ag.id,
          position: ag.currentLocation,
          label: `${ag.name} (${ag.scooterTrackerId})`,
          sublabel:
            activeOrder.etaMinutes !== null
              ? `ETA : ${activeOrder.etaMinutes} min · ${activeOrder.distanceRemainingKm} km`
              : 'En déplacement vers vous',
          kind: 'agent' as const,
        }))
      : []),
  ];

  const runAction = async (fn: () => Promise<unknown>, successNote?: string) => {
    setBusyAction(true);
    setFeedback(null);
    try {
      await fn();
      if (successNote) setFeedback(successNote);
      onOrderUpdated();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur lors de l’opération.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleChatPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setChatPhoto(url);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E2E8F0] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">
            Suivi de vos commandes & interventions
          </h1>
          <p className="text-sm text-[#475569] mt-0.5">
            Négociation transparente, suivi GPS actif et dossier qualité avant / après.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Orders Sidebar */}
        <aside className="lg:col-span-4 space-y-2.5">
          {orders.map((ord) => {
            const meta = ORDER_STATUS_META[ord.status];
            const selected = ord.id === activeOrder.id;
            return (
              <button
                key={ord.id}
                type="button"
                onClick={() => onSelectOrder(ord.id)}
                className={`w-full text-left p-4 rounded-2xl border transition-all duration-150 cursor-pointer ${
                  selected
                    ? 'bg-white border-[#059669] shadow-sm'
                    : 'bg-white/80 border-[#E2E8F0] hover:border-[#10B981]'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-[#475569]">
                  <span className="font-mono font-semibold text-[#0F172A]">
                    {ord.referenceCode}
                  </span>
                  <span
                    className={`font-medium ${
                      meta.tone === 'green'
                        ? 'text-[#10B981]'
                        : meta.tone === 'red'
                        ? 'text-[#B91C1C]'
                        : 'text-[#B45309]'
                    }`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[#0F172A] mt-1">
                  {ord.config.categoryLabel}
                </p>
                <p className="text-xs text-[#475569] mt-0.5">
                  {ord.companyName} ·{' '}
                  <span className="font-mono tabular-nums text-[#0F172A]">
                    {formatFcfa(ord.finalLockedPriceFcfa ?? ord.currentOfferFcfa)}
                  </span>
                </p>
              </button>
            );
          })}
        </aside>

        {/* Active Order Dossier */}
        <div className="lg:col-span-8 space-y-6">
          {/* Header Card */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569]">
                  <span className="font-mono font-semibold text-[#0F172A]">
                    {activeOrder.referenceCode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeOrder.quartierName}, {activeOrder.communeName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeOrder.config.scheduledDate} à {activeOrder.config.scheduledTime}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-[#0F172A] mt-1">
                  {activeOrder.config.categoryLabel} — {activeOrder.companyName}
                </h2>
                <p className="text-xs text-[#475569] mt-1">{activeOrder.addressDetails}</p>
              </div>

              <div className="text-left sm:text-right shrink-0">
                <p
                  className={`text-xs font-semibold ${
                    statusMeta.tone === 'green'
                      ? 'text-[#10B981]'
                      : statusMeta.tone === 'red'
                      ? 'text-[#B91C1C]'
                      : 'text-[#B45309]'
                  }`}
                >
                  {statusMeta.label}
                </p>
                <p className="text-xl font-bold font-mono tabular-nums text-[#0F172A] mt-0.5">
                  {formatFcfa(activeOrder.finalLockedPriceFcfa ?? activeOrder.currentOfferFcfa)}
                </p>
                {activeOrder.priceLocked && (
                  <p className="text-[11px] text-[#059669] inline-flex items-center gap-1 mt-0.5">
                    <Lock className="w-3 h-3" /> Prix définitif verrouillé
                  </p>
                )}
              </div>
            </div>

            {feedback && (
              <div className="p-3 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] text-xs text-[#0F172A]">
                {feedback}
              </div>
            )}

            {/* Automatic Notifications Feed */}
            {clientNotifs.length > 0 && (
              <div className="pt-3 border-t border-[#E2E8F0] space-y-1.5">
                <p className="text-xs font-semibold text-[#0F172A]">Notifications automatiques</p>
                {clientNotifs.map((n) => (
                  <div key={n.id} className="flex items-start justify-between gap-2 text-xs">
                    <span className="text-[#475569]">
                      <strong className="text-[#0F172A]">{n.title}</strong> — {n.body}
                    </span>
                    <span className="font-mono tabular-nums text-[#475569] shrink-0">
                      {formatTime(n.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Real-Time GPS Section (Privacy-gated to active intervention travel) */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-[#059669]" />
                  Suivi GPS de l’équipe en temps réel
                </h3>
                <p className="text-xs text-[#475569] mt-0.5">
                  {isTrackingLive
                    ? 'Partage GPS en direct actif uniquement pendant le trajet vers votre adresse.'
                    : hasArrivedOrDone
                    ? 'Suivi GPS clôturé : votre équipe est arrivée à destination.'
                    : 'La carte et la position de l’équipe restent masquées par confidentialité jusqu’au départ de l’agent.'}
                </p>
              </div>

              {isTrackingLive && activeOrder.etaMinutes !== null && (
                <div className="text-left sm:text-right">
                  <p className="text-sm font-bold font-mono tabular-nums text-[#059669]">
                    ETA : {activeOrder.etaMinutes} min
                  </p>
                  <p className="text-xs text-[#475569] font-mono tabular-nums">
                    Distance restante : {activeOrder.distanceRemainingKm} km
                  </p>
                  {(activeOrder.lastGpsSyncAt || leadAgent?.lastGpsSyncAt) && (
                    <p className="text-[11px] text-[#059669] font-mono tabular-nums mt-0.5">
                      Synchro temps réel (6s) :{' '}
                      {formatTime(activeOrder.lastGpsSyncAt || leadAgent?.lastGpsSyncAt || '')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {isTrackingLive ? (
              <MapTracking
                apiKey={mapsApiKey}
                center={leadAgent?.currentLocation || activeOrder.clientLocation}
                zoom={14}
                markers={mapMarkers}
                routeOrigin={leadAgent?.currentLocation}
                routeDestination={activeOrder.clientLocation}
                trail={activeOrder.gpsHistory.map((p) => ({ lat: p.lat, lng: p.lng }))}
                heightClass="h-[320px]"
              />
            ) : hasArrivedOrDone ? (
              <div className="rounded-lg bg-[#F1F5F9] border border-[#059669]/25 p-4 text-xs text-[#0F172A] flex items-center justify-between gap-3">
                <span>
                  <strong>Votre équipe est arrivée sur place</strong> — Le partage GPS en temps réel
                  a été automatiquement désactivé pour préserver la confidentialité.
                </span>
                {activeOrder.arrivedAt && (
                  <span className="font-mono tabular-nums text-[#059669] shrink-0">
                    Arrivée à {formatTime(activeOrder.arrivedAt)}
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-4 text-xs text-[#475569]">
                Dès que l’agent cliquera sur « Activer mon départ / Démarrer la navigation vers le
                client » depuis son application terrain, la carte Google Maps s’activera ici avec sa
                position, la distance restante et l’ETA en direct.
              </div>
            )}

            {assignedAgents.length > 0 && (
              <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-[#0F172A]">
                    Équipe affectée ({assignedAgents.length} agent{assignedAgents.length > 1 ? 's' : ''})
                  </p>
                  <p className="text-xs text-[#475569]">
                    {assignedAgents
                      .map((a) => `${a.name} (${a.specialty} · ★ ${a.rating})`)
                      .join(' · ')}
                  </p>
                </div>
                {leadAgent && (
                  <a
                    href={`tel:${leadAgent.phone}`}
                    className="btn-secondary px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#059669]" />
                    Contacter {leadAgent.name}
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Price Negotiation & Lock Ledger */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0F172A]">
                Historique & verrouillage du prix
              </h3>
              <span className="text-xs text-[#475569] font-mono tabular-nums">
                Référence : {formatFcfa(activeOrder.referencePriceFcfa + activeOrder.extrasPriceFcfa + activeOrder.travelFeeFcfa)}
              </span>
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {activeOrder.negotiationHistory.map((entry) => (
                <div key={entry.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <p className="font-semibold text-[#0F172A]">{entry.actorName}</p>
                    <p className="text-[#475569] mt-0.5">{entry.note}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono tabular-nums font-semibold text-[#0F172A]">
                      {formatFcfa(entry.amountFcfa)}
                    </p>
                    <p className="font-mono text-[11px] text-[#475569]">
                      {formatTime(entry.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {!activeOrder.priceLocked && activeOrder.status === 'negotiating_client_turn' && (
              <div className="pt-4 border-t border-[#E2E8F0] bg-[#F8FAFC] rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-[#0F172A]">
                  Le prestataire propose{' '}
                  <span className="font-mono tabular-nums text-[#059669]">
                    {formatFcfa(activeOrder.currentOfferFcfa)}
                  </span>
                  . Validez ce montant ou formulez une nouvelle offre :
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() =>
                      runAction(
                        () =>
                          api.negotiateOrder(activeOrder.id, {
                            actor: 'client',
                            action: 'accept',
                          }),
                        'Prix final validé et verrouillé.'
                      )
                    }
                    className="btn-primary px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Valider {formatFcfa(activeOrder.currentOfferFcfa)}
                  </button>

                  <input
                    type="number"
                    step={500}
                    placeholder="Autre montant (FCFA)"
                    value={newOfferInput}
                    onChange={(e) => setNewOfferInput(e.target.value)}
                    className="h-9 px-3 text-xs font-mono bg-white border border-[#E2E8F0] rounded-lg w-44"
                  />
                  <button
                    type="button"
                    disabled={busyAction || !newOfferInput}
                    onClick={() =>
                      runAction(
                        () =>
                          api.negotiateOrder(activeOrder.id, {
                            actor: 'client',
                            action: 'client_offer',
                            amountFcfa: Number(newOfferInput),
                          }),
                        'Nouvelle offre envoyée au prestataire.'
                      )
                    }
                    className="btn-outline-green px-3.5 py-2 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                  >
                    Contre-proposer
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Digital Quality Control Dossier */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#059669]" />
              Dossier numérique de contrôle qualité
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3.5 space-y-1">
                <p className="font-semibold text-[#0F172A]">Prestation & état initial</p>
                <p className="text-[#475569]">
                  {activeOrder.config.furnitureType || activeOrder.config.categoryLabel}
                  {activeOrder.config.material ? ` · ${activeOrder.config.material}` : ''}
                  {activeOrder.config.condition ? ` · ${activeOrder.config.condition}` : ''}
                </p>
                {activeOrder.config.stains && activeOrder.config.stains.length > 0 && (
                  <p className="text-[#475569]">
                    Taches signalées : {activeOrder.config.stains.join(', ')}
                  </p>
                )}
              </div>

              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3.5 space-y-1">
                <p className="font-semibold text-[#0F172A]">Horodatage d’intervention</p>
                <p className="text-[#475569] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Début : {formatDateTime(activeOrder.startedWorkAt)} · Fin :{' '}
                  {formatDateTime(activeOrder.completedWorkAt)}
                </p>
                <p className="text-[#475569]">
                  Note transparence : le résultat sur les taches anciennes dépend de leur ancienneté et de la fibre textile.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-[#0F172A] mb-2">
                  Photos avant intervention ({activeOrder.beforePhotos.length})
                </p>
                {activeOrder.beforePhotos.length === 0 ? (
                  <p className="text-xs text-[#475569]">Aucune photo jointe.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {activeOrder.beforePhotos.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Avant ${i + 1}`}
                        className="h-20 w-full object-cover rounded-lg border border-[#E2E8F0]"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-[#0F172A] mb-2">
                  Photos après intervention ({activeOrder.afterPhotos.length})
                </p>
                {activeOrder.afterPhotos.length === 0 ? (
                  <p className="text-xs text-[#475569]">
                    Ajoutées par l’équipe à la fin de l’intervention.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {activeOrder.afterPhotos.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Après ${i + 1}`}
                        className="h-20 w-full object-cover rounded-lg border border-[#E2E8F0]"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Client Validation + Payment + Claim */}
            {activeOrder.status === 'awaiting_client_validation' && !activeOrder.payment && (
              <div className="pt-4 border-t border-[#E2E8F0] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">
                      Confirmer la fin de prestation & procéder au paiement
                    </p>
                    <p className="text-xs text-[#475569]">
                      Montant convenu verrouillé :{' '}
                      <strong className="font-mono tabular-nums text-[#059669]">
                        {formatFcfa(activeOrder.finalLockedPriceFcfa ?? activeOrder.currentOfferFcfa)}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDisputeOpen(!disputeOpen)}
                    className="text-xs font-medium text-[#B91C1C] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Signaler une insatisfaction
                  </button>
                </div>

                {!disputeOpen ? (
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: 'airtel_money', label: 'Airtel Money' },
                          { id: 'moov_money', label: 'Moov Money' },
                          { id: 'cash', label: 'Espèces' },
                          { id: 'card', label: 'Carte bancaire' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPayMethod(m.id)}
                          className={`px-3 py-2 text-xs font-medium cursor-pointer ${
                            payMethod === m.id ? 'btn-chip-active font-semibold' : 'btn-chip'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {(payMethod === 'airtel_money' || payMethod === 'moov_money') && (
                        <input
                          type="tel"
                          value={payPhone}
                          onChange={(e) => setPayPhone(e.target.value)}
                          placeholder="Numéro Mobile Money (+241...)"
                          className="h-10 px-3 text-xs font-mono bg-white border border-[#E2E8F0] rounded-lg w-60"
                        />
                      )}
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          runAction(
                            () =>
                              api.payOrder(activeOrder.id, {
                                method: payMethod,
                                phoneOrRef: payPhone,
                              }),
                            'Prestation confirmée et paiement enregistré.'
                          )
                        }
                        className="btn-primary px-5 py-2.5 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                      >
                        <CreditCard className="w-4 h-4" />
                        Confirmer & payer ({PAYMENT_METHOD_LABEL[payMethod]})
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-[#B91C1C]">
                      Ouvrir une réclamation qualité auprès de l’administration
                    </p>
                    <input
                      type="text"
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      className="w-full h-9 px-3 text-xs bg-white border border-[#FECACA] rounded-lg"
                    />
                    <textarea
                      rows={2}
                      value={disputeDetails}
                      onChange={(e) => setDisputeDetails(e.target.value)}
                      placeholder="Décrivez précisément le motif de votre insatisfaction..."
                      className="w-full p-2.5 text-xs bg-white border border-[#FECACA] rounded-lg"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          runAction(
                            () =>
                              api.openDispute(activeOrder.id, {
                                reason: disputeReason,
                                details: disputeDetails,
                              }),
                            'Réclamation transmise à l’administrateur central.'
                          )
                        }
                        className="btn-danger-solid px-4 py-2 text-xs font-semibold cursor-pointer"
                      >
                        Soumettre la réclamation
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisputeOpen(false)}
                        className="btn-secondary px-3.5 py-2 text-xs font-medium cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Payment Receipt & Rating */}
            {activeOrder.payment && (
              <div className="pt-4 border-t border-[#E2E8F0] space-y-4">
                <div className="bg-[#F1F5F9] border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-[#059669] font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    Paiement confirmé via {PAYMENT_METHOD_LABEL[activeOrder.payment.method]}
                  </div>
                  <span className="font-mono tabular-nums text-[#0F172A]">
                    {formatFcfa(activeOrder.payment.grossAmountFcfa)} ·{' '}
                    {formatDateTime(activeOrder.payment.paidAt)}
                  </span>
                </div>

                {!activeOrder.review ? (
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Évaluer la prestation de {activeOrder.companyName}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(n)}
                          className="p-1 cursor-pointer"
                          aria-label={`Note ${n} sur 5`}
                        >
                          <Star
                            className={`w-5 h-5 ${
                              n <= rating
                                ? 'text-[#059669] fill-[#059669]'
                                : 'text-[#CBD5CE]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Partagez votre avis sur la ponctualité et la qualité..."
                        className="flex-1 h-9 px-3 text-xs bg-white border border-[#E2E8F0] rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          runAction(
                            () =>
                              api.reviewOrder(activeOrder.id, {
                                rating,
                                comment: reviewComment || 'Prestation très satisfaisante.',
                              }),
                            'Merci pour votre évaluation !'
                          )
                        }
                        className="btn-primary px-4 py-2 text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        Publier l’avis
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#475569]">
                    Votre avis publié :{' '}
                    <strong className="text-[#0F172A]">{activeOrder.review.rating}/5</strong> — «{' '}
                    {activeOrder.review.comment} »
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order Messaging with Photos */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#059669]" />
              Messagerie archivée avec le prestataire
            </h3>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {activeOrder.messages.length === 0 ? (
                <p className="text-xs text-[#475569]">
                  Aucun message pour l’instant. Vos échanges et photos restent archivés dans le dossier de commande.
                </p>
              ) : (
                activeOrder.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-lg text-xs ${
                      m.senderRole === 'client'
                        ? 'bg-[#F1F5F9] ml-8'
                        : 'bg-[#F8FAFC] border border-[#E2E8F0] mr-8'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#475569] mb-1">
                      <span className="font-semibold text-[#0F172A]">{m.senderName}</span>
                      <span className="font-mono">{formatTime(m.timestamp)}</span>
                    </div>
                    {m.text && <p className="text-[#0F172A]">{m.text}</p>}
                    {m.photoDataUrl && (
                      <img
                        src={m.photoDataUrl}
                        alt="Pièce jointe"
                        className="mt-2 h-28 rounded-md object-cover border border-[#E2E8F0]"
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2E8F0]">
              <label className="btn-secondary h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <Camera className="w-3.5 h-3.5 text-[#059669]" />
                {chatPhoto ? 'Photo prête' : 'Photo'}
                <input type="file" accept="image/*" onChange={handleChatPhoto} className="hidden" />
              </label>
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Écrire un message ou une précision d’accès..."
                className="flex-1 min-w-[180px] h-9 px-3 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg"
              />
              <button
                type="button"
                disabled={busyAction || (!chatText.trim() && !chatPhoto)}
                onClick={() =>
                  runAction(async () => {
                    await api.sendMessage(activeOrder.id, {
                      senderRole: 'client',
                      senderName: activeOrder.clientName,
                      text: chatText,
                      photoDataUrl: chatPhoto,
                    });
                    setChatText('');
                    setChatPhoto(undefined);
                  })
                }
                className="btn-primary h-9 px-4 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Envoyer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
