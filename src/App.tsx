import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthView } from './components/AuthView';
import { ClientHome } from './components/ClientHome';
import { ClientOrderTracker } from './components/ClientOrderTracker';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ProWorkspace } from './components/ProWorkspace';
import { ServiceConfigurator } from './components/ServiceConfigurator';
import { TopBar, type AppView } from './components/TopBar';
import { api, getAuthToken, setAuthToken } from './lib/api';
import type {
  BootstrapPayload,
  CleaningCategoryId,
  CommuneId,
  Order,
  RegisteredUser,
} from './types';

function getDefaultViewForUser(user: RegisteredUser): AppView {
  if (user.role === 'admin') return 'admin';
  if (user.role === 'company' || user.role === 'agent') return 'pro';
  const saved = user.preferences?.lastActiveView;
  if (saved === 'home' || saved === 'orders' || saved === 'configurator') {
    return saved;
  }
  return 'home';
}

export default function App() {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [currentUser, setCurrentUser] = useState<RegisteredUser | null>(null);
  const [bootPhase, setBootPhase] = useState<'checking' | 'offline' | 'ready'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );

  const [activeView, setActiveView] = useState<AppView>('auth');
  const [selectedCommuneId, setSelectedCommuneId] = useState<CommuneId>('libreville');
  const [selectedQuartier, setSelectedQuartier] = useState<string>('Louis');
  const [configCategoryId, setConfigCategoryId] = useState<CleaningCategoryId>('canape');
  const [preselectedCompanyId, setPreselectedCompanyId] = useState<string | undefined>(undefined);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const syncTimeoutRef = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const payload = await api.getBootstrap();
      setData(payload);
      setError(null);
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement des données.');
      return null;
    }
  }, []);

  const verifyConnectivityAndSession = useCallback(async () => {
    setBootPhase('checking');

    // 1. Vérification obligatoire de la connexion Internet avant tout lancement
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBootPhase('offline');
      return;
    }

    let bootstrapPayload: BootstrapPayload | null = null;
    try {
      bootstrapPayload = await api.getBootstrap();
      setData(bootstrapPayload);
      setError(null);
    } catch {
      setBootPhase('offline');
      return;
    }

    // 2. Vérification du jeton de session persistant (connexion automatique)
    const storedToken = getAuthToken();
    if (storedToken) {
      try {
        const res = await api.getMe();
        if (res.user && res.user.status !== 'suspended') {
          setCurrentUser(res.user);
          setSelectedCommuneId(res.user.communeId);
          if (res.user.quartierName) setSelectedQuartier(res.user.quartierName);
          if (res.user.preferences?.lastSelectedOrderId) {
            setSelectedOrderId(res.user.preferences.lastSelectedOrderId);
          }
          setActiveView(getDefaultViewForUser(res.user));
          setBootPhase('ready');
          return;
        }
      } catch {
        setAuthToken(null);
        setCurrentUser(null);
      }
    } else {
      setCurrentUser(null);
    }

    // Aucun jeton valide : redirection directe vers l'écran de connexion par email
    setActiveView('auth');
    setBootPhase('ready');
  }, []);

  useEffect(() => {
    void verifyConnectivityAndSession();
    if (!mapsApiKey) {
      api
        .getMapsConfig()
        .then((cfg) => {
          if (cfg.apiKey) setMapsApiKey(cfg.apiKey);
        })
        .catch(() => {});
    }
  }, [verifyConnectivityAndSession, mapsApiKey]);

  // Re-vérifier automatiquement dès le retour de la connexion Internet si bloqué hors ligne
  useEffect(() => {
    const handleOnline = () => {
      if (bootPhase === 'offline') {
        void verifyConnectivityAndSession();
      } else {
        void fetchAll();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [bootPhase, verifyConnectivityAndSession, fetchAll]);

  // Real-time Server-Sent Events subscription with automatic reconnect on micro-outages
  useEffect(() => {
    if (bootPhase !== 'ready') return;
    let disposed = false;
    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let retryDelayMs = 1500;
    let hadError = false;

    const connectStream = () => {
      if (disposed) return;
      es = new EventSource('/api/stream');
      es.onopen = () => {
        retryDelayMs = 1500;
        if (hadError) {
          hadError = false;
          void fetchAll();
        }
      };
      es.onmessage = () => {
        void fetchAll();
      };
      es.onerror = () => {
        hadError = true;
        es?.close();
        es = null;
        if (!disposed && retryTimer === null) {
          const delay = retryDelayMs;
          retryDelayMs = Math.min(8000, Math.round(retryDelayMs * 1.5));
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            connectStream();
          }, delay);
        }
      };
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void fetchAll();
      }
    };

    connectStream();
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      es?.close();
    };
  }, [bootPhase, fetchAll]);

  // Listen for Demo Key Google Maps quota exceeded events
  useEffect(() => {
    const handler = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  const persistUserPatch = useCallback(
    (patch: Parameters<typeof api.updateProfile>[0]) => {
      if (!getAuthToken() || !currentUser) return;
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = window.setTimeout(() => {
        api
          .updateProfile(patch)
          .then((res) => {
            setCurrentUser(res.user);
          })
          .catch(() => {});
      }, 150);
    },
    [currentUser]
  );

  const navigateTo = useCallback(
    (v: AppView) => {
      setActiveView(v);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (currentUser && v !== 'auth') {
        persistUserPatch({
          preferences: { lastActiveView: v },
        });
      }
    },
    [currentUser, persistUserPatch]
  );

  const handleLaunchConfigurator = (catId: CleaningCategoryId, companyId?: string) => {
    setConfigCategoryId(catId);
    setPreselectedCompanyId(companyId);
    navigateTo('configurator');
  };

  const handleOrderCreated = (order: Order) => {
    setSelectedOrderId(order.id);
    if (currentUser) {
      persistUserPatch({
        preferences: { lastActiveView: 'orders', lastSelectedOrderId: order.id },
      });
    }
    setActiveView('orders');
    void fetchAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAuthSuccess = (user: RegisteredUser) => {
    setCurrentUser(user);
    setSelectedCommuneId(user.communeId);
    if (user.quartierName) setSelectedQuartier(user.quartierName);
    if (user.preferences?.lastSelectedOrderId) {
      setSelectedOrderId(user.preferences.lastSelectedOrderId);
    }
    setActiveView(getDefaultViewForUser(user));
    void fetchAll();
  };

  const handleProfileUpdated = (user: RegisteredUser) => {
    setCurrentUser(user);
    setSelectedCommuneId(user.communeId);
    if (user.quartierName) setSelectedQuartier(user.quartierName);
    void fetchAll();
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setSelectedOrderId(null);
    setActiveView('auth');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (bootPhase === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
        <div className="max-w-sm w-full bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <img
            src="/assets/logo-shine-sanitize.png"
            alt="Shine x Sanitize — Alp Group"
            className="w-20 h-20 mx-auto rounded-2xl border border-[#E2E8F0] bg-white object-contain p-1"
          />
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-[#0F172A]">Shine x Sanitize</h1>
            <p className="text-xs font-medium text-[#475569]">Alp Group</p>
          </div>
          <p className="text-xs text-[#475569]">
            Vérification de la connexion Internet et de votre session sécurisée...
          </p>
        </div>
      </div>
    );
  }

  if (bootPhase === 'offline') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
        <div className="max-w-md w-full bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-5 shadow-sm">
          <img
            src="/assets/logo-shine-sanitize.png"
            alt="Shine x Sanitize — Alp Group"
            className="w-20 h-20 mx-auto rounded-2xl border border-[#E2E8F0] bg-white object-contain p-1"
          />
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
              <WifiOff className="w-4 h-4" />
              Connexion Internet obligatoire
            </div>
            <h1 className="text-xl font-bold text-[#0F172A]">
              Impossible de joindre les serveurs Shine x Sanitize
            </h1>
            <p className="text-xs text-[#475569] leading-relaxed">
              Une connexion Internet active est requise au démarrage pour vérifier votre jeton de
              session sécurisé et synchroniser vos données (Alp Group).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void verifyConnectivityAndSession()}
            className="btn-primary w-full py-2.5 px-4 text-xs font-semibold cursor-pointer"
          >
            Réessayer la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <TopBar
        activeView={activeView}
        currentUser={currentUser}
        onNavigate={navigateTo}
        onStartOrder={() => handleLaunchConfigurator('canape')}
      />

      <main className="flex-1">
        {!data && error ? (
          <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-3">
            <p className="text-base font-semibold text-[#B91C1C]">{error}</p>
            <button
              type="button"
              onClick={() => void fetchAll()}
              className="btn-primary px-5 py-2.5 text-xs font-semibold cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        ) : data ? (
          <>
            {activeView === 'home' && (
              <ClientHome
                communes={data.communes}
                sectors={data.sectors}
                tariffs={data.tariffs}
                companies={data.companies}
                agents={data.agents}
                orders={data.orders}
                broadcasts={data.broadcasts || []}
                selectedCommuneId={selectedCommuneId}
                selectedQuartier={selectedQuartier}
                onSelectLocation={(c, q) => {
                  setSelectedCommuneId(c);
                  setSelectedQuartier(q);
                  if (currentUser) {
                    persistUserPatch({ communeId: c, quartierName: q });
                  }
                }}
                onLaunchConfigurator={handleLaunchConfigurator}
                onOpenOrder={(id) => {
                  setSelectedOrderId(id);
                  if (currentUser) {
                    persistUserPatch({
                      preferences: { lastActiveView: 'orders', lastSelectedOrderId: id },
                    });
                  }
                  setActiveView('orders');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            )}

            {activeView === 'configurator' && (
              <ServiceConfigurator
                communes={data.communes}
                tariffs={data.tariffs}
                extraTreatments={data.extraTreatments}
                companies={data.companies}
                agents={data.agents}
                currentUser={currentUser}
                mapsApiKey={mapsApiKey}
                initialCategoryId={configCategoryId}
                initialCompanyId={preselectedCompanyId}
                selectedCommuneId={selectedCommuneId}
                selectedQuartier={selectedQuartier}
                onCancel={() => navigateTo('home')}
                onOrderCreated={handleOrderCreated}
              />
            )}

            {activeView === 'orders' && (
              <ClientOrderTracker
                orders={data.orders}
                agents={data.agents}
                notifications={data.notifications}
                mapsApiKey={mapsApiKey}
                preferredPaymentMethod={currentUser?.preferences?.preferredPaymentMethod}
                defaultPayPhone={currentUser?.phone}
                selectedOrderId={selectedOrderId}
                onSelectOrder={(orderId) => {
                  setSelectedOrderId(orderId);
                  if (currentUser) {
                    persistUserPatch({
                      preferences: { lastSelectedOrderId: orderId },
                    });
                  }
                }}
                onOrderUpdated={() => void fetchAll()}
              />
            )}

            {activeView === 'pro' && (
              <ProWorkspace
                companies={data.companies}
                agents={data.agents}
                orders={data.orders}
                transactions={data.transactions}
                notifications={data.notifications || []}
                currentUser={currentUser}
                mapsApiKey={mapsApiKey}
                onDataChanged={() => void fetchAll()}
                onProfileUpdated={handleProfileUpdated}
              />
            )}

            {activeView === 'admin' && (
              <AdminDashboard
                communes={data.communes}
                sectors={data.sectors}
                tariffs={data.tariffs}
                companies={data.companies}
                agents={data.agents}
                orders={data.orders}
                disputes={data.disputes}
                transactions={data.transactions}
                notifications={data.notifications || []}
                broadcasts={data.broadcasts || []}
                fcmLogs={data.fcmLogs || []}
                currentUser={currentUser}
                mapsApiKey={mapsApiKey}
                onDataChanged={() => void fetchAll()}
                onAdminAuthenticated={handleAuthSuccess}
              />
            )}

            {activeView === 'auth' && (
              <AuthView
                communes={data.communes}
                companies={data.companies}
                agents={data.agents}
                currentUser={currentUser}
                onAuthSuccess={handleAuthSuccess}
                onProfileUpdated={handleProfileUpdated}
                onLogout={handleLogout}
                onNavigateAfterAuth={(role) => {
                  const target: AppView =
                    role === 'admin'
                      ? 'admin'
                      : role === 'company' || role === 'agent'
                      ? 'pro'
                      : 'home';
                  navigateTo(target);
                }}
              />
            )}
          </>
        ) : null}
      </main>

      <footer className="border-t border-[#E2E8F0] bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#475569]">
          <div className="flex items-center gap-3">
            <img
              src="/assets/logo-shine-sanitize.png"
              alt="Shine x Sanitize — Alp Group"
              className="w-8 h-8 rounded-lg border border-[#E2E8F0] bg-white object-contain p-0.5 shrink-0"
            />
            <p>
              <strong className="text-[#0F172A]">Shine x Sanitize</strong> · Alp Group · Libreville,
              Akanda & Owendo (Gabon) · Cartographie soumise aux conditions Google Maps Platform
            </p>
          </div>
          <p>Plateforme multiservices à domicile · Alp Group</p>
        </div>
      </footer>
      <OfflineIndicator />
    </div>
  );
}
