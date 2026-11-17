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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });
  const data = await res.json();
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
