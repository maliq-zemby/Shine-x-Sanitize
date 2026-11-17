import { useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  LogOut,
  Save,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_DAYS,
  DEFAULT_OPENING_TIME,
  WEEKDAYS_META,
  formatCompanyWorkingHours,
  getCompanySchedule,
  parseTimeMinutes,
} from '../lib/schedule';
import type {
  Agent,
  Commune,
  CommuneId,
  Company,
  DayOfWeekKey,
  PaymentRecord,
  RegisteredUser,
} from '../types';

interface AuthViewProps {
  communes: Commune[];
  companies: Company[];
  agents: Agent[];
  currentUser: RegisteredUser | null;
  initialMode?: 'login' | 'register';
  onAuthSuccess: (user: RegisteredUser) => void;
  onProfileUpdated: (user: RegisteredUser) => void;
  onLogout: () => void;
  onNavigateAfterAuth: (role: RegisteredUser['role']) => void;
}

const ROLE_LABELS: Record<RegisteredUser['role'], string> = {
  client: 'Client',
  agent: 'Agent terrain',
  company: 'Entreprise prestataire',
  admin: 'Administrateur',
};

const STATUS_LABELS: Record<RegisteredUser['status'], string> = {
  active: 'Actif',
  pending: 'En attente de validation',
  suspended: 'Suspendu',
};

