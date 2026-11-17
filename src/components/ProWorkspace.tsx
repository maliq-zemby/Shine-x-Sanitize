import { useEffect, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  Lock,
  MapPin,
  Navigation,
  Play,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useAgentForegroundGps } from '../hooks/useAgentForegroundGps';
import { api } from '../lib/api';
import { formatDateTime, formatFcfa, ORDER_STATUS_META } from '../lib/format';
import type { Agent, Company, NotificationItem, Order, PaymentRecord, RegisteredUser } from '../types';
import { MapTracking } from './MapTracking';

interface ProWorkspaceProps {
  companies: Company[];
  agents: Agent[];
  orders: Order[];
  transactions: PaymentRecord[];
  notifications: NotificationItem[];
  currentUser: RegisteredUser | null;
  mapsApiKey: string;
  onDataChanged: () => void;
  onProfileUpdated?: (user: RegisteredUser) => void;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProWorkspace({
  companies,
  agents,
  orders,
  transactions,
  notifications,
  currentUser,
  mapsApiKey,
  onDataChanged,
  onProfileUpdated,
}: ProWorkspaceProps) {
  const [proTab, setProTab] = useState<'company' | 'agent'>(
    currentUser?.preferences?.lastProTab ||
      (currentUser?.role === 'agent' ? 'agent' : 'company')
  );
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const approvedCompanies = companies.filter((c) => c.approvalStatus === 'approved');
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    currentUser?.companyId || approvedCompanies[0]?.id || companies[0]?.id || ''
  );

  const companyAgents = agents.filter((a) => a.companyId === selectedCompanyId);
  const [selectedAgentId, setSelectedAgentId] = useState(
    currentUser?.agentId || companyAgents[0]?.id || ''
  );

  useEffect(() => {
    if (currentUser?.preferences?.lastProTab) {
      setProTab(currentUser.preferences.lastProTab);
    } else if (currentUser?.role === 'company' && currentUser.companyId) {
      setProTab('company');
    } else if (currentUser?.role === 'agent' && currentUser.agentId) {
      setProTab('agent');
    }
    if (currentUser?.companyId) {
      setSelectedCompanyId(currentUser.companyId);
    }
    if (currentUser?.agentId) {
      setSelectedAgentId(currentUser.agentId);
    }
  }, [currentUser]);

  useEffect(() => {
    const first = agents.find((a) => a.companyId === selectedCompanyId);
    if (first && !agents.some((a) => a.id === selectedAgentId && a.companyId === selectedCompanyId)) {
      setSelectedAgentId(first.id);
    }
  }, [selectedCompanyId, agents, selectedAgentId]);

