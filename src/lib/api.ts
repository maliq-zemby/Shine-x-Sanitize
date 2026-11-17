import type {
  AccountStatus,
  Agent,
  AuthResponse,
  BootstrapPayload,
  Commune,
  CommuneId,
  CompanyApprovalStatus,
  DayOfWeekKey,
  ForegroundSyncMode,
  LocationPermissionMode,
  Order,
  PaymentRecord,
  ProfileSyncResponse,
  ProfileUpdatePayload,
  Quartier,
  RegisteredUser,
  UserRole,
} from '../types';

const TOKEN_STORAGE_KEY = 'komo_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function handleStaticFallback<T>(url: string, options?: RequestInit): T {
  const method = options?.method || 'GET';
  const body = options?.body ? JSON.parse(String(options.body)) : {};

  const storedUsers = JSON.parse(localStorage.getItem('shine_static_users') || '[]');
  const storedOrders = JSON.parse(localStorage.getItem('shine_static_orders') || '[]');

  if (url === '/api/bootstrap') {
    const payload: BootstrapPayload = {
      communes: [
        {
          id: 'libreville',
          name: 'Libreville',
          travelFeeFcfa: 1500,
          center: { lat: 0.3901, lng: 9.4536 },
          quartiers: [
            { id: 'q1', name: 'Louis', lat: 0.395, lng: 9.455 },
            { id: 'q2', name: 'Glass', lat: 0.388, lng: 9.452 },
            { id: 'q3', name: 'Mont-Bouët', lat: 0.392, lng: 9.448 }
          ]
        },
        {
          id: 'akanda',
          name: 'Akanda',
          travelFeeFcfa: 2500,
          center: { lat: 0.518, lng: 9.467 },
          quartiers: [
            { id: 'aq1', name: 'Amissa Chantal', lat: 0.52, lng: 9.465 },
            { id: 'aq2', name: 'Agondjé', lat: 0.525, lng: 9.471 }
          ]
        },
        {
          id: 'owendo',
          name: 'Owendo',
          travelFeeFcfa: 2000,
          center: { lat: 0.301, lng: 9.501 },
          quartiers: [
            { id: 'oq1', name: 'SNI', lat: 0.305, lng: 9.502 },
            { id: 'oq2', name: 'Alénakiri', lat: 0.298, lng: 9.510 }
          ]
        }
      ],
      sectors: [
        { id: 'nettoyage', name: 'Nettoyage professionnel & désinfection', subtitle: 'Experts certifiés', active: true, commissionRate: 0.1 }
      ],
      tariffs: [
        { id: 't1', categoryId: 'canape', code: 'CANAPE_3P', label: 'Canapé 3 places', description: 'Nettoyage profondeur', basePriceFcfa: 15000, estimatedMinutes: 60 },
        { id: 't2', categoryId: 'matelas', code: 'MATELAS_2P', label: 'Matelas 2 places', description: 'Anti-acariens', basePriceFcfa: 15000, estimatedMinutes: 45 },
        { id: 't3', categoryId: 'vehicule', code: 'VEHICULE_COMPLET', label: 'Nettoyage auto complet', description: 'Intérieur vapeur', basePriceFcfa: 20000, estimatedMinutes: 90 },
        { id: 't4', categoryId: 'fin_travaux', code: 'FIN_TRAVAUX', label: 'Remise en état après travaux', description: 'Brigade complète', basePriceFcfa: 45000, estimatedMinutes: 180 }
      ],
      extraTreatments: [
        { id: 'ex1', label: 'Désodorisation profonde', description: 'Neutralisation moléculaire', priceFcfa: 0 },
        { id: 'ex2', label: 'Protection textile imperméabilisante', description: 'Barrière anti-taches', priceFcfa: 10000 },
        { id: 'ex3', label: 'Nettoyage à vapeur', description: 'Assainissement thermique', priceFcfa: 5000 }
      ],
      companies: [
        {
          id: 'comp_1',
          name: 'Gabon Nettoyage Express',
          initials: 'GNE',
          description: 'Nettoyage professionnel',
          approvalStatus: 'approved',
          verified: true,
          rating: 4.8,
          reviewCount: 34,
          communes: ['libreville', 'akanda'],
          categoriesSupported: ['canape', 'fauteuil', 'tapis', 'matelas', 'chaise', 'moquette', 'vehicule', 'bureau', 'fin_travaux'],
          workingHours: '08:00 - 18:00 (Lun - Sam)',
          phone: '+241 07 11 22 33',
          baseLocation: { lat: 0.395, lng: 9.455 },
          equipment: ['Injection-extraction', 'Vapeur pro'],
          completedInterventions: 142,
          estimatedArrivalMin: 25,
          methodsSupported: ['Injection', 'Vapeur']
        }
      ] as any,
      agents: [
        {
          id: 'ag_1',
          companyId: 'comp_1',
          name: 'Jean-Luc Moundounga',
          phone: '+241 07 00 11 22',
          status: 'available',
          specialty: 'Canapés & Cuir',
          scooterTrackerId: 'TR-LBV-01',
          currentLocation: { lat: 0.392, lng: 9.450 },
          completedJobs: 89,
          rating: 4.9,
          locationPermissionMode: 'always_allow',
          backgroundServiceActive: true,
          syncIntervalSeconds: 6
        }
      ] as any,
      orders: storedOrders,
      disputes: [],
      transactions: [],
      notifications: [],
      broadcasts: [],
      fcmLogs: []
    };
    return payload as unknown as T;
  }

  if (url === '/api/config/maps') {
    return { apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '' } as unknown as T;
  }

  if (url === '/api/auth/register' && method === 'POST') {
    const newUser: RegisteredUser = {
      id: 'usr_' + Date.now(),
      name: body.name || 'Utilisateur',
      email: body.email || 'user@example.ga',
      role: body.role || 'client',
      status: body.role === 'client' ? 'active' : 'pending',
      communeId: body.communeId || 'libreville',
      communeName: body.communeId === 'akanda' ? 'Akanda' : 'Libreville',
      quartierName: body.quartierName || 'Louis',
      phone: body.phone,
      companyName: body.companyName,
      createdAt: new Date().toISOString()
    };
    storedUsers.push({ ...newUser, password: body.password });
    localStorage.setItem('shine_static_users', JSON.stringify(storedUsers));
    const token = 'static_token_' + newUser.id;
    setAuthToken(token);
    localStorage.setItem('shine_static_current_user_id', newUser.id);
    return { token, user: newUser } as unknown as T;
  }

  if (url === '/api/auth/login' && method === 'POST') {
    const found = storedUsers.find((u: any) => u.email === body.email);
    if (!found) {
      const defaultUser: RegisteredUser = {
        id: 'usr_default',
        name: body.email.split('@')[0] || 'Client',
        email: body.email,
        role: 'client',
        status: 'active',
        communeId: 'libreville',
        communeName: 'Libreville',
        quartierName: 'Louis',
        createdAt: new Date().toISOString()
      };
      storedUsers.push({ ...defaultUser, password: body.password });
      localStorage.setItem('shine_static_users', JSON.stringify(storedUsers));
      const token = 'static_token_' + defaultUser.id;
      setAuthToken(token);
      localStorage.setItem('shine_static_current_user_id', defaultUser.id);
      return { token, user: defaultUser } as unknown as T;
    }
    const token = 'static_token_' + found.id;
    setAuthToken(token);
    localStorage.setItem('shine_static_current_user_id', found.id);
    const { password: _, ...user } = found;
    return { token, user } as unknown as T;
  }

  if (url === '/api/auth/me') {
    const currentId = localStorage.getItem('shine_static_current_user_id');
    const found = storedUsers.find((u: any) => u.id === currentId) || storedUsers[0];
    if (found) {
      const { password: _, ...user } = found;
      return { user } as unknown as T;
    }
    throw new Error('Non authentifié');
  }

  if (url === '/api/orders' && method === 'POST') {
    const newOrder: any = {
      id: 'ord_' + Date.now(),
      referenceCode: 'SXS-' + Math.floor(1000 + Math.random() * 9000),
      clientName: body.clientName || 'Client',
      clientPhone: body.clientPhone || '+241 07 00 00 00',
      communeId: body.communeId || 'libreville',
      communeName: 'Libreville',
      quartierName: body.quartierName || 'Louis',
      addressDetails: body.addressDetails || 'Quartier résidentiel',
      clientLocation: body.clientLocation || { lat: 0.3901, lng: 9.4536 },
      companyId: body.companyId || 'comp_1',
      companyName: 'Gabon Nettoyage Express',
      selectionMode: body.selectionMode || 'auto',
      status: 'confirmed',
      config: body.config as any,
      beforePhotos: body.beforePhotos as string[] || [],
      referencePriceFcfa: Number(body.referencePriceFcfa) || 15000,
      extrasPriceFcfa: Number(body.extrasPriceFcfa) || 0,
      travelFeeFcfa: Number(body.travelFeeFcfa) || 1500,
      currentOfferFcfa: Number(body.clientProposedBudgetFcfa) || 15000,
      priceLocked: true,
      finalLockedPriceFcfa: Number(body.clientProposedBudgetFcfa) || 15000,
      assignedAgentIds: ['ag_1'],
      gpsActive: false,
      gpsHistory: [],
      distanceRemainingKm: 3.5,
      etaMinutes: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    storedOrders.push(newOrder);
    localStorage.setItem('shine_static_orders', JSON.stringify(storedOrders));
    return newOrder as unknown as T;
  }

  return {} as unknown as T;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch {
    return handleStaticFallback<T>(url, options);
  }

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (text.trim().startsWith('<')) {
      // Netlify static fallback interceptor
      return handleStaticFallback<T>(url, options);
    }
    throw new Error('Réponse serveur invalide (JSON attendu).');
  }

  if (!res.ok) {
    throw new Error(data?.error || 'Erreur serveur');
  }
  return data as T;
}

