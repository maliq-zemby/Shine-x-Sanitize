import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Eye,
  KeyRound,
  Lock,
  MapPin,
  Megaphone,
  PauseCircle,
  Save,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import { formatDateTime, formatFcfa, ORDER_STATUS_META, PAYMENT_METHOD_LABEL } from '../lib/format';
import type {
  AccountStatus,
  Agent,
  BroadcastRecord,
  Commune,
  CommuneId,
  Company,
  DisputeRecord,
  FcmDispatchLog,
  NotificationItem,
  Order,
  PaymentRecord,
  ReferenceTariff,
  RegisteredUser,
  ServiceSector,
  UserRole,
} from '../types';
import { MapTracking, type MapMarkerItem } from './MapTracking';

interface AdminDashboardProps {
  communes: Commune[];
  sectors: ServiceSector[];
  tariffs: ReferenceTariff[];
  companies: Company[];
  agents: Agent[];
  orders: Order[];
  disputes: DisputeRecord[];
  transactions: PaymentRecord[];
  notifications: NotificationItem[];
  broadcasts: BroadcastRecord[];
  fcmLogs: FcmDispatchLog[];
  currentUser: RegisteredUser | null;
  mapsApiKey: string;
  onDataChanged: () => void;
  onAdminAuthenticated: (user: RegisteredUser) => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  client: 'Client',
  agent: 'Agent',
  company: 'Entreprise',
  admin: 'Admin',
};

const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  pending: 'En attente de validation',
  active: 'Actif',
  suspended: 'Suspendu',
};