  const [counterOfferMap, setCounterOfferMap] = useState<Record<string, string>>({});
  const [assignSelection, setAssignSelection] = useState<Record<string, string[]>>({});
  const [companyChatMap, setCompanyChatMap] = useState<Record<string, string>>({});
  const [afterPhotoQueue, setAfterPhotoQueue] = useState<Record<string, string[]>>({});
  const [issueText, setIssueText] = useState('');
  const [autoDriveOrderId, setAutoDriveOrderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Automatic scooter route simulation when manually toggled in Agent view
  useEffect(() => {
    if (!autoDriveOrderId) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.updateGps(autoDriveOrderId, {
          stepTowardClient: 0.35,
          source: 'scooter_tracker',
        });
        onDataChanged();
        if (updated.status === 'arrived' || !updated.gpsActive) {
          setAutoDriveOrderId(null);
        }
      } catch {
        setAutoDriveOrderId(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [autoDriveOrderId, onDataChanged]);

  const activeCompany = companies.find((c) => c.id === selectedCompanyId) || companies[0];
  const companyOrders = orders.filter((o) => o.companyId === activeCompany?.id);
  const companyTransactions = transactions.filter((t) =>
    companyOrders.some((o) => o.id === t.orderId)
  );
  const totalNetRevenue = companyTransactions
    .filter((t) => t.status === 'paid')
    .reduce((acc, t) => acc + t.companyNetFcfa, 0);

  const activeAgent = agents.find((a) => a.id === selectedAgentId) || companyAgents[0];
  const agentOrders = orders.filter(
    (o) =>
      activeAgent &&
      o.assignedAgentIds.includes(activeAgent.id) &&
      !['completed', 'cancelled'].includes(o.status)
  );

  // Foreground & background GPS service (Always Allow + 6s periodic DB sync + offline queue + WakeLock)
  const activeEnRouteOrder = agentOrders.find((o) => o.status === 'en_route' && o.gpsActive);
  const activeMissionOrder = agentOrders[0];
  const foregroundGps = useAgentForegroundGps({
    agent: activeAgent,
    activeEnRouteOrder,
    activeMissionOrder,
    onSynced: onDataChanged,
  });

  const companyTargetedNotifications = notifications.filter((n) => {
    if (n.targetRole !== 'company') return false;
    if (!activeCompany) return false;
    if (n.targetCompanyIds && !n.targetCompanyIds.includes(activeCompany.id)) return false;
    if (
      n.kind === 'broadcast' &&
      n.communeId &&
      n.communeId !== 'all' &&
      !activeCompany.communes.includes(n.communeId)
    ) {
      return false;
    }
    return true;
  });

  const agentTargetedNotifications = notifications.filter((n) => {
    if (n.targetRole !== 'agent') return false;
    if (!activeAgent) return false;
    if (n.targetAgentIds && !n.targetAgentIds.includes(activeAgent.id)) return false;
    return true;
  });

  const handleOpenNotification = async (n: NotificationItem) => {
    if (!n.read) {
      try {
        await api.markNotificationRead(n.id);
        onDataChanged();
      } catch {
        // non-blocking
      }
    }
    if (n.orderId && n.orderId !== 'broadcast' && n.orderId !== 'registration') {
      setFocusedOrderId(n.orderId);
      const targetEl = document.getElementById(`pro-order-${n.orderId}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const exec = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await fn();
      setStatusMessage(okMsg);
      onDataChanged();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAssignAgent = (orderId: string, agentId: string) => {
    setAssignSelection((prev) => {
      const current = prev[orderId] || [];
      const next = current.includes(agentId)
        ? current.filter((x) => x !== agentId)
        : [...current, agentId];
      return { ...prev, [orderId]: next };
    });
  };

  const handleAfterPhotoUpload = async (orderId: string, e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (files.length === 0) return;
    const urls = await Promise.all(files.map(fileToDataUrl));
    setAfterPhotoQueue((prev) => ({
      ...prev,
      [orderId]: [...(prev[orderId] || []), ...urls],
    }));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Workspace Header & Role Segmented Switch */}
      <div className="bg-gradient-to-r from-[#0F172A] to-[#1E293B] rounded-2xl p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#10B981]">
            Portail Partenaire & Équipe Terrain
          </p>
          <h1 className="text-2xl font-bold text-white mt-0.5">
            Espace Entreprise & Application Agent
          </h1>
          <p className="text-sm text-[#CBD5E1] mt-1">
            Gestion des négociations tarifaires, affectation des équipes et pilotage GPS terrain.
          </p>
        </div>

        <div className="tab-group flex items-center gap-1 self-start bg-white">
          <button
            type="button"
            onClick={() => {
              setProTab('company');
              if (currentUser) {
                void api
                  .updateProfile({ preferences: { lastProTab: 'company' } })
                  .then((res) => onProfileUpdated?.(res.user))
                  .catch(() => {});
              }
            }}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              proTab === 'company' ? 'tab-segment-pro-active font-semibold' : 'tab-segment'
            }`}
          >
            Espace Entreprise (Gérant)
          </button>
          <button
            type="button"
            onClick={() => {
              setProTab('agent');
              if (currentUser) {
                void api
                  .updateProfile({ preferences: { lastProTab: 'agent' } })
                  .then((res) => onProfileUpdated?.(res.user))
                  .catch(() => {});
              }
            }}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              proTab === 'agent' ? 'tab-segment-pro-active font-semibold' : 'tab-segment'
            }`}
          >
            Interface Agent Terrain
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-lg bg-[#F1F5F2] border border-[#E2E8E4] text-xs font-medium text-[#0F172A]">
          {statusMessage}
        </div>
      )}

      {proTab === 'company' ? (
        <div className="space-y-6">
          {/* Company Selector & Summary Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-5 bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-3">
              <label className="block text-xs font-semibold text-[#52635A]">
                Entreprise gérée
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full h-10 px-3 text-sm font-medium bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              >
                {companies.length === 0 ? (
                  <option value="">Aucune entreprise enregistrée pour l’instant</option>
                ) : (
                  companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.approvalStatus === 'approved' ? 'Validée' : c.approvalStatus})
                    </option>
                  ))
                )}
              </select>
              {activeCompany && (
                <p className="text-xs text-[#52635A]">
                  Zones : {activeCompany.communes.join(', ')} · {activeCompany.workingHours}
                </p>
              )}
            </div>

            <div className="lg:col-span-7 grid grid-cols-3 gap-4">
              <div className="bg-white border border-[#E2E8E4] rounded-xl p-5">
                <p className="text-xs text-[#52635A]">Commandes reçues</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
                  {companyOrders.length}
                </p>
              </div>
              <div className="bg-white border border-[#E2E8E4] rounded-xl p-5">
                <p className="text-xs text-[#52635A]">Agents disponibles</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-[#059669] mt-1">
                  {companyAgents.filter((a) => a.status === 'available').length} /{' '}
                  {companyAgents.length}
                </p>
              </div>
              <div className="bg-white border border-[#E2E8E4] rounded-xl p-5">
                <p className="text-xs text-[#52635A]">Revenu net (90 %)</p>
                <p className="text-xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
                  {formatFcfa(totalNetRevenue)}
                </p>
              </div>
            </div>
          </div>

          {/* Targeted Provider Notifications ("Nouvelle Commande" & Admin Broadcasts) */}
          {companyTargetedNotifications.length > 0 && (
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#059669]" />
                  Alertes ciblées pour {activeCompany?.name}
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#52635A]">
                  {companyTargetedNotifications.filter((n) => !n.read).length} non lue(s)
                </span>
              </div>
              <div className="divide-y divide-[#E2E8E4]">
                {companyTargetedNotifications.slice(0, 6).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleOpenNotification(n)}
                    className={`w-full text-left py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer transition-colors ${
                      n.read ? 'opacity-70' : ''
                    }`}
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-[#0F172A]">
                        {!n.read && <span className="text-[#059669] mr-1.5">Nouveau ·</span>}
                        {n.title}
                      </p>
                      <p className="text-xs text-[#52635A]">{n.body}</p>
                    </div>
                    <span className="text-[11px] font-mono text-[#059669] whitespace-nowrap shrink-0">
                      {n.kind === 'new_registration'
                        ? n.read
                          ? formatDateTime(n.createdAt)
                          : 'Marquer comme lu'
                        : n.orderId !== 'broadcast'
                        ? 'Voir & accepter →'
                        : formatDateTime(n.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Company Orders Management */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#0F172A]">
              Commandes & négociations ({companyOrders.length})
            </h2>

            {companyOrders.length === 0 ? (
              <div className="bg-white border border-[#E2E8E4] rounded-xl p-8 text-center text-sm text-[#52635A]">
                Aucune commande reçue pour cette entreprise pour le moment.
              </div>
            ) : (
              companyOrders.map((ord) => {
                const meta = ORDER_STATUS_META[ord.status];
                const totalRef =
                  ord.referencePriceFcfa + ord.extrasPriceFcfa + ord.travelFeeFcfa;
                const canCompanyNegotiate =
                  !ord.priceLocked &&
                  (ord.status === 'pending_company' ||
                    ord.status === 'negotiating_company_turn');
                const selectedForAssign =
                  assignSelection[ord.id] || ord.assignedAgentIds || [];

                return (
                  <div
                    key={ord.id}
                    id={`pro-order-${ord.id}`}
                    className={`bg-white rounded-xl p-5 space-y-4 border transition-colors ${
                      focusedOrderId === ord.id
                        ? 'border-[#059669] ring-1 ring-[#059669]/20'
                        : 'border-[#E2E8E4]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-[#E2E8E4] pb-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#52635A]">
                          <span className="font-mono font-semibold text-[#0F172A]">
                            {ord.referenceCode}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {ord.clientName} ({ord.clientPhone})
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {ord.quartierName}, {ord.communeName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#059669]">{meta.label}</span>
                          {ord.selectionMode && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {ord.selectionMode === 'manual'
                                  ? 'Choix direct client'
                                  : 'Assignation automatique'}
                              </span>
                            </>
                          )}
                        </div>
                        <p className="text-base font-semibold text-[#0F172A] mt-1">
                          {ord.config.categoryLabel} — {ord.config.agentCount} agent(s) demandé(s)
                        </p>
                        <p className="text-xs text-[#52635A] mt-0.5">
                          Créneau : {ord.config.scheduledDate} à {ord.config.scheduledTime} ·{' '}
                          {ord.config.material || ''} {ord.config.condition || ''}
                        </p>
                        <p className="text-xs text-[#52635A] mt-0.5 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                          <span>
                            {ord.addressDetails} · GPS domicile :{' '}
                            <span className="font-mono tabular-nums text-[#0F172A]">
                              {ord.clientLocation.lat.toFixed(5)}, {ord.clientLocation.lng.toFixed(5)}
                            </span>
                          </span>
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <p className="text-xs text-[#52635A]">
                          Référence :{' '}
                          <span className="font-mono tabular-nums">{formatFcfa(totalRef)}</span>
                        </p>
                        <p className="text-base font-bold font-mono tabular-nums text-[#0F172A]">
                          Offre actuelle :{' '}
                          {formatFcfa(ord.finalLockedPriceFcfa ?? ord.currentOfferFcfa)}
                        </p>
                      </div>
                    </div>

                    {/* Company Negotiation Decision */}
                    {canCompanyNegotiate && (
                      <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 space-y-3">
                        <p className="text-xs font-semibold text-[#0F172A]">
                          Décision tarifaire (le client propose{' '}
                          <span className="font-mono tabular-nums text-[#059669]">
                            {formatFcfa(ord.currentOfferFcfa)}
                          </span>
                          ) :
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              exec(
                                () =>
                                  api.negotiateOrder(ord.id, {
                                    actor: 'company',
                                    action: 'accept',
                                  }),
                                'Budget accepté et prix verrouillé.'
                              )
                            }
                            className="btn-primary px-4 py-2 text-xs font-semibold cursor-pointer"
                          >
                            Accepter {formatFcfa(ord.currentOfferFcfa)}
                          </button>

                          <input
                            type="number"
                            step={500}
                            placeholder="Contre-offre FCFA"
                            value={counterOfferMap[ord.id] || ''}
                            onChange={(e) =>
                              setCounterOfferMap((p) => ({ ...p, [ord.id]: e.target.value }))
                            }
                            className="h-9 px-3 text-xs font-mono bg-white border border-[#E2E8E4] rounded-lg w-40"
                          />

                          <button
                            type="button"
                            disabled={busy || !counterOfferMap[ord.id]}
                            onClick={() =>
                              exec(
                                () =>
                                  api.negotiateOrder(ord.id, {
                                    actor: 'company',
                                    action: 'counter_offer',
                                    amountFcfa: Number(counterOfferMap[ord.id]),
                                  }),
                                'Contre-proposition envoyée au client.'
                              )
                            }
                            className="btn-outline-green px-3.5 py-2 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                          >
                            Contre-proposer
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              exec(
                                () =>
                                  api.negotiateOrder(ord.id, {
                                    actor: 'company',
                                    action: 'hold_reference',
                                  }),
                                'Tarif de référence maintenu.'
                              )
                            }
                            className="btn-slate px-3.5 py-2 text-xs font-medium cursor-pointer"
                          >
                            Maintenir {formatFcfa(totalRef)}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              exec(
                                () =>
                                  api.negotiateOrder(ord.id, {
                                    actor: 'company',
                                    action: 'reject',
                                  }),
                                'Demande déclinée.'
                              )
                            }
                            className="btn-danger-outline px-3 py-2 text-xs font-medium cursor-pointer"
                          >
                            Refuser
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Agent Assignment */}
                    {ord.priceLocked &&
                      ['confirmed', 'en_route', 'arrived'].includes(ord.status) && (
                        <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                              <UserCheck className="w-4 h-4 text-[#059669]" />
                              Affectation de l’équipe ({ord.config.agentCount} agent(s) requis)
                            </p>
                            {ord.assignedAgentIds.length > 0 && (
                              <span className="text-xs text-[#16A34A] font-medium">
                                Équipe affectée
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {companyAgents.map((ag) => {
                              const picked = selectedForAssign.includes(ag.id);
                              const unavailable =
                                ag.status !== 'available' &&
                                !ord.assignedAgentIds.includes(ag.id);
                              return (
                                <button
                                  key={ag.id}
                                  type="button"
                                  disabled={unavailable}
                                  onClick={() => toggleAssignAgent(ord.id, ag.id)}
                                  className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                                    unavailable
                                      ? 'btn-chip opacity-45 cursor-not-allowed'
                                      : picked
                                      ? 'btn-chip-active font-semibold'
                                      : 'btn-chip'
                                  }`}
                                >
                                  {ag.name} ({ag.scooterTrackerId})
                                </button>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            disabled={busy || selectedForAssign.length < ord.config.agentCount}
                            onClick={() =>
                              exec(
                                () => api.assignAgents(ord.id, selectedForAssign),
                                'Agents affectés à la mission.'
                              )
                            }
                            className="btn-primary px-4 py-2 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                          >
                            Confirmer l’affectation ({selectedForAssign.length}/
                            {ord.config.agentCount})
                          </button>
                        </div>
                      )}

                    {/* Quick Company Reply to Client */}
                    <div className="flex gap-2 pt-2 border-t border-[#E2E8E4]">
                      <input
                        type="text"
                        value={companyChatMap[ord.id] || ''}
                        onChange={(e) =>
                          setCompanyChatMap((p) => ({ ...p, [ord.id]: e.target.value }))
                        }
                        placeholder="Message rapide au client..."
                        className="flex-1 h-9 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={busy || !companyChatMap[ord.id]?.trim()}
                        onClick={() =>
                          exec(async () => {
                            await api.sendMessage(ord.id, {
                              senderRole: 'company',
                              senderName: activeCompany?.name || 'Entreprise',
                              text: companyChatMap[ord.id],
                            });
                            setCompanyChatMap((p) => ({ ...p, [ord.id]: '' }));
                          }, 'Message envoyé au client.')
                        }
                        className="btn-primary h-9 px-3.5 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" /> Envoyer
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Simplified Field Agent Interface */
        <div className="space-y-6">
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#52635A]">
                Agent connecté sur le terrain
              </label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="h-10 px-3 text-sm font-medium bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg min-w-[260px]"
              >
                {agents.length === 0 ? (
                  <option value="">Aucun agent enregistré pour l’instant</option>
                ) : (
                  agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} — {ag.scooterTrackerId} ({ag.status})
                    </option>
                  ))
                )}
              </select>
            </div>

            {activeAgent && (
              <div className="flex flex-col sm:items-end gap-2 text-xs text-[#52635A]">
                <div className="space-y-0.5 sm:text-right">
                  <p className="font-semibold text-[#0F172A]">
                    Spécialité : {activeAgent.specialty}
                  </p>
                  <p className="font-mono tabular-nums">
                    Position GPS : {activeAgent.currentLocation.lat.toFixed(4)},{' '}
                    {activeAgent.currentLocation.lng.toFixed(4)}
                  </p>
                </div>
                {currentUser?.role === 'agent' && currentUser.agentId === activeAgent.id && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[#52635A]">Disponibilité :</span>
                    {(
                      [
                        { id: 'available', label: 'Disponible' },
                        { id: 'busy', label: 'Occupé' },
                        { id: 'offline', label: 'Hors ligne' },
                      ] as const
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          exec(async () => {
                            const res = await api.updateProfile({ agentStatus: st.id });
                            onProfileUpdated?.(res.user);
                          }, `Statut agent sauvegardé : ${st.label}.`)
                        }
                        className={`px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                          activeAgent.status === st.id ? 'btn-chip-active font-semibold' : 'btn-chip'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {activeAgent && (
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#059669]" />
                    Permission « Toujours autoriser » & Service GPS en Arrière-plan
                  </h2>
                  <p className="text-xs text-[#52635A]">
                    Obligatoire pour maintenir la transmission des coordonnées toutes les{' '}
                    <strong className="text-[#0F172A]">{foregroundGps.syncIntervalSeconds} secondes</strong>{' '}
                    même si l’écran est verrouillé ou si vous ouvrez une autre application de navigation à Libreville & Akanda.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={foregroundGps.permissionBusy}
                  onClick={() => void foregroundGps.requestAlwaysAllowPermission()}
                  className={`px-4 py-2.5 text-xs font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer ${
                    foregroundGps.effectivePermissionMode === 'always_allow'
                      ? 'btn-outline-green'
                      : 'btn-primary'
                  }`}
                >
                  <Radio className="w-4 h-4" />
                  {foregroundGps.permissionBusy
                    ? 'Activation en cours...'
                    : foregroundGps.effectivePermissionMode === 'always_allow'
                    ? '« Toujours autoriser » actif · Re-tester'
                    : 'Activer « Toujours autoriser » & Service GPS'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-[#52635A]">Autorisation GPS Agent</p>
                  <p
                    className={`font-semibold ${
                      foregroundGps.effectivePermissionMode === 'always_allow'
                        ? 'text-[#16A34A]'
                        : foregroundGps.effectivePermissionMode === 'denied'
                        ? 'text-[#B91C1C]'
                        : 'text-[#B45309]'
                    }`}
                  >
                    {foregroundGps.effectivePermissionMode === 'always_allow'
                      ? 'Toujours autoriser (Always Allow)'
                      : foregroundGps.effectivePermissionMode === 'denied'
                      ? 'Refusée (à débloquer)'
                      : foregroundGps.effectivePermissionMode === 'when_in_use'
                      ? 'Pendant l’utilisation uniquement'
                      : 'Action requise avant départ'}
                  </p>
                </div>

                <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-[#52635A]">Service Arrière-plan</p>
                  <p className="font-semibold text-[#0F172A]">
                    {foregroundGps.syncMode === 'native_bridge'
                      ? 'Service Natif Android/iOS'
                      : foregroundGps.syncMode === 'foreground_sw_wakelock'
                      ? 'Foreground Service + WakeLock'
                      : foregroundGps.syncMode === 'visibility_heartbeat'
                      ? 'Arrière-plan / Veille (Keepalive)'
                      : 'Prêt (en attente de mission)'}
                  </p>
                </div>

                <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-[#52635A]">Cadence & Maintien système</p>
                  <p className="font-mono tabular-nums font-semibold text-[#0F172A]">
                    {foregroundGps.syncIntervalSeconds}s ·{' '}
                    {foregroundGps.wakeLockActive ? 'Éveil actif' : 'Veille gérée'} ·{' '}
                    {foregroundGps.swNotificationActive ? 'Notif. persistante' : 'SW prêt'}
                  </p>
                </div>

                <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-[#52635A]">Dernière synchro BDD & Réseau</p>
                  <p className="font-mono tabular-nums font-semibold text-[#0F172A]">
                    {foregroundGps.lastSyncAt || activeAgent.lastGpsSyncAt
                      ? formatDateTime(foregroundGps.lastSyncAt || activeAgent.lastGpsSyncAt || '')
                      : 'Aucune synchro encore'}
                    {foregroundGps.lastAccuracyMeters ? ` (±${foregroundGps.lastAccuracyMeters}m)` : ''}
                  </p>
                  <p
                    className={`text-[11px] font-medium ${
                      foregroundGps.connectionState === 'connected'
                        ? 'text-[#16A34A]'
                        : foregroundGps.connectionState === 'reconnecting'
                        ? 'text-[#B45309]'
                        : 'text-[#B91C1C]'
                    }`}
                  >
                    {foregroundGps.connectionState === 'connected'
                      ? 'Flux temps réel connecté'
                      : foregroundGps.connectionState === 'reconnecting'
                      ? `Reconnexion automatique (tentative ${foregroundGps.reconnectAttempt})...`
                      : `Hors ligne (${foregroundGps.queuedOfflineCount} en attente)`}
                  </p>
                </div>
              </div>

              {(foregroundGps.permissionFeedback || foregroundGps.effectivePermissionMode !== 'always_allow') && (
                <div
                  className={`rounded-lg px-3.5 py-2.5 text-xs border ${
                    foregroundGps.effectivePermissionMode === 'denied'
                      ? 'bg-red-50/70 border-red-200 text-[#B91C1C]'
                      : 'bg-[#F1F5F2] border-[#E2E8E4] text-[#52635A]'
                  }`}
                >
                  {foregroundGps.permissionFeedback ? (
                    <p>{foregroundGps.permissionFeedback}</p>
                  ) : (
                    <p>
                      Android / iOS : vérifiez dans <strong>Réglages → Applications → Shine x Sanitize → Localisation</strong> que l’option{' '}
                      <strong className="text-[#0F172A]">« Toujours autoriser »</strong> est sélectionnée pour éviter toute coupure en arrière-plan.
                    </p>
                  )}
                </div>
              )}

              {foregroundGps.queuedOfflineCount > 0 && (
                <p className="text-[11px] font-mono text-[#B45309]">
                  {foregroundGps.queuedOfflineCount} point(s) GPS en tampon hors-ligne — synchronisation automatique dès le retour réseau.
                </p>
              )}
            </div>
          )}

          {agentTargetedNotifications.length > 0 && (
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#059669]" />
                  Notifications de zone pour {activeAgent?.name}
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#52635A]">
                  {agentTargetedNotifications.filter((n) => !n.read).length} non lue(s)
                </span>
              </div>
              <div className="divide-y divide-[#E2E8E4]">
                {agentTargetedNotifications.slice(0, 4).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleOpenNotification(n)}
                    className={`w-full text-left py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer ${
                      n.read ? 'opacity-70' : ''
                    }`}
                  >
                    <div>
                      <p className="text-xs font-semibold text-[#0F172A]">
                        {!n.read ? '● ' : ''}
                        {n.title}
                      </p>
                      <p className="text-xs text-[#52635A]">{n.body}</p>
                    </div>
                    <span className="text-[11px] font-mono text-[#52635A] shrink-0">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {agentOrders.length === 0 ? (
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-8 text-center text-sm text-[#52635A]">
              Aucune mission active affectée pour le moment. Lorsqu’une entreprise affecte un agent
              à une commande validée, la mission apparaît ici.
            </div>
          ) : (
            agentOrders.map((ord) => {
              const queuedAfter = afterPhotoQueue[ord.id] || [];
              return (
                <div
                  key={ord.id}
                  className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E2E8E4] pb-4">
                    <div>
                      <p className="text-xs font-mono font-semibold text-[#059669]">
                        MISSION {ord.referenceCode} · {ORDER_STATUS_META[ord.status].label}
                      </p>
                      <h2 className="text-xl font-bold text-[#0F172A] mt-1">
                        {ord.config.categoryLabel} — {ord.clientName}
                      </h2>
                      <p className="text-xs text-[#52635A] mt-1 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#059669]" />
                        {ord.addressDetails} ({ord.quartierName}, {ord.communeName}) ·{' '}
                        {ord.clientPhone}
                      </p>
                    </div>

                    {/* Locked Price (strictly read-only for agent) */}
                    <div className="bg-[#F1F5F2] border border-[#E2E8E4] rounded-lg px-4 py-2.5 text-right shrink-0">
                      <p className="text-[11px] text-[#52635A] flex items-center justify-end gap-1">
                        <Lock className="w-3 h-3" /> Montant convenu (non modifiable)
                      </p>
                      <p className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">
                        {formatFcfa(ord.finalLockedPriceFcfa ?? ord.currentOfferFcfa)}
                      </p>
                    </div>
                  </div>

                  {/* Work Brief */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 space-y-1.5">
                      <p className="font-semibold text-[#0F172A]">Description du travail</p>
                      <p className="text-[#52635A]">
                        {ord.config.furnitureType || ord.config.categoryLabel}
                        {ord.config.seats ? ` · ${ord.config.seats} places` : ''}
                        {ord.config.material ? ` · Matière : ${ord.config.material}` : ''}
                      </p>
                      <p className="text-[#52635A]">
                        État : {ord.config.condition || 'Standard'} · Taches :{' '}
                        {ord.config.stains?.join(', ') || 'Aucune précisée'}
                      </p>
                      {ord.config.stainNotes && (
                        <p className="text-[#0F172A]">Note client : « {ord.config.stainNotes} »</p>
                      )}
                    </div>

                    <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 space-y-1.5">
                      <p className="font-semibold text-[#0F172A]">
                        Produits & équipements requis
                      </p>
                      <p className="text-[#52635A]">
                        Méthodes : {ord.config.treatmentMethods?.join(', ') || 'Standard'}
                      </p>
                      <p className="text-[#52635A]">
                        Suppléments :{' '}
                        {ord.config.extraTreatments.length > 0
                          ? ord.config.extraTreatments.join(', ')
                          : 'Aucun'}
                      </p>
                    </div>
                  </div>

                  {/* Live Navigation Map for Agent with Exact Client Destination */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#0F172A] flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#059669]" />
                        Itinéraire GPS intégré vers le domicile client
                      </span>
                      <span className="font-mono tabular-nums text-[#52635A]">
                        Arrivée exacte : {ord.clientLocation.lat.toFixed(5)},{' '}
                        {ord.clientLocation.lng.toFixed(5)}
                        {ord.distanceRemainingKm !== null
                          ? ` · ${ord.distanceRemainingKm} km`
                          : ''}
                      </span>
                    </div>
                    <MapTracking
                      apiKey={mapsApiKey}
                      center={activeAgent?.currentLocation || ord.clientLocation}
                      zoom={14}
                      markers={[
                        {
                          id: 'dest',
                          position: ord.clientLocation,
                          label: `Client · ${ord.clientName}`,
                          sublabel: `${ord.addressDetails} (${ord.clientLocation.lat.toFixed(5)}, ${ord.clientLocation.lng.toFixed(5)})`,
                          kind: 'client',
                        },
                        ...(activeAgent
                          ? [
                              {
                                id: activeAgent.id,
                                position: activeAgent.currentLocation,
                                label: `Ma position (${activeAgent.scooterTrackerId})`,
                                kind: 'agent' as const,
                              },
                            ]
                          : []),
                      ]}
                      routeOrigin={activeAgent?.currentLocation}
                      routeDestination={ord.clientLocation}
                      heightClass="h-[280px]"
                    />
                  </div>

                  {/* Background GPS Streaming Status Strip */}
                  {ord.status === 'en_route' && ord.gpsActive && (
                    <div className="bg-[#F1F5F2] border border-[#059669]/30 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-[#059669] flex items-center gap-1.5">
                          <Navigation className="w-3.5 h-3.5" />
                          Service GPS en arrière-plan actif ({foregroundGps.syncIntervalSeconds}s) ·{' '}
                          {foregroundGps.syncMode === 'native_bridge'
                            ? 'Service Natif persistant'
                            : foregroundGps.syncMode === 'visibility_heartbeat'
                            ? 'Mode écran verrouillé / Keepalive'
                            : 'Foreground Service + WakeLock'}
                        </p>
                        <p className="text-[#52635A] font-mono tabular-nums mt-0.5">
                          Lat {activeAgent?.currentLocation.lat.toFixed(5)} · Lng{' '}
                          {activeAgent?.currentLocation.lng.toFixed(5)}
                          {ord.etaMinutes !== null ? ` · ETA ${ord.etaMinutes} min (${ord.distanceRemainingKm} km)` : ''}
                          {foregroundGps.lastAccuracyMeters ? ` · ±${foregroundGps.lastAccuracyMeters}m` : ''}
                        </p>
                      </div>
                      {(foregroundGps.lastSyncAt || ord.lastGpsSyncAt || activeAgent?.lastGpsSyncAt) && (
                        <span className="text-[11px] font-mono text-[#52635A] shrink-0">
                          Synchro BDD ({foregroundGps.syncCount}) ·{' '}
                          {foregroundGps.connectionState === 'connected'
                            ? 'Connecté'
                            : foregroundGps.connectionState === 'reconnecting'
                            ? 'Reconnexion auto...'
                            : `Tampon (${foregroundGps.queuedOfflineCount})`}{' '}
                          :{' '}
                          {formatDateTime(
                            foregroundGps.lastSyncAt || ord.lastGpsSyncAt || activeAgent?.lastGpsSyncAt || ''
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Sequential Field Execution Buttons */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    {ord.status === 'confirmed' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          exec(async () => {
                            if (foregroundGps.effectivePermissionMode !== 'always_allow') {
                              const ok = await foregroundGps.requestAlwaysAllowPermission();
                              if (!ok) {
                                throw new Error(
                                  'Permission GPS « Toujours autoriser » requise pour démarrer la navigation en arrière-plan.'
                                );
                              }
                            }
                            await api.agentAction(ord.id, { action: 'depart' });
                          }, 'Départ activé — Service GPS en arrière-plan démarré (synchro toutes les 6s).')
                        }
                        className="btn-primary px-4 py-2.5 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                      >
                        <Navigation className="w-4 h-4" />
                        Activer mon départ / Démarrer la navigation vers le client
                      </button>
                    )}

                    {ord.status === 'en_route' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () =>
                                api.updateGps(ord.id, {
                                  stepTowardClient: 0.45,
                                  source: 'agent_app',
                                }),
                              'Position GPS actualisée sur l’itinéraire.'
                            )
                          }
                          className="btn-outline-green px-4 py-2.5 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                        >
                          <Navigation className="w-4 h-4" />
                          Avancer trajet GPS
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setAutoDriveOrderId(autoDriveOrderId === ord.id ? null : ord.id)
                          }
                          className="btn-slate px-4 py-2.5 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 text-[#10B981]" />
                          {autoDriveOrderId === ord.id
                            ? 'Arrêter trajet auto'
                            : 'Simuler trajet auto (2s)'}
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(async () => {
                              setAutoDriveOrderId(null);
                              await api.agentAction(ord.id, { action: 'arrive' });
                            }, 'Arrivée signalée — Suivi GPS clôturé et notification envoyée au client.')
                          }
                          className="btn-primary px-4 py-2.5 text-xs font-semibold cursor-pointer"
                        >
                          Arrivé à destination / Début de l’intervention
                        </button>
                      </>
                    )}

                    {ord.status === 'arrived' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          exec(
                            () => api.agentAction(ord.id, { action: 'start_work' }),
                            'Intervention démarrée (horodatage enregistré).'
                          )
                        }
                        className="btn-primary px-4 py-2.5 text-xs font-semibold cursor-pointer"
                      >
                        Démarrer le travail sur place
                      </button>
                    )}

                    {ord.status === 'in_progress' && (
                      <div className="w-full bg-[#F8FAF8] border border-[#E2E8E4] rounded-xl p-4 space-y-3">
                        <p className="text-xs font-semibold text-[#0F172A]">
                          4. Documentation après intervention (obligatoire pour clôture)
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="btn-secondary px-3.5 py-2 text-xs font-medium inline-flex items-center gap-2 cursor-pointer">
                            <Camera className="w-4 h-4 text-[#059669]" />
                            Ajouter photos après ({queuedAfter.length})
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              onChange={(e) => handleAfterPhotoUpload(ord.id, e)}
                              className="hidden"
                            />
                          </label>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              exec(async () => {
                                await api.agentAction(ord.id, {
                                  action: 'complete',
                                  afterPhotos: queuedAfter,
                                });
                                setAfterPhotoQueue((p) => ({ ...p, [ord.id]: [] }));
                              }, 'Mission terminée — En attente de validation et paiement client.')
                            }
                            className="btn-primary px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            5. Terminer la mission
                          </button>
                        </div>
                        {ord.startedWorkAt && (
                          <p className="text-[11px] text-[#52635A] font-mono">
                            Début enregistré : {formatDateTime(ord.startedWorkAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Report Incident */}
                  <div className="pt-3 border-t border-[#E2E8E4] flex flex-wrap items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#B45309] shrink-0" />
                    <input
                      type="text"
                      value={issueText}
                      onChange={(e) => setIssueText(e.target.value)}
                      placeholder="Signaler un problème terrain à l’administrateur..."
                      className="flex-1 min-w-[200px] h-9 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    />
                    <button
                      type="button"
                      disabled={busy || !issueText.trim()}
                      onClick={() =>
                        exec(async () => {
                          await api.agentAction(ord.id, {
                            action: 'report_issue',
                            note: issueText,
                          });
                          setIssueText('');
                        }, 'Incident signalé au dossier.')
                      }
                      className="btn-secondary h-9 px-3.5 border-[#B45309] text-[#B45309] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Signaler
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
