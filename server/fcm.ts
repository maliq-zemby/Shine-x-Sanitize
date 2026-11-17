import type { Agent, CommuneId, Company, FcmDispatchLog } from '../src/types.ts';

export type BroadcastAudience = 'all' | 'clients' | 'providers';

export function buildFcmCondition(
  audience: BroadcastAudience,
  communeId: CommuneId | 'all'
): string {
  const roleExpr =
    audience === 'clients'
      ? "'role_client' in topics"
      : audience === 'providers'
      ? "('role_company' in topics || 'role_agent' in topics)"
      : "('role_client' in topics || 'role_company' in topics || 'role_agent' in topics)";

  if (communeId === 'all') {
    return roleExpr;
  }
  return `'commune_${communeId}' in topics && ${roleExpr}`;
}

export function buildNewOrderProviderCondition(communeId: CommuneId): string {
  return `'commune_${communeId}' in topics && ('role_company' in topics || 'role_agent' in topics)`;
}

export function buildNewRegistrationCompaniesCondition(): string {
  return `'role_company' in topics`;
}

export function resolveEligibleProvidersForOrder(
  companies: Company[],
  agents: Agent[],
  communeId: CommuneId,
  requiredAgents: number
): {
  eligibleCompanies: Company[];
  eligibleAgents: Agent[];
} {
  const eligibleCompanies = companies.filter((c) => {
    if (c.approvalStatus !== 'approved') return false;
    if (!c.communes.includes(communeId)) return false;
    const availCount = agents.filter(
      (a) => a.companyId === c.id && a.status === 'available'
    ).length;
    return availCount >= requiredAgents;
  });

  const eligibleCompanyIds = new Set(eligibleCompanies.map((c) => c.id));
  const eligibleAgents = agents.filter(
    (a) => eligibleCompanyIds.has(a.companyId) && a.status === 'available'
  );

  return { eligibleCompanies, eligibleAgents };
}

export async function dispatchFcmSegmentedMessage(params: {
  kind: 'targeted_order' | 'admin_broadcast' | 'new_registration';
  condition: string;
  title: string;
  body: string;
  data: Record<string, string>;
  recipientCount: number;
  targetSummary: string;
}): Promise<FcmDispatchLog> {
  const logEntry: FcmDispatchLog = {
    id: `fcm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: params.kind,
    condition: params.condition,
    title: params.title,
    body: params.body,
    data: params.data,
    recipientCount: params.recipientCount,
    targetSummary: params.targetSummary,
    deliveryMode: 'simulated_local',
    createdAt: new Date().toISOString(),
  };

  // Optional real FCM HTTP v1 delivery when OAuth access token + project ID are configured
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const accessToken = process.env.FCM_SERVER_OAUTH_TOKEN;
  if (projectId && accessToken) {
    try {
      const fcmRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              condition: params.condition,
              notification: {
                title: params.title,
                body: params.body,
              },
              data: params.data,
            },
          }),
        }
      );
      if (fcmRes.ok) {
        logEntry.deliveryMode = 'fcm_http_v1';
      }
    } catch {
      // Keeps simulated_local fallback cleanly without breaking order creation
    }
  }

  return logEntry;
}