export function AdminDashboard({
  communes,
  sectors,
  tariffs,
  companies,
  agents,
  orders,
  disputes,
  transactions,
  notifications,
  broadcasts,
  fcmLogs,
  currentUser,
  mapsApiKey,
  onDataChanged,
  onAdminAuthenticated,
}: AdminDashboardProps) {
  const [adminTab, setAdminTab] = useState<
    'users' | 'companies' | 'gps' | 'tariffs' | 'finance' | 'broadcast'
  >('users');
  const [tariffDrafts, setTariffDrafts] = useState<Record<string, number>>({});
  const cleaningSector = sectors.find((s) => s.id === 'nettoyage');
  const [commissionPct, setCommissionPct] = useState<number>(
    Math.round((cleaningSector?.commissionRate ?? 0.1) * 100)
  );
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Admin Broadcast form state
  const [bcastTitle, setBcastTitle] = useState('');
  const [bcastBody, setBcastBody] = useState('');
  const [bcastAudience, setBcastAudience] = useState<'all' | 'clients' | 'providers'>('all');
  const [bcastCommuneId, setBcastCommuneId] = useState<CommuneId | 'all'>('all');

  // Admin dynamic quartier creation state
  const [newQuartierCommuneId, setNewQuartierCommuneId] = useState<CommuneId>('akanda');
  const [newQuartierName, setNewQuartierName] = useState('');
  const [newQuartierLat, setNewQuartierLat] = useState('');
  const [newQuartierLng, setNewQuartierLng] = useState('');

  const previewFcmCondition = (() => {
    const roleExpr =
      bcastAudience === 'clients'
        ? "'role_client' in topics"
        : bcastAudience === 'providers'
        ? "('role_company' in topics || 'role_agent' in topics)"
        : "('role_client' in topics || 'role_company' in topics || 'role_agent' in topics)";
    return bcastCommuneId === 'all'
      ? roleExpr
      : `'commune_${bcastCommuneId}' in topics && ${roleExpr}`;
  })();

  // Admin Auth Gate & Users Registry state
  const isValidatedAdmin =
    currentUser?.role === 'admin' &&
    currentUser?.status === 'active' &&
    currentUser?.email.toLowerCase() === 'maliqzemby8@gmail.com';
  const [adminLoginEmail, setAdminLoginEmail] = useState('');
  const [adminLoginPassword, setAdminLoginPassword] = useState('');
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null);

  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRole | 'all'>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [userCommuneFilter, setUserCommuneFilter] = useState<CommuneId | 'all'>('all');
  const [inspectedUser, setInspectedUser] = useState<RegisteredUser | null>(null);

  const loadUsers = useCallback(async () => {
    if (!isValidatedAdmin) return;
    setUsersLoading(true);
    try {
      const res = await api.getAdminUsers();
      setRegisteredUsers(res.users);
    } catch {
      // ignore if session expired
    } finally {
      setUsersLoading(false);
    }
  }, [isValidatedAdmin]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers, companies, agents, notifications]);

  const filteredUsers = registeredUsers.filter((u) => {
    if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
    if (userStatusFilter !== 'all' && u.status !== userStatusFilter) return false;
    if (userCommuneFilter !== 'all' && u.communeId !== userCommuneFilter) return false;
    if (userSearch.trim()) {
      const q = userSearch.trim().toLowerCase();
      const hay = `${u.name} ${u.email} ${u.companyName || ''} ${u.communeName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pendingUsersCount = registeredUsers.filter((u) => u.status === 'pending').length;

  const paidTransactions = transactions.filter((t) => t.status === 'paid');
  const totalVolume = paidTransactions.reduce((sum, t) => sum + t.grossAmountFcfa, 0);
  const totalCommission = paidTransactions.reduce((sum, t) => sum + t.commissionFcfa, 0);
  const pendingCompanies = companies.filter((c) => c.approvalStatus === 'pending');
  const activeAgents = agents.filter((a) => a.status === 'en_route' || a.status === 'busy');
  const openDisputes = disputes.filter((d) => d.status === 'open');

  const [gpsFilter, setGpsFilter] = useState<'all' | 'active_missions'>('all');
  const [focusedMissionId, setFocusedMissionId] = useState<string | null>(null);

  const liveMissions = orders.filter((o) =>
    ['confirmed', 'en_route', 'arrived', 'in_progress'].includes(o.status)
  );
  const enRouteMissions = liveMissions.filter((o) => o.status === 'en_route');
  const avgEtaMin =
    enRouteMissions.length > 0
      ? Math.round(
          enRouteMissions.reduce((acc, o) => acc + (o.etaMinutes ?? 0), 0) /
            enRouteMissions.length
        )
      : 0;

  const visibleAgents =
    gpsFilter === 'active_missions'
      ? agents.filter((a) => a.status === 'en_route' || a.status === 'busy')
      : agents;

  const focusedMission = liveMissions.find((o) => o.id === focusedMissionId) || null;
  const focusedLeadAgent = focusedMission
    ? agents.find((a) => focusedMission.assignedAgentIds.includes(a.id)) || null
    : null;

  const fleetMarkers: MapMarkerItem[] = [
    ...visibleAgents.map((ag) => {
      const mission = liveMissions.find((o) => o.assignedAgentIds.includes(ag.id));
      const syncTag = ag.backgroundServiceActive
        ? ` · Service arrière-plan ${ag.syncIntervalSeconds ?? 6}s`
        : '';
      return {
        id: ag.id,
        position: ag.currentLocation,
        label: `${ag.name} · ${ag.scooterTrackerId}`,
        sublabel: mission
          ? `Mission ${mission.referenceCode} (${ORDER_STATUS_META[mission.status].label})${
              mission.etaMinutes !== null ? ` · ETA ${mission.etaMinutes} min` : ''
            }${syncTag}`
          : `Statut : ${ag.status} · ${ag.specialty}${syncTag}`,
        kind: (ag.status === 'en_route' || ag.status === 'busy' ? 'agent' : 'company') as
          | 'agent'
          | 'company',
      };
    }),
    ...liveMissions.map((ord) => ({
      id: `dest_${ord.id}`,
      position: ord.clientLocation,
      label: `Destination ${ord.referenceCode} · ${ord.clientName}`,
      sublabel: `${ord.quartierName}, ${ord.communeName} · ${ord.addressDetails}`,
      kind: 'client' as const,
    })),
  ];

  const exec = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setAdminMessage(null);
    try {
      await fn();
      setAdminMessage(okMsg);
      await loadUsers();
      onDataChanged();
    } catch (err) {
      setAdminMessage(err instanceof Error ? err.message : 'Erreur administration.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdminSignIn = async (email: string, password: string) => {
    setBusy(true);
    setAdminLoginError(null);
    try {
      const res = await api.login({ email, password });
      if (
        res.user.role !== 'admin' ||
        res.user.status !== 'active' ||
        res.user.email.toLowerCase() !== 'maliqzemby8@gmail.com'
      ) {
        setAdminLoginError(
          `Ce compte (${ROLE_LABEL[res.user.role]}) ne dispose pas des droits Administrateur Principal.`
        );
        return;
      }
      setAuthToken(res.token);
      onAdminAuthenticated(res.user);
    } catch (err) {
      setAdminLoginError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdminFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await handleAdminSignIn(adminLoginEmail, adminLoginPassword);
  };

  if (!isValidatedAdmin) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="bg-white border border-[#E2E8E4] rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <img
                src="/assets/logo-shine-sanitize.png"
                alt="Shine x Sanitize — Alp Group"
                className="w-11 h-11 rounded-lg border border-[#E2E8E4] bg-white object-contain p-0.5 shrink-0"
              />
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#059669]">
                  <Lock className="w-4 h-4" />
                  Accès protégé · Shine x Sanitize (Alp Group)
                </div>
                <h1 className="text-2xl font-bold text-[#0F172A]">
                  Administration Centrale · Shine x Sanitize
                </h1>
              </div>
            </div>
            <p className="text-sm text-[#52635A] leading-relaxed">
              La gestion des inscrits, la validation des entreprises, les tarifs communs et la
              diffusion Broadcast sont strictement réservés aux comptes administrateurs validés.
            </p>
          </div>

          {currentUser && (
            <div className="p-3.5 rounded-lg bg-[#F8FAF8] border border-[#E2E8E4] text-xs text-[#52635A]">
              Session actuelle : <strong className="text-[#0F172A]">{currentUser.email}</strong> (
              {ROLE_LABEL[currentUser.role]}). Connectez-vous avec un compte administrateur validé.
            </div>
          )}

          {adminLoginError && (
            <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C]">
              {adminLoginError}
            </div>
          )}

          <form onSubmit={handleAdminFormSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#0F172A]">
                Email administrateur
              </label>
              <input
                type="email"
                required
                value={adminLoginEmail}
                onChange={(e) => setAdminLoginEmail(e.target.value)}
                placeholder="maliqzemby8@gmail.com"
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#0F172A]">Mot de passe</label>
              <input
                type="password"
                required
                value={adminLoginPassword}
                onChange={(e) => setAdminLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary px-5 py-2.5 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {busy ? 'Vérification...' : 'Accéder à l’administration'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Tabs */}
      <div className="bg-gradient-to-r from-[#0F172A] to-[#1E293B] rounded-2xl p-6 text-white shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src="/assets/logo-shine-sanitize.png"
            alt="Shine x Sanitize — Alp Group"
            className="w-11 h-11 rounded-xl border border-white/15 bg-white object-contain p-0.5 shrink-0"
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#10B981]">
              Supervision Plateforme · Alp Group
            </p>
            <h1 className="text-2xl font-bold text-white mt-0.5">
              Administration Centrale · Shine x Sanitize
            </h1>
            <p className="text-sm text-[#CBD5E1] mt-0.5">
              Gestion des inscrits, validation des entreprises, grille tarifaire commune, GPS et diffusions.
            </p>
          </div>
        </div>

        <div className="tab-group flex items-center gap-1 self-start overflow-x-auto max-w-full bg-white">
          {(
            [
              { id: 'users', label: `Inscrits (${pendingUsersCount} en attente)` },
              { id: 'companies', label: `Entreprises (${pendingCompanies.length})` },
              { id: 'gps', label: 'Supervision GPS' },
              { id: 'tariffs', label: 'Tarifs & Commissions' },
              { id: 'finance', label: `Paiements & Litiges (${openDisputes.length})` },
              { id: 'broadcast', label: `Diffusion & FCM (${fcmLogs.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAdminTab(t.id)}
              className={`px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                adminTab === t.id ? 'tab-segment-pro-active font-semibold' : 'tab-segment'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
          <p className="text-xs text-[#52635A]">Entreprises validées / total</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
            {companies.filter((c) => c.approvalStatus === 'approved').length} / {companies.length}
          </p>
        </div>
        <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
          <p className="text-xs text-[#52635A]">Équipes actives terrain</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-[#059669] mt-1">
            {activeAgents.length} / {agents.length}
          </p>
        </div>
        <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
          <p className="text-xs text-[#52635A]">Volume brut encaissé</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
            {formatFcfa(totalVolume)}
          </p>
        </div>
        <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
          <p className="text-xs text-[#52635A]">Commissions plateforme ({commissionPct} %)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-[#059669] mt-1">
            {formatFcfa(totalCommission)}
          </p>
        </div>
      </div>

      {adminMessage && (
        <div className="p-3.5 rounded-lg bg-[#F1F5F2] border border-[#E2E8E4] text-xs font-medium text-[#0F172A]">
          {adminMessage}
        </div>
      )}

      {/* TAB 0: Registered Users Management (Gestion des Inscrits) */}
      {adminTab === 'users' && (
        <div className="space-y-5">
          {/* Summary counts + Filter bar */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#059669]" />
                  Gestion des Inscrits ({filteredUsers.length} / {registeredUsers.length})
                </h2>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Validez les nouvelles entreprises et agents en attente, suspendez un compte ou
                  consultez un dossier détaillé.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-[#52635A]">
                <span>
                  Actifs :{' '}
                  <strong className="text-[#16A34A]">
                    {registeredUsers.filter((u) => u.status === 'active').length}
                  </strong>
                </span>
                <span>
                  En attente :{' '}
                  <strong className="text-[#B45309]">{pendingUsersCount}</strong>
                </span>
                <span>
                  Suspendus :{' '}
                  <strong className="text-[#B91C1C]">
                    {registeredUsers.filter((u) => u.status === 'suspended').length}
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#52635A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Rechercher nom, email..."
                  className="w-full h-9 pl-8 pr-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <select
                aria-label="Filtrer par rôle"
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value as UserRole | 'all')}
                className="h-9 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              >
                <option value="all">Tous les rôles</option>
                <option value="client">Client</option>
                <option value="agent">Agent</option>
                <option value="company">Entreprise</option>
                <option value="admin">Administrateur</option>
              </select>

              <select
                aria-label="Filtrer par statut"
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value as AccountStatus | 'all')}
                className="h-9 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              >
                <option value="all">Tous les statuts</option>
                <option value="pending">En attente de validation</option>
                <option value="active">Actif</option>
                <option value="suspended">Suspendu</option>
              </select>

              <select
                aria-label="Filtrer par commune"
                value={userCommuneFilter}
                onChange={(e) => setUserCommuneFilter(e.target.value as CommuneId | 'all')}
                className="h-9 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              >
                <option value="all">Toutes les communes</option>
                {communes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Registered Users Table */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl overflow-hidden">
            {usersLoading && registeredUsers.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#52635A]">
                Chargement de la liste des inscrits...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#52635A]">
                Aucun utilisateur ne correspond aux filtres sélectionnés.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAF8] border-b border-[#E2E8E4] text-[#52635A]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Nom / Entreprise</th>
                      <th className="py-3 px-4 font-semibold">Email</th>
                      <th className="py-3 px-4 font-semibold">Rôle</th>
                      <th className="py-3 px-4 font-semibold">Commune</th>
                      <th className="py-3 px-4 font-semibold">Date d’inscription</th>
                      <th className="py-3 px-4 font-semibold">Statut du compte</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8E4]">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#F8FAF8]">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-[#0F172A]">{u.name}</p>
                          {u.companyName && (
                            <p className="text-[11px] text-[#52635A]">{u.companyName}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-[#52635A]">{u.email}</td>
                        <td className="py-3 px-4 font-medium text-[#0F172A]">
                          {ROLE_LABEL[u.role]}
                        </td>
                        <td className="py-3 px-4 text-[#52635A]">{u.communeName}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#52635A]">
                          {formatDateTime(u.createdAt)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`font-semibold ${
                              u.status === 'active'
                                ? 'text-[#16A34A]'
                                : u.status === 'pending'
                                ? 'text-[#B45309]'
                                : 'text-[#B91C1C]'
                            }`}
                          >
                            {ACCOUNT_STATUS_LABEL[u.status]}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {u.status !== 'active' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  exec(
                                    () => api.updateUserStatus(u.id, 'active'),
                                    `Le compte de ${u.name} est désormais Actif.`
                                  )
                                }
                                className="btn-primary px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Valider
                              </button>
                            )}
                            {u.status !== 'suspended' && u.id !== currentUser?.id && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  exec(
                                    () => api.updateUserStatus(u.id, 'suspended'),
                                    `Le compte de ${u.name} a été suspendu.`
                                  )
                                }
                                className="btn-danger-outline px-3 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Suspendre
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setInspectedUser(u)}
                              className="btn-secondary px-3 py-1.5 text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              Profil
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Detailed User Profile Inspection Panel */}
          {inspectedUser && (
            <div className="bg-white border border-[#059669]/35 rounded-xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-4 border-b border-[#E2E8E4] pb-3">
                <div>
                  <p className="text-xs text-[#059669] font-semibold">
                    Profil détaillé · {ROLE_LABEL[inspectedUser.role]}
                  </p>
                  <h3 className="text-lg font-bold text-[#0F172A] mt-0.5">
                    {inspectedUser.name}
                    {inspectedUser.companyName ? ` — ${inspectedUser.companyName}` : ''}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedUser(null)}
                  className="text-[#52635A] hover:text-[#0F172A] p-1 cursor-pointer"
                  aria-label="Fermer le profil"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-[#52635A]">Identifiant & Email</p>
                  <p className="font-mono text-[#0F172A] mt-0.5">{inspectedUser.email}</p>
                  <p className="font-mono text-[#52635A] text-[11px]">{inspectedUser.id}</p>
                </div>
                <div>
                  <p className="text-[#52635A]">Commune & Quartier</p>
                  <p className="font-semibold text-[#0F172A] mt-0.5">
                    {inspectedUser.communeName}
                    {inspectedUser.quartierName ? ` · ${inspectedUser.quartierName}` : ''}
                  </p>
                  {inspectedUser.phone && (
                    <p className="text-[#52635A] font-mono">{inspectedUser.phone}</p>
                  )}
                </div>
                <div>
                  <p className="text-[#52635A]">Statut & Inscription</p>
                  <p className="font-semibold text-[#0F172A] mt-0.5">
                    {ACCOUNT_STATUS_LABEL[inspectedUser.status]}
                  </p>
                  <p className="text-[#52635A] font-mono tabular-nums">
                    Inscrit le {formatDateTime(inspectedUser.createdAt)}
                  </p>
                </div>
                {inspectedUser.role === 'company' && (
                  <div>
                    <p className="text-[#52635A]">Nom commercial de l’entreprise</p>
                    <p className="font-semibold text-[#0F172A] mt-0.5">
                      {inspectedUser.companyName || 'Non renseigné'}
                    </p>
                  </div>
                )}
                {inspectedUser.role === 'agent' && (
                  <>
                    <div>
                      <p className="text-[#52635A]">Spécialité</p>
                      <p className="text-[#0F172A] mt-0.5">
                        {inspectedUser.specialty || 'Nettoyage polyvalent'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#52635A]">Traceur trottinette</p>
                      <p className="font-mono text-[#0F172A] mt-0.5">
                        {inspectedUser.scooterTrackerId || 'Non attribué'}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E2E8E4]">
                {inspectedUser.status !== 'active' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      exec(async () => {
                        const updated = await api.updateUserStatus(inspectedUser.id, 'active');
                        setInspectedUser(updated.user);
                      }, `Compte de ${inspectedUser.name} validé.`)
                    }
                    className="btn-primary px-3.5 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Valider & activer le compte
                  </button>
                )}
                {inspectedUser.status !== 'suspended' && inspectedUser.id !== currentUser?.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      exec(async () => {
                        const updated = await api.updateUserStatus(inspectedUser.id, 'suspended');
                        setInspectedUser(updated.user);
                      }, `Compte de ${inspectedUser.name} suspendu.`)
                    }
                    className="btn-danger-outline px-3.5 py-2 text-xs font-medium cursor-pointer"
                  >
                    Suspendre le compte
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: Company Validation & Control */}
      {adminTab === 'companies' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E2E8E4] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8E4] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Contrôle & validation des entreprises partenaires
                </h2>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Seul l’administrateur central autorise l’activation ou la suspension d’un prestataire sur la plateforme.
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#E2E8E4]">
              {companies.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#52635A]">
                  Aucune entreprise enregistrée pour le moment. Les nouvelles entreprises inscrites apparaîtront ici pour validation.
                </div>
              ) : (
                companies.map((comp) => {
                const compAgents = agents.filter((a) => a.companyId === comp.id);
                return (
                  <div
                    key={comp.id}
                    className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-sm font-bold text-[#0F172A]">{comp.name}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            comp.approvalStatus === 'approved'
                              ? 'text-[#16A34A]'
                              : comp.approvalStatus === 'pending'
                              ? 'text-[#B45309]'
                              : 'text-[#B91C1C]'
                          }`}
                        >
                          {comp.approvalStatus === 'approved'
                            ? 'Validée & visible'
                            : comp.approvalStatus === 'pending'
                            ? 'En attente de validation'
                            : 'Suspendue'}
                        </span>
                      </div>
                      <p className="text-xs text-[#52635A]">
                        Zones : {comp.communes.join(', ')} · Horaires :{' '}
                        <span className="font-mono text-[#0F172A]">{comp.workingHours}</span> · Téléphone :{' '}
                        <span className="font-mono">{comp.phone}</span>
                      </p>
                      <p className="text-xs text-[#52635A]">
                        {compAgents.length} agent(s) · {comp.completedInterventions} missions · Note{' '}
                        <span className="font-mono tabular-nums">{comp.rating.toFixed(1)}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {comp.approvalStatus !== 'approved' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () => api.updateCompanyStatus(comp.id, 'approved'),
                              `${comp.name} est désormais approuvée et visible aux clients.`
                            )
                          }
                          className="btn-primary px-3.5 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Valider l’entreprise
                        </button>
                      )}
                      {comp.approvalStatus === 'approved' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () => api.updateCompanyStatus(comp.id, 'suspended'),
                              `${comp.name} a été suspendue.`
                            )
                          }
                          className="btn-danger-outline px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <PauseCircle className="w-3.5 h-3.5" />
                          Suspendre
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
              )}
            </div>
          </div>

          {/* Communes Coverage Table & Dynamic Quartier Addition */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-[#0F172A]">
                Organisation géographique · Communes & quartiers du Grand Libreville
              </h3>
              <p className="text-xs text-[#52635A] mt-0.5">
                Ajoutez dynamiquement de nouveaux quartiers ou sous-zones dès qu’un utilisateur signale une zone manquante.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newQuartierName.trim()) return;
                const parsedLat = Number(newQuartierLat);
                const parsedLng = Number(newQuartierLng);
                const payload = {
                  name: newQuartierName.trim(),
                  ...(newQuartierLat.trim() && Number.isFinite(parsedLat) ? { lat: parsedLat } : {}),
                  ...(newQuartierLng.trim() && Number.isFinite(parsedLng) ? { lng: parsedLng } : {}),
                };
                exec(async () => {
                  await api.addQuartier(newQuartierCommuneId, payload);
                  setNewQuartierName('');
                  setNewQuartierLat('');
                  setNewQuartierLng('');
                }, `Quartier « ${newQuartierName.trim()} » ajouté.`);
              }}
              className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
            >
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-xs font-semibold text-[#0F172A]">Commune</label>
                <select
                  aria-label="Commune pour nouveau quartier"
                  value={newQuartierCommuneId}
                  onChange={(e) => setNewQuartierCommuneId(e.target.value as CommuneId)}
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E2E8E4] rounded-lg"
                >
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4 space-y-1">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Nom du nouveau quartier
                </label>
                <input
                  type="text"
                  required
                  value={newQuartierName}
                  onChange={(e) => setNewQuartierName(e.target.value)}
                  placeholder="Ex : Premier Campement, Cité Rose..."
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E2E8E4] rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Latitude (opt.)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newQuartierLat}
                  onChange={(e) => setNewQuartierLat(e.target.value)}
                  placeholder="0.5255"
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E2E8E4] rounded-lg font-mono tabular-nums"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Longitude (opt.)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newQuartierLng}
                  onChange={(e) => setNewQuartierLng(e.target.value)}
                  placeholder="9.4378"
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E2E8E4] rounded-lg font-mono tabular-nums"
                />
              </div>
              <div className="sm:col-span-1 flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !newQuartierName.trim()}
                  className="btn-primary w-full sm:w-auto h-9 px-3.5 disabled:opacity-50 text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Ajouter
                </button>
              </div>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {communes.map((c) => (
                <div key={c.id} className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-[#0F172A]">{c.name}</p>
                    <span className="text-xs font-mono tabular-nums text-[#059669]">
                      {c.travelFeeFcfa === 0 ? '0 FCFA' : formatFcfa(c.travelFeeFcfa)}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono tabular-nums text-[#059669] mt-0.5">
                    {c.quartiers.length} quartiers couverts
                  </p>
                  <p className="text-xs text-[#52635A] mt-1.5 leading-relaxed">
                    {c.quartiers.map((q) => q.name).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Global GPS Fleet Supervision (Live Map) */}
      {adminTab === 'gps' && (
        <div className="space-y-5">
          {/* Live KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
              <p className="text-xs text-[#52635A]">Agents en route</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#059669] mt-1">
                {agents.filter((a) => a.status === 'en_route').length}
              </p>
            </div>
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
              <p className="text-xs text-[#52635A]">En intervention sur place</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
                {agents.filter((a) => a.status === 'busy').length}
              </p>
            </div>
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
              <p className="text-xs text-[#52635A]">Missions actives (Grand Libreville)</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#0F172A] mt-1">
                {liveMissions.length}
              </p>
            </div>
            <div className="bg-white border border-[#E2E8E4] rounded-xl p-4">
              <p className="text-xs text-[#52635A]">ETA moyen des trajets</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#059669] mt-1">
                {enRouteMissions.length > 0 ? `${avgEtaMin} min` : '—'}
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Live Map · Supervision globale des équipes en mission
                </h2>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Visualisation en direct des agents sur le terrain et des destinations clients à Libreville, Akanda & Owendo.
                </p>
              </div>

              <div className="tab-group flex items-center gap-1 self-start">
                <button
                  type="button"
                  onClick={() => setGpsFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    gpsFilter === 'all' ? 'tab-segment-pro-active font-semibold' : 'tab-segment'
                  }`}
                >
                  Toute la flotte ({agents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setGpsFilter('active_missions')}
                  className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    gpsFilter === 'active_missions'
                      ? 'tab-segment-pro-active font-semibold'
                      : 'tab-segment'
                  }`}
                >
                  En mission ({activeAgents.length})
                </button>
              </div>
            </div>

            <MapTracking
              apiKey={mapsApiKey}
              center={
                focusedLeadAgent?.currentLocation ||
                focusedMission?.clientLocation || { lat: 0.4162, lng: 9.4673 }
              }
              zoom={focusedMission ? 14 : 12}
              panOnCenterChange={Boolean(focusedMission)}
              markers={fleetMarkers}
              routeOrigin={focusedLeadAgent?.currentLocation}
              routeDestination={focusedMission?.clientLocation}
              trail={focusedMission?.gpsHistory.map((p) => ({ lat: p.lat, lng: p.lng }))}
              heightClass="h-[440px]"
            />

            {focusedMission && (
              <div className="p-3.5 rounded-lg bg-[#F1F5F2] border border-[#059669]/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold text-[#059669]">
                    Trajet inspecté : {focusedMission.referenceCode} ({focusedMission.companyName})
                  </span>
                  <span className="text-[#52635A] ml-2">
                    Destination : {focusedMission.quartierName}, {focusedMission.communeName}
                    {focusedMission.etaMinutes !== null
                      ? ` · ETA ${focusedMission.etaMinutes} min (${focusedMission.distanceRemainingKm} km)`
                      : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFocusedMissionId(null)}
                  className="text-xs font-medium text-[#0F172A] underline cursor-pointer"
                >
                  Afficher vue globale
                </button>
              </div>
            )}

            {/* Active Missions Travel Analysis & Intervention */}
            <div className="pt-2 space-y-3">
              <h3 className="text-sm font-semibold text-[#0F172A]">
                Analyse des trajets & missions en cours ({liveMissions.length})
              </h3>
              {liveMissions.length === 0 ? (
                <p className="text-xs text-[#52635A] py-4 text-center bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg">
                  Aucune mission active en ce moment. Les trajets en cours et temps d’arrivée apparaîtront ici en direct.
                </p>
              ) : (
                <div className="divide-y divide-[#E2E8E4] border border-[#E2E8E4] rounded-lg">
                  {liveMissions.map((ord) => {
                    const missionAgents = agents.filter((a) => ord.assignedAgentIds.includes(a.id));
                    const isDelayed = ord.status === 'en_route' && (ord.etaMinutes ?? 0) > 25;
                    return (
                      <div
                        key={ord.id}
                        className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs bg-white"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-semibold text-[#0F172A]">
                              {ord.referenceCode}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[#059669]">
                              {ORDER_STATUS_META[ord.status].label}
                            </span>
                            {isDelayed && (
                              <span className="text-[#B45309] font-semibold">
                                · Retard potentiel (ETA &gt; 25 min)
                              </span>
                            )}
                          </div>
                          <p className="text-[#52635A]">
                            Entreprise : <strong className="text-[#0F172A]">{ord.companyName}</strong> ·
                            Agents : {missionAgents.map((a) => `${a.name} (${a.scooterTrackerId})`).join(', ') || 'Non affecté'} ·
                            Client : {ord.clientName} ({ord.quartierName}, {ord.communeName})
                          </p>
                          {missionAgents.length > 0 && (
                            <p className="text-[11px] font-mono tabular-nums text-[#52635A]">
                              {missionAgents[0].backgroundServiceActive
                                ? `Service arrière-plan actif (${missionAgents[0].syncIntervalSeconds ?? 6}s)`
                                : 'Service arrière-plan en veille'}{' '}
                              · Permission :{' '}
                              {missionAgents[0].locationPermissionMode === 'always_allow'
                                ? 'Toujours autoriser'
                                : missionAgents[0].locationPermissionMode === 'denied'
                                ? 'Refusée'
                                : 'À confirmer'}
                              {(ord.lastGpsSyncAt || missionAgents[0].lastGpsSyncAt) &&
                                ` · Synchro : ${formatDateTime(
                                  ord.lastGpsSyncAt || missionAgents[0].lastGpsSyncAt || ''
                                )}`}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 shrink-0">
                          <span className="font-mono tabular-nums text-[#0F172A]">
                            {ord.etaMinutes !== null ? `ETA ${ord.etaMinutes} min · ${ord.distanceRemainingKm} km` : 'En attente départ'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setFocusedMissionId(focusedMissionId === ord.id ? null : ord.id)
                            }
                            className="btn-outline-green px-3 py-1.5 text-xs font-semibold cursor-pointer"
                          >
                            {focusedMissionId === ord.id ? 'Centré' : 'Tracer sur la carte'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Shared Reference Tariff & Commission Rate */}
      {adminTab === 'tariffs' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Commission plateforme par secteur
                </h2>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Prélevée automatiquement lors du règlement client (ex : 10 % sur 15 000 FCFA = 1 500 FCFA).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={commissionPct}
                  onChange={(e) => setCommissionPct(Number(e.target.value))}
                  className="w-20 h-9 px-3 text-sm font-mono tabular-nums bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
                <span className="text-xs font-mono text-[#52635A]">%</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    exec(
                      () => api.updateTariff({ commissionRate: commissionPct / 100 }),
                      `Taux de commission mis à jour à ${commissionPct} %.`
                    )
                  }
                  className="btn-primary px-3.5 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" /> Appliquer
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8E4] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8E4]">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Grille tarifaire de référence commune (FCFA)
              </h2>
              <p className="text-xs text-[#52635A] mt-0.5">
                Toute modification s’applique immédiatement au configurateur client et aux nouvelles négociations.
              </p>
            </div>

            <div className="divide-y divide-[#E2E8E4]">
              {tariffs.map((t) => {
                const draftVal = tariffDrafts[t.id] ?? t.basePriceFcfa;
                return (
                  <div
                    key={t.id}
                    className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">{t.label}</p>
                      <p className="text-xs text-[#52635A]">
                        {t.description} · Durée indicative : {t.estimatedMinutes} min
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        step={500}
                        value={draftVal}
                        onChange={(e) =>
                          setTariffDrafts((p) => ({ ...p, [t.id]: Number(e.target.value) }))
                        }
                        className="w-32 h-9 px-3 text-sm font-mono tabular-nums bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          exec(
                            () =>
                              api.updateTariff({
                                tariffId: t.id,
                                basePriceFcfa: draftVal,
                              }),
                            `Tarif "${t.label}" mis à jour à ${formatFcfa(draftVal)}.`
                          )
                        }
                        className="btn-outline-green px-3 py-2 text-xs font-semibold cursor-pointer"
                      >
                        Enregistrer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Transactions, Orders & Disputes */}
      {adminTab === 'finance' && (
        <div className="space-y-6">
          {/* Disputes */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#B45309]" />
              Réclamations & contrôle qualité ({disputes.length})
            </h2>

            {disputes.length === 0 ? (
              <p className="text-xs text-[#52635A]">
                Aucune réclamation ouverte actuellement.
              </p>
            ) : (
              <div className="space-y-3">
                {disputes.map((d) => (
                  <div
                    key={d.id}
                    className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#0F172A]">
                        {d.clientName} vs {d.companyName}
                      </span>
                      <span className="font-mono text-[#52635A]">
                        {d.status === 'open' ? 'Ouvert' : d.status} · {formatDateTime(d.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-[#0F172A] font-medium">{d.reason}</p>
                    <p className="text-xs text-[#52635A]">{d.details}</p>

                    {d.status === 'open' && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () =>
                                api.resolveDispute(d.id, {
                                  resolution: 'resolved_refund',
                                  adminNotes: 'Remboursement approuvé après audit photos.',
                                }),
                              'Réclamation clôturée avec remboursement.'
                            )
                          }
                          className="btn-danger-solid px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                        >
                          Rembourser le client
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () =>
                                api.resolveDispute(d.id, {
                                  resolution: 'resolved_warning',
                                  adminNotes: 'Avertissement qualité envoyé au prestataire.',
                                }),
                              'Avertissement enregistré sur le dossier entreprise.'
                            )
                          }
                          className="px-3.5 py-2 bg-[#B45309] hover:bg-[#92400E] text-white text-xs font-semibold rounded-xl shadow-xs active:scale-[0.97] transition-all cursor-pointer"
                        >
                          Avertir l’entreprise
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            exec(
                              () =>
                                api.resolveDispute(d.id, {
                                  resolution: 'dismissed',
                                  adminNotes: 'Prestation jugée conforme aux photos.',
                                }),
                              'Réclamation classée sans suite.'
                            )
                          }
                          className="btn-secondary px-3.5 py-1.5 text-xs font-medium cursor-pointer"
                        >
                          Clore conforme
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Financial Ledger */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8E4]">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Journal des transactions & commissions
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAF8] border-b border-[#E2E8E4] text-[#52635A]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-4 font-semibold">Commande</th>
                    <th className="py-3 px-4 font-semibold">Mode</th>
                    <th className="py-3 px-4 font-semibold text-right">Brut</th>
                    <th className="py-3 px-4 font-semibold text-right">Commission</th>
                    <th className="py-3 px-4 font-semibold text-right">Net Entreprise</th>
                    <th className="py-3 px-4 font-semibold">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E4]">
                  {transactions.map((tx) => {
                    const ord = orders.find((o) => o.id === tx.orderId);
                    return (
                      <tr key={tx.id} className="hover:bg-[#F8FAF8]">
                        <td className="py-3 px-4 font-mono tabular-nums text-[#52635A]">
                          {formatDateTime(tx.paidAt)}
                        </td>
                        <td className="py-3 px-4 font-medium text-[#0F172A]">
                          {ord?.referenceCode || tx.orderId} · {ord?.companyName || ''}
                        </td>
                        <td className="py-3 px-4 text-[#52635A]">
                          {PAYMENT_METHOD_LABEL[tx.method]}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-[#0F172A]">
                          {formatFcfa(tx.grossAmountFcfa)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#059669] font-semibold">
                          {formatFcfa(tx.commissionFcfa)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#0F172A]">
                          {formatFcfa(tx.companyNetFcfa)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 text-[#16A34A] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {tx.status === 'paid' ? 'Encaissé' : 'Remboursé'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* All Orders Audit */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-3">
            <h3 className="text-base font-semibold text-[#0F172A]">
              Registre global des commandes ({orders.length})
            </h3>
            <div className="divide-y divide-[#E2E8E4]">
              {orders.map((o) => (
                <div
                  key={o.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-[#0F172A]">
                      {o.referenceCode}
                    </span>{' '}
                    · {o.clientName} → {o.companyName} ({o.quartierName})
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[#52635A]">{ORDER_STATUS_META[o.status].label}</span>
                    <span className="font-mono tabular-nums font-semibold text-[#0F172A]">
                      {formatFcfa(o.finalLockedPriceFcfa ?? o.currentOfferFcfa)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Admin Manual Broadcast & Segmented FCM Logs */}
      {adminTab === 'broadcast' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Manual Broadcast Composer */}
            <div className="lg:col-span-7 bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-[#059669]" />
                  Outil de Diffusion Générale (Mode Broadcast Admin)
                </h2>
                <p className="text-xs text-[#52635A] mt-1 leading-relaxed">
                  Diffusion manuelle réservée aux annonces, promotions ou ouvertures de nouvelles
                  communes. Ne se déclenche jamais automatiquement lors d’une commande client.
                </p>
              </div>

              {/* Quick Templates */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[#52635A]">Modèles rapides :</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBcastTitle('Ouverture de la zone Owendo · -15 % cette semaine');
                      setBcastBody(
                        'Shine x Sanitize dessert désormais tous les quartiers d’Owendo (Port, SNI, Alénakiri) avec équipes vérifiées et suivi GPS.'
                      );
                      setBcastAudience('all');
                      setBcastCommuneId('owendo');
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs font-medium cursor-pointer"
                  >
                    Lancement zone Owendo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBcastTitle('Offre Nettoyage Canapés · Grand Libreville');
                      setBcastBody(
                        'Traitement anti-acariens offert pour toute réservation de nettoyage canapé 3 places ou angle avant dimanche.'
                      );
                      setBcastAudience('clients');
                      setBcastCommuneId('all');
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs font-medium cursor-pointer"
                  >
                    Promotion Clients
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBcastTitle('Rappel qualité aux prestataires · Libreville');
                      setBcastBody(
                        'Pensez à activer le partage GPS trottinette dès votre départ et à joindre au moins 2 photos après intervention.'
                      );
                      setBcastAudience('providers');
                      setBcastCommuneId('libreville');
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs font-medium cursor-pointer"
                  >
                    Note Prestataires Libreville
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Rôle / Audience cible
                  </label>
                  <select
                    value={bcastAudience}
                    onChange={(e) =>
                      setBcastAudience(e.target.value as 'all' | 'clients' | 'providers')
                    }
                    className="w-full h-10 px-3 text-xs font-medium bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option value="all">Tous les inscrits (Clients + Prestataires)</option>
                    <option value="clients">Clients uniquement</option>
                    <option value="providers">Entreprises & Agents uniquement</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Commune ciblée
                  </label>
                  <select
                    value={bcastCommuneId}
                    onChange={(e) => setBcastCommuneId(e.target.value as CommuneId | 'all')}
                    className="w-full h-10 px-3 text-xs font-medium bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option value="all">Toutes les communes (Grand Libreville)</option>
                    {communes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} uniquement
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Titre de la notification
                </label>
                <input
                  type="text"
                  value={bcastTitle}
                  onChange={(e) => setBcastTitle(e.target.value)}
                  placeholder="Ex : Ouverture officielle de la commune d’Owendo"
                  className="w-full h-10 px-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Contenu du message
                </label>
                <textarea
                  rows={3}
                  value={bcastBody}
                  onChange={(e) => setBcastBody(e.target.value)}
                  placeholder="Rédigez le message qui sera diffusé sur le segment FCM sélectionné..."
                  className="w-full p-3 text-xs bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1">
                <p className="text-[11px] font-semibold text-[#52635A]">
                  Condition de segmentation FCM générée :
                </p>
                <p className="text-xs font-mono text-[#059669] break-all">
                  {previewFcmCondition}
                </p>
              </div>

              <button
                type="button"
                disabled={busy || !bcastTitle.trim() || !bcastBody.trim()}
                onClick={() =>
                  exec(async () => {
                    await api.sendBroadcast({
                      title: bcastTitle,
                      body: bcastBody,
                      audience: bcastAudience,
                      communeId: bcastCommuneId,
                    });
                    setBcastTitle('');
                    setBcastBody('');
                  }, 'Diffusion Broadcast envoyée sur le segment FCM sélectionné.')
                }
                className="btn-primary px-4 py-2.5 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Envoyer la diffusion ciblée
              </button>
            </div>

            {/* Rules Summary + Recent Broadcasts */}
            <div className="lg:col-span-5 space-y-5">
              <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-[#059669]" />
                  Règles de segmentation actives
                </h3>
                <div className="space-y-2.5 text-xs text-[#52635A] leading-relaxed">
                  <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3">
                    <p className="font-semibold text-[#0F172A]">
                      1. Commande client → Prestataires ciblés uniquement
                    </p>
                    <p className="mt-1">
                      Lorsqu’un client commande dans une commune, seules les entreprises approuvées
                      et agents disponibles de cette commune reçoivent l’alerte{' '}
                      <span className="font-medium text-[#0F172A]">« Nouvelle demande… »</span>.
                    </p>
                  </div>
                  <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3">
                    <p className="font-semibold text-[#0F172A]">
                      2. Mode Broadcast Admin → Diffusion manuelle
                    </p>
                    <p className="mt-1">
                      Aucune notification générale n’est émise lors d’une commande. Seul cet outil
                      admin diffuse aux clients et/ou prestataires via les topics FCM{' '}
                      <span className="font-mono text-[#0F172A]">commune_*</span> et{' '}
                      <span className="font-mono text-[#0F172A]">role_*</span>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Historique des diffusions Broadcast ({broadcasts.length})
                </h3>
                {broadcasts.length === 0 ? (
                  <p className="text-xs text-[#52635A]">
                    Aucune diffusion manuelle envoyée pour l’instant. Utilisez le formulaire à gauche
                    pour annoncer une promotion ou l’ouverture d’une zone.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto">
                    {broadcasts.map((b) => (
                      <div
                        key={b.id}
                        className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#0F172A]">{b.title}</span>
                          <span className="font-mono tabular-nums text-[#059669] shrink-0">
                            {b.recipientCount} dest.
                          </span>
                        </div>
                        <p className="text-[#52635A]">{b.body}</p>
                        <p className="text-[11px] font-mono text-[#52635A]">
                          {b.audience} · {b.communeId} · {formatDateTime(b.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Live FCM Segmented Dispatch Ledger */}
          <div className="bg-white border border-[#E2E8E4] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8E4] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-[#0F172A]">
                  Journal des envois FCM segmentés ({fcmLogs.length})
                </h3>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Traçabilité des alertes ciblées « Nouvelle Commande » et des diffusions « Broadcast Admin » ({notifications.length} notifications en file).
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#E2E8E4]">
              {fcmLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#52635A]">
                  Aucun envoi FCM enregistré pour l’instant.
                </div>
              ) : (
                fcmLogs.map((log) => (
                <div key={log.id} className="p-4 sm:px-6 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-semibold ${
                          log.kind === 'targeted_order'
                            ? 'text-[#059669]'
                            : log.kind === 'new_registration'
                            ? 'text-[#16A34A]'
                            : 'text-[#0F172A]'
                        }`}
                      >
                        {log.kind === 'targeted_order'
                          ? 'Alerte Ciblée Nouvelle Commande'
                          : log.kind === 'new_registration'
                          ? 'Notification Nouvelle Inscription'
                          : 'Broadcast Administrateur'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#52635A]">{log.targetSummary}</span>
                    </div>
                    <span className="font-mono tabular-nums text-[#52635A]">
                      {log.recipientCount} cible(s) · {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                  <p className="font-semibold text-[#0F172A]">{log.title}</p>
                  <p className="text-[#52635A]">{log.body}</p>
                  <p className="text-[11px] font-mono text-[#059669] bg-[#F8FAF8] border border-[#E2E8E4] rounded px-2.5 py-1.5">
                    FCM condition: {log.condition} ({log.deliveryMode})
                  </p>
                </div>
              ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