export const api = {
  getBootstrap: () => request<BootstrapPayload>('/api/bootstrap'),
  getMapsConfig: () => request<{ apiKey: string }>('/api/config/maps'),
  resetDemo: () => request<BootstrapPayload>('/api/reset-demo', { method: 'POST' }),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    role: 'client' | 'agent' | 'company';
    communeId: CommuneId;
    quartierName?: string;
    companyName?: string;
    openingDays?: DayOfWeekKey[];
    openingTime?: string;
    closingTime?: string;
    targetCompanyId?: string;
    specialty?: string;
    scooterTrackerId?: string;
  }) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMe: () => request<ProfileSyncResponse>('/api/auth/me'),

  updateProfile: (payload: ProfileUpdatePayload) =>
    request<ProfileSyncResponse>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminUsers: (filters?: {
    role?: UserRole | 'all';
    status?: AccountStatus | 'all';
    communeId?: CommuneId | 'all';
    q?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.role && filters.role !== 'all') params.set('role', filters.role);
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters?.communeId && filters.communeId !== 'all') params.set('communeId', filters.communeId);
    if (filters?.q?.trim()) params.set('q', filters.q.trim());
    const qs = params.toString();
    return request<{ users: RegisteredUser[] }>(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  updateUserStatus: (userId: string, status: AccountStatus) =>
    request<{ user: RegisteredUser }>(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  createOrder: (payload: Record<string, unknown>) =>
    request<Order>('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),

  negotiateOrder: (
    orderId: string,
    payload: {
      actor: 'client' | 'company';
      action: 'accept' | 'counter_offer' | 'hold_reference' | 'client_offer' | 'reject';
      amountFcfa?: number;
      note?: string;
    }
  ) =>
    request<Order>(`/api/orders/${orderId}/negotiate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  assignAgents: (orderId: string, agentIds: string[]) =>
    request<Order>(`/api/orders/${orderId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentIds }),
    }),

  agentAction: (
    orderId: string,
    payload: {
      action: 'depart' | 'arrive' | 'start_work' | 'complete' | 'report_issue';
      note?: string;
      afterPhotos?: string[];
    }
  ) =>
    request<Order>(`/api/orders/${orderId}/agent-action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateGps: (
    orderId: string,
    payload: {
      lat?: number;
      lng?: number;
      source?: 'agent_app' | 'scooter_tracker';
      stepTowardClient?: number;
      accuracyMeters?: number;
      speedKmh?: number;
      backgroundMode?: ForegroundSyncMode;
      permissionMode?: LocationPermissionMode;
      capturedAt?: string;
    }
  ) =>
    request<Order>(`/api/orders/${orderId}/gps`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAgentLocationPermission: (agentId: string, permissionMode: LocationPermissionMode) =>
    request<{ agent: Agent }>(`/api/agents/${agentId}/location-permission`, {
      method: 'POST',
      body: JSON.stringify({ permissionMode }),
    }),

  sendAgentGpsHeartbeat: (
    agentId: string,
    payload: {
      lat?: number;
      lng?: number;
      accuracyMeters?: number;
      speedKmh?: number;
      backgroundMode?: ForegroundSyncMode;
      permissionMode?: LocationPermissionMode;
      orderId?: string;
      capturedAt?: string;
    }
  ) =>
    request<{ agent: Agent; order: Order | null }>(`/api/agents/${agentId}/gps-heartbeat`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  addPhotos: (orderId: string, type: 'before' | 'after', photos: string[]) =>
    request<Order>(`/api/orders/${orderId}/photos`, {
      method: 'POST',
      body: JSON.stringify({ type, photos }),
    }),

  sendMessage: (
    orderId: string,
    payload: {
      senderRole: 'client' | 'company' | 'agent';
      senderName: string;
      text: string;
      photoDataUrl?: string;
    }
  ) =>
    request<Order>(`/api/orders/${orderId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  confirmCompletion: (orderId: string) =>
    request<Order>(`/api/orders/${orderId}/confirm-completion`, { method: 'POST' }),

  payOrder: (
    orderId: string,
    payload: { method: PaymentRecord['method']; phoneOrRef?: string }
  ) =>
    request<Order>(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reviewOrder: (orderId: string, payload: { rating: number; comment: string }) =>
    request<Order>(`/api/orders/${orderId}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  openDispute: (orderId: string, payload: { reason: string; details: string }) =>
    request<{ order: Order }>(`/api/orders/${orderId}/dispute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCompanyStatus: (companyId: string, status: CompanyApprovalStatus) =>
    request(`/api/admin/companies/${companyId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  updateTariff: (payload: { tariffId?: string; basePriceFcfa?: number; commissionRate?: number }) =>
    request('/api/admin/tariffs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  addQuartier: (
    communeId: CommuneId,
    payload: { name: string; lat?: number; lng?: number }
  ) =>
    request<{ commune: Commune; quartier: Quartier }>(
      `/api/admin/communes/${communeId}/quartiers`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  resolveDispute: (
    disputeId: string,
    payload: { resolution: 'resolved_refund' | 'resolved_warning' | 'dismissed'; adminNotes?: string }
  ) =>
    request(`/api/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendBroadcast: (payload: {
    title: string;
    body: string;
    audience: 'all' | 'clients' | 'providers';
    communeId: string;
  }) =>
    request('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  markNotificationRead: (notificationId: string) =>
    request(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
    }),
};