export function AuthView({
  communes,
  companies,
  agents,
  currentUser,
  initialMode = 'login',
  onAuthSuccess,
  onProfileUpdated,
  onLogout,
  onNavigateAfterAuth,
}: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Onboarding Registration fields
  const [regRole, setRegRole] = useState<'client' | 'agent' | 'company'>('client');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [communeId, setCommuneId] = useState<CommuneId>(communes[0]?.id || 'libreville');
  const [quartierName, setQuartierName] = useState(communes[0]?.quartiers[0]?.name || 'Louis');

  // Company onboarding fields
  const [companyName, setCompanyName] = useState('');
  const [openingDays, setOpeningDays] = useState<DayOfWeekKey[]>(DEFAULT_OPENING_DAYS);
  const [openingTime, setOpeningTime] = useState(DEFAULT_OPENING_TIME);
  const [closingTime, setClosingTime] = useState(DEFAULT_CLOSING_TIME);

  // Agent onboarding fields
  const [targetCompanyId, setTargetCompanyId] = useState(companies[0]?.id || '');
  const [specialty, setSpecialty] = useState('');
  const [scooterTrackerId, setScooterTrackerId] = useState('');

  // Editable persisted profile state for currentUser
  const linkedCompany = currentUser?.companyId
    ? companies.find((c) => c.id === currentUser.companyId)
    : undefined;
  const linkedAgent = currentUser?.agentId
    ? agents.find((a) => a.id === currentUser.agentId)
    : undefined;

  const [profName, setProfName] = useState(currentUser?.name || '');
  const [profPhone, setProfPhone] = useState(currentUser?.phone || '');
  const [profCommuneId, setProfCommuneId] = useState<CommuneId>(
    currentUser?.communeId || 'libreville'
  );
  const [profQuartierName, setProfQuartierName] = useState(currentUser?.quartierName || '');
  const [profDefaultAddress, setProfDefaultAddress] = useState(
    currentUser?.preferences?.defaultAddressDetails || ''
  );
  const [profPayMethod, setProfPayMethod] = useState<PaymentRecord['method']>(
    currentUser?.preferences?.preferredPaymentMethod || 'airtel_money'
  );
  const [profNotifEnabled, setProfNotifEnabled] = useState<boolean>(
    currentUser?.preferences?.notificationsEnabled ?? true
  );
  const [profSmsEnabled, setProfSmsEnabled] = useState<boolean>(
    currentUser?.preferences?.smsUpdatesEnabled ?? true
  );
  const linkedSchedule = linkedCompany ? getCompanySchedule(linkedCompany) : null;
  const [profCompanyName, setProfCompanyName] = useState(
    linkedCompany?.name || currentUser?.companyName || ''
  );
  const [profOpeningDays, setProfOpeningDays] = useState<DayOfWeekKey[]>(
    linkedSchedule?.openingDays || DEFAULT_OPENING_DAYS
  );
  const [profOpeningTime, setProfOpeningTime] = useState(
    linkedSchedule?.openingTime || DEFAULT_OPENING_TIME
  );
  const [profClosingTime, setProfClosingTime] = useState(
    linkedSchedule?.closingTime || DEFAULT_CLOSING_TIME
  );
  const [profCompanyDesc, setProfCompanyDesc] = useState(linkedCompany?.description || '');
  const [profCompanyCommunes, setProfCompanyCommunes] = useState<CommuneId[]>(
    linkedCompany?.communes || (currentUser ? [currentUser.communeId] : ['libreville'])
  );
  const [profAgentStatus, setProfAgentStatus] = useState<Agent['status']>(
    linkedAgent?.status || currentUser?.agentStatus || 'offline'
  );
  const [profSpecialty, setProfSpecialty] = useState(
    linkedAgent?.specialty || currentUser?.specialty || ''
  );
  const [profTrackerId, setProfTrackerId] = useState(
    linkedAgent?.scooterTrackerId || currentUser?.scooterTrackerId || ''
  );

  useEffect(() => {
    if (!currentUser) return;
    setProfName(currentUser.name);
    setProfPhone(currentUser.phone || '');
    setProfCommuneId(currentUser.communeId);
    setProfQuartierName(currentUser.quartierName || '');
    setProfDefaultAddress(currentUser.preferences?.defaultAddressDetails || '');
    setProfPayMethod(currentUser.preferences?.preferredPaymentMethod || 'airtel_money');
    setProfNotifEnabled(currentUser.preferences?.notificationsEnabled ?? true);
    setProfSmsEnabled(currentUser.preferences?.smsUpdatesEnabled ?? true);
    setProfCompanyName(linkedCompany?.name || currentUser.companyName || '');
    const sched = linkedCompany ? getCompanySchedule(linkedCompany) : null;
    setProfOpeningDays(sched?.openingDays || DEFAULT_OPENING_DAYS);
    setProfOpeningTime(sched?.openingTime || DEFAULT_OPENING_TIME);
    setProfClosingTime(sched?.closingTime || DEFAULT_CLOSING_TIME);
    setProfCompanyDesc(linkedCompany?.description || '');
    setProfCompanyCommunes(linkedCompany?.communes || [currentUser.communeId]);
    setProfAgentStatus(linkedAgent?.status || currentUser.agentStatus || 'offline');
    setProfSpecialty(linkedAgent?.specialty || currentUser.specialty || '');
    setProfTrackerId(linkedAgent?.scooterTrackerId || currentUser.scooterTrackerId || '');
  }, [currentUser, linkedCompany, linkedAgent]);

  const selectedCommune = communes.find((c) => c.id === communeId) || communes[0];
  const profileCommune = communes.find((c) => c.id === profCommuneId) || communes[0];

  const handleSaveProfilePatch = async (
    patch: Parameters<typeof api.updateProfile>[0],
    msg = 'Modifications enregistrées et synchronisées en base de données.'
  ) => {
    setProfileBusy(true);
    setError(null);
    setProfileSavedMsg(null);
    try {
      const res = await api.updateProfile(patch);
      onProfileUpdated(res.user);
      setProfileSavedMsg(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de synchronisation du profil.');
    } finally {
      setProfileBusy(false);
    }
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.login({ email: loginEmail, password: loginPassword });
      setAuthToken(res.token);
      onAuthSuccess(res.user);
      setFeedback(`Connecté en tant que ${res.user.name}.`);
      onNavigateAfterAuth(res.user.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de connexion.');
    } finally {
      setBusy(false);
    }
  };

  const toggleDayInList = (
    current: DayOfWeekKey[],
    setter: (next: DayOfWeekKey[]) => void,
    day: DayOfWeekKey
  ) => {
    const exists = current.includes(day);
    const updated = exists ? current.filter((d) => d !== day) : [...current, day];
    setter(WEEKDAYS_META.map((m) => m.id).filter((id) => updated.includes(id)));
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (regRole === 'company') {
      if (openingDays.length === 0) {
        setError('Veuillez sélectionner au moins un jour d’ouverture pour votre entreprise.');
        return;
      }
      const openMin = parseTimeMinutes(openingTime);
      const closeMin = parseTimeMinutes(closingTime);
      if (openMin === null || closeMin === null || openMin >= closeMin) {
        setError('L’heure de fermeture doit être strictement postérieure à l’heure d’ouverture.');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await api.register({
        name,
        email,
        password,
        phone,
        role: regRole,
        communeId,
        quartierName,
        companyName: regRole === 'company' ? companyName : undefined,
        openingDays: regRole === 'company' ? openingDays : undefined,
        openingTime: regRole === 'company' ? openingTime : undefined,
        closingTime: regRole === 'company' ? closingTime : undefined,
        targetCompanyId: regRole === 'agent' ? targetCompanyId : undefined,
        specialty: regRole === 'agent' ? specialty : undefined,
        scooterTrackerId: regRole === 'agent' ? scooterTrackerId : undefined,
      });
      setAuthToken(res.token);
      onAuthSuccess(res.user);
      setFeedback(
        regRole === 'client'
          ? 'Inscription finalisée ! Votre compte client est actif et les entreprises partenaires ont été notifiées.'
          : 'Inscription enregistrée ! Votre dossier et vos horaires ont été enregistrés en attente de validation administrative.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de finaliser l’inscription.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E2E8E4] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">
            Compte & Authentification · Shine x Sanitize
          </h1>
          <p className="text-sm text-[#52635A] mt-0.5">
            Alp Group — Connexion sécurisée par Email et Mot de passe · Parcours d’inscription par rôle.
          </p>
        </div>

        <div className="tab-group flex items-center gap-1 self-start">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'login' ? 'tab-segment-active font-semibold' : 'tab-segment'
            }`}
          >
            Se connecter
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'register' ? 'tab-segment-active font-semibold' : 'tab-segment'
            }`}
          >
            Créer un compte
          </button>
        </div>
      </div>

      {/* Active Session Card + Synchronized Profile Settings if logged in */}
      {currentUser && (
        <div className="space-y-6">
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#52635A]">
                <span className="font-semibold text-[#0F172A] text-sm">{currentUser.name}</span>
                <span aria-hidden="true">·</span>
                <span>{currentUser.email}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#059669]">{ROLE_LABELS[currentUser.role]}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-medium ${
                    currentUser.status === 'active'
                      ? 'text-[#16A34A]'
                      : currentUser.status === 'pending'
                      ? 'text-[#B45309]'
                      : 'text-[#B91C1C]'
                  }`}
                >
                  {STATUS_LABELS[currentUser.status]}
                </span>
              </div>
              <p className="text-xs text-[#52635A]">
                Commune : {currentUser.communeName}
                {currentUser.quartierName ? ` (${currentUser.quartierName})` : ''}
                {currentUser.companyName ? ` · Entreprise : ${currentUser.companyName}` : ''} ·
                Inscrit le {formatDateTime(currentUser.createdAt)}
                {currentUser.updatedAt
                  ? ` · Synchronisé le ${formatDateTime(currentUser.updatedAt)}`
                  : ''}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateAfterAuth(currentUser.role)}
                className={`${
                  currentUser.role === 'client' ? 'btn-primary' : 'btn-slate'
                } px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer`}
              >
                Ouvrir mon espace
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="btn-secondary px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Déconnexion
              </button>
            </div>
          </div>

          {/* Persistent Profile & Preferences Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveProfilePatch({
                name: profName,
                phone: profPhone,
                communeId: profCommuneId,
                quartierName: profQuartierName,
                preferences: {
                  defaultAddressDetails: profDefaultAddress,
                  preferredPaymentMethod: profPayMethod,
                  notificationsEnabled: profNotifEnabled,
                  smsUpdatesEnabled: profSmsEnabled,
                },
                ...(currentUser.role === 'company'
                  ? {
                      companyName: profCompanyName,
                      openingDays: profOpeningDays,
                      openingTime: profOpeningTime,
                      closingTime: profClosingTime,
                      companyWorkingHours: formatCompanyWorkingHours(
                        profOpeningDays,
                        profOpeningTime,
                        profClosingTime
                      ),
                      companyDescription: profCompanyDesc,
                      companyCommunes: profCompanyCommunes,
                    }
                  : {}),
                ...(currentUser.role === 'agent'
                  ? {
                      agentStatus: profAgentStatus,
                      specialty: profSpecialty,
                      scooterTrackerId: profTrackerId,
                    }
                  : {}),
              });
            }}
            className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E2E8E4] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Mon profil & paramètres synchronisés
                </h2>
                <p className="text-xs text-[#52635A] mt-0.5">
                  Toute modification est enregistrée en base de données et restaurée automatiquement à votre reconnexion.
                </p>
              </div>
              {profileSavedMsg && (
                <span className="text-xs font-medium text-[#16A34A] inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {profileSavedMsg}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Nom complet</label>
                <input
                  type="text"
                  required
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Téléphone</label>
                <input
                  type="tel"
                  value={profPhone}
                  onChange={(e) => setProfPhone(e.target.value)}
                  placeholder="+241 07 00 00 00"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Paiement préféré
                </label>
                <select
                  value={profPayMethod}
                  onChange={(e) => {
                    const next = e.target.value as PaymentRecord['method'];
                    setProfPayMethod(next);
                    void handleSaveProfilePatch(
                      { preferences: { preferredPaymentMethod: next } },
                      'Préférence de paiement sauvegardée.'
                    );
                  }}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  <option value="airtel_money">Airtel Money</option>
                  <option value="moov_money">Moov Money</option>
                  <option value="cash">Espèces</option>
                  <option value="card">Carte bancaire</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Commune</label>
                <select
                  value={profCommuneId}
                  onChange={(e) => {
                    const nextCId = e.target.value as CommuneId;
                    setProfCommuneId(nextCId);
                    const nextC = communes.find((c) => c.id === nextCId);
                    if (nextC?.quartiers[0]) setProfQuartierName(nextC.quartiers[0].name);
                  }}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Quartier</label>
                <select
                  value={profQuartierName}
                  onChange={(e) => setProfQuartierName(e.target.value)}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  {profileCommune?.quartiers.map((q) => (
                    <option key={q.id} value={q.name}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Adresse / repère par défaut
                </label>
                <input
                  type="text"
                  value={profDefaultAddress}
                  onChange={(e) => setProfDefaultAddress(e.target.value)}
                  placeholder="Ex : Villa 14 près du carrefour"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>
            </div>

            {currentUser.role === 'company' && (
              <div className="pt-3 border-t border-[#E2E8E4] space-y-4">
                <p className="text-xs font-semibold text-[#0F172A]">
                  Paramètres Entreprise synchronisés
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Nom commercial de l’entreprise
                    </label>
                    <input
                      type="text"
                      value={profCompanyName}
                      onChange={(e) => setProfCompanyName(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Description commerciale
                    </label>
                    <input
                      type="text"
                      value={profCompanyDesc}
                      onChange={(e) => setProfCompanyDesc(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                  <div className="lg:col-span-6 space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Jours d’ouverture
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS_META.map((d) => {
                        const active = profOpeningDays.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => toggleDayInList(profOpeningDays, setProfOpeningDays, d.id)}
                            className={`px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                              active ? 'btn-chip-active' : 'btn-chip'
                            }`}
                          >
                            {d.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="lg:col-span-3 space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Heure d’ouverture
                    </label>
                    <input
                      type="time"
                      value={profOpeningTime}
                      onChange={(e) => setProfOpeningTime(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                    />
                  </div>
                  <div className="lg:col-span-3 space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Heure de fermeture
                    </label>
                    <input
                      type="time"
                      value={profClosingTime}
                      onChange={(e) => setProfClosingTime(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Communes couvertes
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {communes.map((c) => {
                      const active = profCompanyCommunes.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setProfCompanyCommunes((prev) =>
                              prev.includes(c.id)
                                ? prev.length > 1
                                  ? prev.filter((x) => x !== c.id)
                                  : prev
                                : [...prev, c.id]
                            )
                          }
                          className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                            active ? 'btn-chip-active' : 'btn-chip'
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {currentUser.role === 'agent' && (
              <div className="pt-3 border-t border-[#E2E8E4] grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Statut de disponibilité
                  </label>
                  <select
                    value={profAgentStatus}
                    onChange={(e) => {
                      const nextSt = e.target.value as Agent['status'];
                      setProfAgentStatus(nextSt);
                      void handleSaveProfilePatch(
                        { agentStatus: nextSt },
                        'Statut de disponibilité enregistré.'
                      );
                    }}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option value="available">Disponible</option>
                    <option value="busy">Occupé / En intervention</option>
                    <option value="offline">Hors ligne</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">Spécialité</label>
                  <input
                    type="text"
                    value={profSpecialty}
                    onChange={(e) => setProfSpecialty(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    ID Traceur trottinette
                  </label>
                  <input
                    type="text"
                    value={profTrackerId}
                    onChange={(e) => setProfTrackerId(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#E2E8E4]">
              <div className="flex flex-wrap items-center gap-5 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profNotifEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setProfNotifEnabled(checked);
                      void handleSaveProfilePatch(
                        { preferences: { notificationsEnabled: checked } },
                        'Préférence notifications enregistrée.'
                      );
                    }}
                    className="accent-[#059669]"
                  />
                  <span className="text-[#0F172A]">Notifications push en temps réel</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profSmsEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setProfSmsEnabled(checked);
                      void handleSaveProfilePatch(
                        { preferences: { smsUpdatesEnabled: checked } },
                        'Préférence SMS enregistrée.'
                      );
                    }}
                    className="accent-[#059669]"
                  />
                  <span className="text-[#0F172A]">Alertes SMS d’intervention</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={profileBusy}
                className="btn-primary px-4 py-2.5 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {profileBusy ? 'Sauvegarde...' : 'Enregistrer les modifications'}
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C]">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3.5 rounded-lg bg-[#F1F5F2] border border-[#059669]/30 text-xs font-medium text-[#059669] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {mode === 'login' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Email + Password Login Form */}
          <form
            onSubmit={handleLoginSubmit}
            className="lg:col-span-7 bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#059669]" />
                Connexion par Email & Mot de passe
              </h2>
              <p className="text-xs text-[#52635A]">
                Authentification JWT vérifiée côté serveur avec hachage cryptographique scrypt.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#0F172A]">Adresse email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="ex: client@libreville.ga"
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg focus:outline-none focus:border-[#059669]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#0F172A]">Mot de passe</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg focus:outline-none focus:border-[#059669]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary px-5 py-2.5 disabled:opacity-50 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {busy ? 'Vérification...' : 'Se connecter'}
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className="btn-secondary px-3.5 py-2 text-xs font-medium text-[#059669] whitespace-nowrap cursor-pointer"
              >
                Créer un compte →
              </button>
            </div>
          </form>

          {/* Role & Validation Overview */}
          <div className="lg:col-span-5 bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A]">
                Rôles & parcours d’accès
              </h3>
              <p className="text-xs text-[#52635A] mt-0.5">
                Chaque inscription enregistre le profil, la commune et le statut dans la base centrale.
              </p>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3.5 bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg space-y-1">
                <p className="font-semibold text-[#0F172A]">Client particulier / pro</p>
                <p className="text-[#52635A]">
                  Activation immédiate après inscription. Commande personnalisée, négociation du budget et suivi GPS.
                </p>
              </div>
              <div className="p-3.5 bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg space-y-1">
                <p className="font-semibold text-[#0F172A]">Entreprise prestataire & Agent terrain</p>
                <p className="text-[#52635A]">
                  Inscription soumise à validation administrative avant activation de l’espace professionnel.
                </p>
              </div>
              <div className="p-3.5 bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg space-y-1">
                <p className="font-semibold text-[#0F172A]">Administration centrale</p>
                <p className="text-[#52635A]">
                  Connectez-vous avec votre compte administrateur maître pour approuver les entreprises et superviser la plateforme.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Distinct Onboarding Registration Flow by Role */
        <form
          onSubmit={handleRegisterSubmit}
          className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-6"
        >
          {/* Step 1: Role Selection during Onboarding */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-[#0F172A]">
              1. Choisissez votre profil d’inscription
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                [
                  {
                    id: 'client',
                    title: 'Client particulier / pro',
                    desc: 'Activation immédiate. Réservez des prestations, négociez le budget et suivez les agents en GPS.',
                    icon: User,
                  },
                  {
                    id: 'agent',
                    title: 'Agent terrain',
                    desc: 'Validation requise. Recevez vos missions, gérez le départ GPS et les photos avant/après.',
                    icon: Wrench,
                  },
                  {
                    id: 'company',
                    title: 'Entreprise prestataire',
                    desc: 'Validation administrative requise. Recevez les demandes de votre commune et affectez vos équipes.',
                    icon: Building2,
                  },
                ] as const
              ).map((r) => {
                const Icon = r.icon;
                const selected = regRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRegRole(r.id)}
                    className={`text-left p-4 rounded-2xl border transition-all duration-150 cursor-pointer space-y-2 ${
                      selected
                        ? 'border-[#059669] bg-[#ECFDF5] shadow-sm'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#10B981] hover:bg-[#ECFDF5]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Icon className="w-4 h-4 text-[#059669]" />
                      {selected && (
                        <span className="text-[11px] font-semibold text-[#059669]">Sélectionné</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#0F172A]">{r.title}</p>
                    <p className="text-xs text-[#475569] leading-relaxed">{r.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Common Identity & Location Fields */}
          <div className="space-y-4 pt-2 border-t border-[#E2E8E4]">
            <h2 className="text-base font-semibold text-[#0F172A]">
              2. Informations du compte ({ROLE_LABELS[regRole]})
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  {regRole === 'company' ? 'Nom du responsable / gérant' : 'Nom complet'} *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Patricia Moundounga"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@exemple.ga"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Mot de passe (min. 6 caractères) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Téléphone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+241 07 00 00 00"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Commune *</label>
                <select
                  value={communeId}
                  onChange={(e) => {
                    const nextId = e.target.value as CommuneId;
                    setCommuneId(nextId);
                    const nextC = communes.find((c) => c.id === nextId);
                    if (nextC?.quartiers[0]) setQuartierName(nextC.quartiers[0].name);
                  }}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">Quartier</label>
                <select
                  value={quartierName}
                  onChange={(e) => setQuartierName(e.target.value)}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  {selectedCommune?.quartiers.map((q) => (
                    <option key={q.id} value={q.name}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Step 3A: Company-specific onboarding */}
          {regRole === 'company' && (
            <div className="space-y-5 pt-2 border-t border-[#E2E8E4]">
              <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#059669]" />
                3. Dossier Entreprise (soumis à validation administrative)
              </h3>
              <div className="max-w-md space-y-1.5">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Nom commercial de l’entreprise *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Gabon Nettoyage Express"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>

              {/* Section Horaires et Jours d'ouverture */}
              <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-xl p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#059669]" />
                      Horaires et Jours d’ouverture *
                    </p>
                    <p className="text-[11px] text-[#52635A] mt-0.5">
                      Ces plages horaires déterminent automatiquement les créneaux réservables par vos clients.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setOpeningDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
                      }
                      className="btn-secondary px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                    >
                      Lun – Ven
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpeningDays(DEFAULT_OPENING_DAYS)}
                      className="btn-secondary px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                    >
                      Lun – Sam
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpeningDays(WEEKDAYS_META.map((d) => d.id))}
                      className="btn-secondary px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                    >
                      7j/7
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Jours de travail actifs *
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS_META.map((day) => {
                      const active = openingDays.includes(day.id);
                      return (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDayInList(openingDays, setOpeningDays, day.id)}
                          className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                            active ? 'btn-chip-active font-semibold' : 'btn-chip'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Heure d’ouverture *
                    </label>
                    <input
                      type="time"
                      required
                      value={openingTime}
                      onChange={(e) => setOpeningTime(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-white border border-[#E2E8E4] rounded-lg font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Heure de fermeture *
                    </label>
                    <input
                      type="time"
                      required
                      value={closingTime}
                      onChange={(e) => setClosingTime(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-white border border-[#E2E8E4] rounded-lg font-mono"
                    />
                  </div>
                </div>

                <p className="text-xs font-medium text-[#059669]">
                  Horaires officiels enregistrés :{' '}
                  <span className="font-mono">
                    {formatCompanyWorkingHours(openingDays, openingTime, closingTime)}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Step 3B: Agent-specific onboarding */}
          {regRole === 'agent' && (
            <div className="space-y-4 pt-2 border-t border-[#E2E8E4]">
              <h3 className="text-sm font-semibold text-[#0F172A]">
                3. Profil Agent Terrain
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Entreprise de rattachement
                  </label>
                  <select
                    value={targetCompanyId}
                    onChange={(e) => setTargetCompanyId(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    {companies.length === 0 ? (
                      <option value="">Aucune entreprise inscrite pour l’instant</option>
                    ) : (
                      companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">Spécialité</label>
                  <input
                    type="text"
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    placeholder="Canapés, cuir & vapeur"
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    ID Traceur trottinette
                  </label>
                  <input
                    type="text"
                    value={scooterTrackerId}
                    onChange={(e) => setScooterTrackerId(e.target.value)}
                    placeholder="Ex: TR-LBV-09"
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#E2E8E4]">
            <p className="text-xs text-[#52635A]">
              À la validation, les entreprises de la plateforme reçoivent une notification de nouvelle inscription.
            </p>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary px-5 py-2.5 disabled:opacity-50 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {busy ? 'Enregistrement...' : 'Finaliser mon inscription'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
