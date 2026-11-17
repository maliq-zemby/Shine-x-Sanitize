import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  hashPassword,
  sanitizeUser,
  signJwt,
  verifyJwt,
  verifyPassword,
  type StoredUser,
} from './server/auth.ts';
import {
  buildFcmCondition,
  buildNewOrderProviderCondition,
  buildNewRegistrationCompaniesCondition,
  dispatchFcmSegmentedMessage,
  type BroadcastAudience,
} from './server/fcm.ts';
import { estimateEtaMin, MASTER_ADMIN_EMAIL, store } from './server/store.ts';
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_DAYS,
  DEFAULT_OPENING_TIME,
  formatCompanyWorkingHours,
  normalizeOpeningDays,
  parseTimeMinutes,
  validateBookingSlotForCompany,
} from './src/lib/schedule.ts';
import type {
  AccountStatus,
  Agent,
  BroadcastRecord,
  CommuneId,
  Company,
  CompanyApprovalStatus,
  DayOfWeekKey,
  DisputeRecord,
  ForegroundSyncMode,
  LocationPermissionMode,
  NotificationItem,
  Order,
  PaymentRecord,
  UserRole,
} from './src/types.ts';

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function addNotification(
  orderId: string,
  targetRole: NotificationItem['targetRole'],
  title: string,
  body: string,
  extra?: Partial<NotificationItem>
) {
  const state = store.getState();
  state.notifications.unshift({
    id: uid('notif'),
    orderId,
    targetRole,
    kind: extra?.kind || 'order_update',
    communeId: extra?.communeId,
    targetCompanyIds: extra?.targetCompanyIds,
    targetAgentIds: extra?.targetAgentIds,
    title,
    body,
    read: false,
    createdAt: new Date().toISOString(),
  });
  if (state.notifications.length > 80) {
    state.notifications = state.notifications.slice(0, 80);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '18mb' }));

  const sseClients = new Set<express.Response>();

  const broadcastUpdate = () => {
    const payload = `data: ${JSON.stringify({ ts: Date.now() })}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  };

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');
    sseClients.add(res);
    const keepaliveTimer = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepaliveTimer);
        sseClients.delete(res);
      }
    }, 15000);
    req.on('close', () => {
      clearInterval(keepaliveTimer);
      sseClients.delete(res);
    });
  });

  app.get('/api/config/maps', (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({ apiKey });
  });

  function publicBootstrapState() {
    const { users: _omitUsers, ...publicState } = store.getState();
    return publicState;
  }

  function extractBearerUser(req: express.Request): StoredUser | null {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const claims = verifyJwt(token);
    if (!claims) return null;
    return store.getState().users.find((u) => u.id === claims.sub) || null;
  }

  const requireValidatedAdmin: express.RequestHandler = (req, res, next) => {
    const user = extractBearerUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise pour accéder à l’administration.' });
    }
    if (
      user.role !== 'admin' ||
      user.status !== 'active' ||
      user.email.toLowerCase() !== MASTER_ADMIN_EMAIL
    ) {
      return res.status(403).json({
        error: 'Accès refusé : cet espace est réservé exclusivement au compte Administrateur Principal.',
      });
    }
    next();
  };

  app.get('/api/bootstrap', (_req, res) => {
    res.json(publicBootstrapState());
  });

  app.post('/api/reset-demo', requireValidatedAdmin, (_req, res) => {
    store.resetDemo();
    broadcastUpdate();
    res.json(publicBootstrapState());
  });

  // 0. Authentication & Onboarding Registration (Node.js scrypt + JWT)
  app.post('/api/auth/register', async (req, res) => {
    const state = store.getState();
    const {
      name,
      email,
      password,
      phone,
      role,
      communeId,
      quartierName,
      companyName,
      openingDays,
      openingTime,
      closingTime,
      targetCompanyId,
      specialty,
      scooterTrackerId,
    } = req.body as {
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
    };

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanName = (name || '').trim();
    if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Nom complet et adresse email valide requis.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
    if (!['client', 'agent', 'company'].includes(role)) {
      return res.status(400).json({ error: 'Rôle d’inscription invalide.' });
    }
    if (state.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse email.' });
    }

    let validatedOpeningDays = DEFAULT_OPENING_DAYS;
    let validatedOpeningTime = DEFAULT_OPENING_TIME;
    let validatedClosingTime = DEFAULT_CLOSING_TIME;

    if (role === 'company') {
      if (!(companyName || '').trim()) {
        return res.status(400).json({ error: 'Le nom commercial de l’entreprise est requis.' });
      }
      const normDays = normalizeOpeningDays(openingDays);
      if (normDays.length === 0) {
        return res.status(400).json({
          error: 'Veuillez sélectionner au moins un jour d’ouverture pour votre entreprise.',
        });
      }
      const openMin = parseTimeMinutes(openingTime);
      const closeMin = parseTimeMinutes(closingTime);
      if (openMin === null || closeMin === null) {
        return res.status(400).json({
          error: 'Les heures d’ouverture et de fermeture (format HH:MM) sont obligatoires.',
        });
      }
      if (openMin >= closeMin) {
        return res.status(400).json({
          error: 'L’heure de fermeture doit être postérieure à l’heure d’ouverture.',
        });
      }
      validatedOpeningDays = normDays;
      validatedOpeningTime = openingTime!.trim();
      validatedClosingTime = closingTime!.trim();
    }

    const commune = state.communes.find((c) => c.id === communeId) || state.communes[0];
    const nowIso = new Date().toISOString();
    const initialStatus: AccountStatus = role === 'client' ? 'active' : 'pending';

    let linkedCompanyId: string | undefined;
    let linkedCompanyName: string | undefined;
    let linkedAgentId: string | undefined;

    if (role === 'company') {
      const compTitle = (companyName || '').trim();
      const compId = uid('comp');
      const initials = compTitle
        .split(/\s+/)
        .map((w) => w[0] || '')
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'KS';
      const formattedSchedule = formatCompanyWorkingHours(
        validatedOpeningDays,
        validatedOpeningTime,
        validatedClosingTime
      );
      const newCompany: Company = {
        id: compId,
        name: compTitle,
        initials,
        description: `Entreprise partenaire inscrite à ${commune.name} (en attente de validation administrative).`,
        communes: [commune.id],
        baseLocation: commune.center,
        address: `${quartierName || commune.quartiers[0]?.name || ''}, ${commune.name}`,
        phone: (phone || '').trim() || '+241 07 00 00 00',
        approvalStatus: 'pending',
        verified: false,
        rating: 0,
        reviewCount: 0,
        completedInterventions: 0,
        estimatedArrivalMin: 25,
        equipment: ['Injecteur-extracteur professionnel', 'Produits biodégradables'],
        methodsSupported: ['Nettoyage par injection-extraction', 'Détachage ciblé'],
        categoriesSupported: ['canape', 'fauteuil', 'tapis', 'matelas', 'vehicule'],
        openingDays: validatedOpeningDays,
        openingTime: validatedOpeningTime,
        closingTime: validatedClosingTime,
        workingHours: formattedSchedule,
        galleryKeys: ['sofa', 'hero'],
        reviews: [],
      };
      state.companies.unshift(newCompany);
      linkedCompanyId = compId;
      linkedCompanyName = compTitle;
    } else if (role === 'agent') {
      const parentCompany =
        state.companies.find((c) => c.id === targetCompanyId) || state.companies[0];
      const agId = uid('ag');
      const newAgent: Agent = {
        id: agId,
        companyId: parentCompany?.id || '',
        name: cleanName,
        phone: (phone || '').trim() || '+241 07 00 00 00',
        specialty: (specialty || '').trim() || 'Nettoyage textile & vapeur',
        scooterTrackerId: (scooterTrackerId || '').trim() || `TR-${commune.id.slice(0, 3).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`,
        status: 'offline',
        currentLocation: commune.center,
        completedJobs: 0,
        rating: 5.0,
      };
      state.agents.push(newAgent);
      linkedAgentId = agId;
      linkedCompanyId = parentCompany?.id;
      linkedCompanyName = parentCompany?.name;
    }

    const newUser: StoredUser = {
      id: uid('usr'),
      name: cleanName,
      email: cleanEmail,
      phone: (phone || '').trim() || undefined,
      role,
      communeId: commune.id,
      communeName: commune.name,
      quartierName: quartierName || commune.quartiers[0]?.name,
      status: initialStatus,
      createdAt: nowIso,
      lastLoginAt: nowIso,
      companyId: linkedCompanyId,
      companyName: linkedCompanyName,
      agentId: linkedAgentId,
      specialty: (specialty || '').trim() || undefined,
      scooterTrackerId: (scooterTrackerId || '').trim() || undefined,
      agentStatus: role === 'agent' ? 'offline' : undefined,
      updatedAt: nowIso,
      preferences: {
        notificationsEnabled: true,
        smsUpdatesEnabled: true,
        preferredPaymentMethod: 'airtel_money',
        lastActiveView: role === 'company' || role === 'agent' ? 'pro' : 'home',
        lastProTab: role === 'agent' ? 'agent' : 'company',
      },
      passwordHash: hashPassword(password),
    };

    state.users.unshift(newUser);

    // 2. Trigger Notification de Nouvelle Inscription pour TOUTES les Entreprises
    const roleLabel =
      role === 'company' ? 'Entreprise' : role === 'agent' ? 'Agent' : 'Client';
    const displaySubject =
      role === 'company' && linkedCompanyName ? `${linkedCompanyName} (${cleanName})` : cleanName;
    const regTitle = `Nouvelle inscription · ${roleLabel} (${commune.name})`;
    const regBody = `Nouvelle inscription sur la plateforme : ${displaySubject} / ${roleLabel}. Découvrez les nouveaux profils ou clients potentiels.`;

    const allCompanyIds = state.companies.map((c) => c.id);
    addNotification('registration', 'company', regTitle, regBody, {
      kind: 'new_registration',
      communeId: commune.id,
      targetCompanyIds: allCompanyIds,
    });

    const fcmLog = await dispatchFcmSegmentedMessage({
      kind: 'new_registration',
      condition: buildNewRegistrationCompaniesCondition(),
      title: regTitle,
      body: regBody,
      data: {
        userId: newUser.id,
        role: newUser.role,
        communeId: commune.id,
      },
      recipientCount: allCompanyIds.length,
      targetSummary: `Toutes les entreprises (${allCompanyIds.length} compte(s) Entreprise)`,
    });
    state.fcmLogs.unshift(fcmLog);
    if (state.fcmLogs.length > 50) state.fcmLogs = state.fcmLogs.slice(0, 50);

    store.save();
    broadcastUpdate();

    const safeUser = sanitizeUser(newUser);
    const linkedCompany = safeUser.companyId
      ? state.companies.find((c) => c.id === safeUser.companyId)
      : undefined;
    const linkedAgent = safeUser.agentId
      ? state.agents.find((a) => a.id === safeUser.agentId)
      : undefined;
    const token = signJwt(safeUser);
    res.status(201).json({ token, user: safeUser, company: linkedCompany, agent: linkedAgent });
  });

  app.post('/api/auth/login', (req, res) => {
    const state = store.getState();
    const { email, password } = req.body as { email: string; password: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const user = state.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Identifiants invalides (email ou mot de passe incorrect).' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({
        error: 'Ce compte a été suspendu par l’administration centrale.',
      });
    }

    user.lastLoginAt = new Date().toISOString();
    store.save();

    const safeUser = sanitizeUser(user);
    const linkedCompany = safeUser.companyId
      ? state.companies.find((c) => c.id === safeUser.companyId)
      : undefined;
    const linkedAgent = safeUser.agentId
      ? state.agents.find((a) => a.id === safeUser.agentId)
      : undefined;
    const token = signJwt(safeUser);
    res.json({ token, user: safeUser, company: linkedCompany, agent: linkedAgent });
  });

  app.get('/api/auth/me', (req, res) => {
    const state = store.getState();
    const user = extractBearerUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Compte suspendu.' });
    }
    const safeUser = sanitizeUser(user);
    const company = safeUser.companyId
      ? state.companies.find((c) => c.id === safeUser.companyId)
      : undefined;
    const agent = safeUser.agentId
      ? state.agents.find((a) => a.id === safeUser.agentId)
      : undefined;
    if (agent) {
      safeUser.agentStatus = agent.status;
    }
    res.json({ user: safeUser, company, agent });
  });

  const handleProfileUpdate = (req: express.Request, res: express.Response) => {
    const state = store.getState();
    const user = extractBearerUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise pour sauvegarder le profil.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Compte suspendu.' });
    }

    const body = (req.body || {}) as {
      name?: string;
      phone?: string;
      communeId?: CommuneId;
      quartierName?: string;
      companyName?: string;
      companyDescription?: string;
      companyWorkingHours?: string;
      openingDays?: DayOfWeekKey[];
      openingTime?: string;
      closingTime?: string;
      companyCommunes?: CommuneId[];
      specialty?: string;
      scooterTrackerId?: string;
      agentStatus?: 'available' | 'en_route' | 'busy' | 'offline';
      preferences?: Record<string, unknown>;
    };

    const nowIso = new Date().toISOString();

    if (typeof body.name === 'string' && body.name.trim()) {
      user.name = body.name.trim();
    }
    if (typeof body.phone === 'string') {
      user.phone = body.phone.trim() || undefined;
    }
    if (body.communeId) {
      const targetCommune = state.communes.find((c) => c.id === body.communeId);
      if (targetCommune) {
        user.communeId = targetCommune.id;
        user.communeName = targetCommune.name;
      }
    }
    if (typeof body.quartierName === 'string' && body.quartierName.trim()) {
      user.quartierName = body.quartierName.trim();
    }

    if (body.preferences && typeof body.preferences === 'object') {
      user.preferences = {
        ...(user.preferences || {}),
        ...body.preferences,
      };
    }

    let linkedCompany = user.companyId
      ? state.companies.find((c) => c.id === user.companyId)
      : undefined;
    let linkedAgent = user.agentId
      ? state.agents.find((a) => a.id === user.agentId)
      : undefined;

    if (user.role === 'company' && linkedCompany) {
      if (typeof body.companyName === 'string' && body.companyName.trim()) {
        const nextCompName = body.companyName.trim();
        linkedCompany.name = nextCompName;
        linkedCompany.initials = nextCompName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() || '')
          .join('');
        user.companyName = nextCompName;
      }
      if (typeof body.companyDescription === 'string' && body.companyDescription.trim()) {
        linkedCompany.description = body.companyDescription.trim();
      }
      if (body.openingDays !== undefined || body.openingTime !== undefined || body.closingTime !== undefined) {
        const nextDays =
          body.openingDays !== undefined
            ? normalizeOpeningDays(body.openingDays)
            : normalizeOpeningDays(linkedCompany.openingDays);
        const finalDays = nextDays.length > 0 ? nextDays : DEFAULT_OPENING_DAYS;
        const nextOpen = (body.openingTime ?? linkedCompany.openingTime ?? DEFAULT_OPENING_TIME).trim();
        const nextClose = (body.closingTime ?? linkedCompany.closingTime ?? DEFAULT_CLOSING_TIME).trim();
        const openMin = parseTimeMinutes(nextOpen);
        const closeMin = parseTimeMinutes(nextClose);
        if (openMin === null || closeMin === null || openMin >= closeMin) {
          return res.status(400).json({
            error: 'Plage horaire invalide : l’heure de fermeture doit être postérieure à l’ouverture.',
          });
        }
        linkedCompany.openingDays = finalDays;
        linkedCompany.openingTime = nextOpen;
        linkedCompany.closingTime = nextClose;
        linkedCompany.workingHours = formatCompanyWorkingHours(finalDays, nextOpen, nextClose);
      } else if (typeof body.companyWorkingHours === 'string' && body.companyWorkingHours.trim()) {
        linkedCompany.workingHours = body.companyWorkingHours.trim();
      }
      if (typeof body.phone === 'string' && body.phone.trim()) {
        linkedCompany.phone = body.phone.trim();
      }
      if (Array.isArray(body.companyCommunes) && body.companyCommunes.length > 0) {
        const validCommunes = body.companyCommunes.filter((cid) =>
          state.communes.some((c) => c.id === cid)
        );
        if (validCommunes.length > 0) {
          linkedCompany.communes = validCommunes;
        }
      }
    }

    if (user.role === 'agent' && linkedAgent) {
      if (typeof body.name === 'string' && body.name.trim()) {
        linkedAgent.name = body.name.trim();
      }
      if (typeof body.phone === 'string' && body.phone.trim()) {
        linkedAgent.phone = body.phone.trim();
      }
      if (typeof body.specialty === 'string' && body.specialty.trim()) {
        linkedAgent.specialty = body.specialty.trim();
        user.specialty = body.specialty.trim();
      }
      if (typeof body.scooterTrackerId === 'string' && body.scooterTrackerId.trim()) {
        linkedAgent.scooterTrackerId = body.scooterTrackerId.trim();
        user.scooterTrackerId = body.scooterTrackerId.trim();
      }
      if (
        body.agentStatus &&
        ['available', 'en_route', 'busy', 'offline'].includes(body.agentStatus)
      ) {
        linkedAgent.status = body.agentStatus;
        user.agentStatus = body.agentStatus;
      }
    }

    user.updatedAt = nowIso;
    store.save();
    broadcastUpdate();

    const safeUser = sanitizeUser(user);
    if (linkedAgent) {
      safeUser.agentStatus = linkedAgent.status;
    }
    res.json({ user: safeUser, company: linkedCompany, agent: linkedAgent });
  };

  app.patch('/api/profile', handleProfileUpdate);
  app.put('/api/profile', handleProfileUpdate);

  // 1. Create Order from Configurator (Async for segmented FCM dispatch)
  app.post('/api/orders', async (req, res) => {
    const state = store.getState();
    const {
      clientName,
      clientPhone,
      communeId,
      quartierName,
      addressDetails,
      clientLocation,
      companyId,
      selectionMode: requestedSelectionMode,
      config,
      beforePhotos,
      beforeVideoName,
      referencePriceFcfa,
      extrasPriceFcfa,
      travelFeeFcfa,
      clientProposedBudgetFcfa,
    } = req.body;

    const commune = state.communes.find((c) => c.id === communeId);
    if (!commune) {
      return res.status(400).json({ error: 'Commune invalide.' });
    }

    const rawAgentCount = config?.agentCount !== undefined ? Number(config.agentCount) : 1;
    if (!Number.isInteger(rawAgentCount) || rawAgentCount < 1 || rawAgentCount > 10) {
      return res.status(400).json({ error: 'Le nombre d’agents doit être compris entre 1 et 10.' });
    }
    const requiredAgents = rawAgentCount;
    const requestedCategory = config?.categoryId;
    const effectiveLoc =
      clientLocation && typeof clientLocation.lat === 'number' && typeof clientLocation.lng === 'number'
        ? clientLocation
        : commune.center;

    const isAutoMode = !companyId || companyId === 'auto' || requestedSelectionMode === 'auto';
    let company: Company | undefined;

    if (isAutoMode) {
      const candidates = state.companies
        .filter((c) => {
          if (c.approvalStatus !== 'approved') return false;
          if (!c.communes.includes(commune.id)) return false;
          if (requestedCategory && !c.categoriesSupported.includes(requestedCategory)) return false;
          const slotCheck = validateBookingSlotForCompany(
            c,
            config?.scheduledDate || '',
            config?.scheduledTime || ''
          );
          if (!slotCheck.valid) return false;
          const freeCount = state.agents.filter(
            (a) => a.companyId === c.id && a.status === 'available'
          ).length;
          return freeCount >= requiredAgents;
        })
        .sort((a, b) => {
          const distA = haversineKm(a.baseLocation, effectiveLoc);
          const distB = haversineKm(b.baseLocation, effectiveLoc);
          const scoreA = a.rating * 12 - distA * 3;
          const scoreB = b.rating * 12 - distB * 3;
          return scoreB - scoreA;
        });

      company = candidates[0];
      if (!company) {
        return res.status(400).json({
          error:
            'Aucune entreprise validée et ouverte n’est disponible pour ce créneau et cette zone.',
        });
      }
    } else {
      company = state.companies.find((c) => c.id === companyId);
      if (!company || company.approvalStatus !== 'approved') {
        return res
          .status(400)
          .json({ error: 'Entreprise introuvable ou non validée par l’administration.' });
      }
      if (!company.communes.includes(commune.id)) {
        return res.status(400).json({
          error: `${company.name} n’intervient pas dans la commune de ${commune.name}.`,
        });
      }
      if (requestedCategory && !company.categoriesSupported.includes(requestedCategory)) {
        return res.status(400).json({
          error: `${company.name} ne propose pas la prestation demandée.`,
        });
      }
      const slotCheck = validateBookingSlotForCompany(
        company,
        config?.scheduledDate || '',
        config?.scheduledTime || ''
      );
      if (!slotCheck.valid) {
        return res.status(400).json({ error: slotCheck.reason });
      }
    }

    const availableAgents = state.agents.filter(
      (a) => a.companyId === company!.id && a.status === 'available'
    );
    if (availableAgents.length < requiredAgents) {
      return res.status(400).json({
        error: `Capacité insuffisante : ${company.name} dispose actuellement de ${availableAgents.length} agent(s) disponible(s).`,
      });
    }

    const nowIso = new Date().toISOString();
    const totalReference = Number(referencePriceFcfa) + Number(extrasPriceFcfa) + Number(travelFeeFcfa);
    const proposed = Number(clientProposedBudgetFcfa) || totalReference;
    const isExactMatch = proposed >= totalReference;

    const orderNumber = 103 + state.orders.length;
    const order: Order = {
      id: uid('ord'),
      referenceCode: `KM-2026-${orderNumber}`,
      clientName: clientName || 'Client Libreville',
      clientPhone: clientPhone || '+241 07 00 00 00',
      communeId: commune.id,
      communeName: commune.name,
      quartierName: quartierName || commune.quartiers[0]?.name || 'Centre',
      addressDetails: addressDetails || 'Adresse précisée par le client',
      clientLocation: effectiveLoc,
      companyId: company.id,
      companyName: company.name,
      selectionMode: isAutoMode ? 'auto' : 'manual',
      assignedAgentIds: [],
      status: 'pending_company',
      config,
      beforePhotos: Array.isArray(beforePhotos) ? beforePhotos : [],
      beforeVideoName: beforeVideoName || undefined,
      afterPhotos: [],
      referencePriceFcfa: Number(referencePriceFcfa),
      extrasPriceFcfa: Number(extrasPriceFcfa),
      travelFeeFcfa: Number(travelFeeFcfa),
      clientProposedBudgetFcfa: proposed,
      currentOfferFcfa: proposed,
      finalLockedPriceFcfa: null,
      priceLocked: false,
      negotiationHistory: [
        {
          id: uid('neg'),
          actor: 'system',
          actorName: 'Grille de référence',
          action: 'reference',
          amountFcfa: totalReference,
          note: `Tarif de référence (${referencePriceFcfa} FCFA) + Options (${extrasPriceFcfa} FCFA) + Déplacement (${travelFeeFcfa} FCFA)`,
          timestamp: nowIso,
        },
        {
          id: uid('neg'),
          actor: 'client',
          actorName: clientName || 'Client',
          action: 'client_offer',
          amountFcfa: proposed,
          note: isExactMatch
            ? 'Le client accepte le tarif de référence complet.'
            : 'Budget proposé par le client avant intervention.',
          timestamp: nowIso,
        },
      ],
      gpsActive: false,
      gpsHistory: [],
      etaMinutes: null,
      distanceRemainingKm: null,
      messages: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    state.orders.unshift(order);

    // Direct Targeted Notification ONLY to the Chosen/Assigned Company & its available Agents
    const targetCompanyIds = [company.id];
    const targetAgentIds = availableAgents.map((a) => a.id);

    const catLabelLower = (config?.categoryLabel || 'service').toLowerCase();
    const detailPart = config?.seats
      ? ` (${config.seats} place${config.seats > 1 ? 's' : ''})`
      : config?.surfaceSqm
      ? ` (${config.surfaceSqm} m²)`
      : '';
    const selectionLabel = isAutoMode
      ? 'Assignation automatique'
      : 'Sélection directe client';
    const targetedTitle = `Nouvelle mission (${selectionLabel}) · ${order.quartierName}, ${commune.name}`;
    const targetedBody = `Demande de ${catLabelLower}${detailPart} chez ${order.clientName} (${order.quartierName}, GPS ${effectiveLoc.lat.toFixed(4)}, ${effectiveLoc.lng.toFixed(4)}). Budget : ${proposed.toLocaleString('fr-FR')} FCFA.`;

    addNotification(order.id, 'company', targetedTitle, targetedBody, {
      kind: 'targeted_order',
      communeId: commune.id,
      targetCompanyIds,
      targetAgentIds,
    });
    addNotification(order.id, 'agent', targetedTitle, targetedBody, {
      kind: 'targeted_order',
      communeId: commune.id,
      targetCompanyIds,
      targetAgentIds,
    });
    addNotification(
      order.id,
      'client',
      'Demande transmise au prestataire',
      `${company.name} a reçu votre dossier et votre position GPS pour validation.`,
      { kind: 'order_update', communeId: commune.id }
    );

    const fcmLog = await dispatchFcmSegmentedMessage({
      kind: 'targeted_order',
      condition: buildNewOrderProviderCondition(commune.id),
      title: targetedTitle,
      body: targetedBody,
      data: {
        orderId: order.id,
        referenceCode: order.referenceCode,
        companyId: company.id,
        communeId: commune.id,
        quartier: order.quartierName,
        clientLat: String(effectiveLoc.lat),
        clientLng: String(effectiveLoc.lng),
        budgetFcfa: String(proposed),
      },
      recipientCount: targetCompanyIds.length + targetAgentIds.length,
      targetSummary: `Entreprise ciblée : ${company.name} (${targetAgentIds.length} agent(s) disponible(s))`,
    });
    state.fcmLogs.unshift(fcmLog);
    if (state.fcmLogs.length > 50) state.fcmLogs = state.fcmLogs.slice(0, 50);

    store.save();
    broadcastUpdate();
    res.status(201).json(order);
  });

  // 2. Price Negotiation Workflow (Lock before intervention!)
  app.post('/api/orders/:id/negotiate', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.priceLocked) {
      return res.status(400).json({ error: 'Le prix est déjà verrouillé et ne peut plus être modifié.' });
    }

    const { actor, action, amountFcfa, note } = req.body as {
      actor: 'client' | 'company';
      action: 'accept' | 'counter_offer' | 'hold_reference' | 'client_offer' | 'reject';
      amountFcfa?: number;
      note?: string;
    };

    const nowIso = new Date().toISOString();
    const totalRef = order.referencePriceFcfa + order.extrasPriceFcfa + order.travelFeeFcfa;

    if (actor === 'company') {
      if (action === 'accept') {
        const locked = order.currentOfferFcfa;
        order.finalLockedPriceFcfa = locked;
        order.priceLocked = true;
        order.status = 'confirmed';
        order.negotiationHistory.push({
          id: uid('neg'),
          actor: 'company',
          actorName: order.companyName,
          action: 'locked',
          amountFcfa: locked,
          note: note || 'Le prestataire accepte votre budget. Prix définitif verrouillé.',
          timestamp: nowIso,
        });
        addNotification(
          order.id,
          'client',
          'Votre prix a été accepté',
          `${order.companyName} a validé ${locked.toLocaleString('fr-FR')} FCFA. Réservation confirmée.`
        );
      } else if (action === 'counter_offer' || action === 'hold_reference') {
        const offer =
          action === 'hold_reference' ? totalRef : Math.max(2000, Number(amountFcfa) || totalRef);
        order.currentOfferFcfa = offer;
        order.status = 'negotiating_client_turn';
        order.negotiationHistory.push({
          id: uid('neg'),
          actor: 'company',
          actorName: order.companyName,
          action: action === 'hold_reference' ? 'hold_reference' : 'counter_offer',
          amountFcfa: offer,
          note:
            note ||
            (action === 'hold_reference'
              ? 'Maintien du tarif de référence commun.'
              : `Contre-proposition du prestataire à ${offer.toLocaleString('fr-FR')} FCFA.`),
          timestamp: nowIso,
        });
        addNotification(
          order.id,
          'client',
          'Nouvelle proposition tarifaire',
          `${order.companyName} propose ${offer.toLocaleString('fr-FR')} FCFA pour cette intervention.`
        );
      } else if (action === 'reject') {
        order.status = 'cancelled';
        order.negotiationHistory.push({
          id: uid('neg'),
          actor: 'company',
          actorName: order.companyName,
          action: 'counter_offer',
          amountFcfa: order.currentOfferFcfa,
          note: note || 'Demande refusée par le prestataire.',
          timestamp: nowIso,
        });
        addNotification(
          order.id,
          'client',
          'Demande déclinée',
          `${order.companyName} n’a pas pu retenir votre demande.`
        );
      }
    } else if (actor === 'client') {
      if (action === 'accept') {
        const locked = order.currentOfferFcfa;
        order.finalLockedPriceFcfa = locked;
        order.priceLocked = true;
        order.status = 'confirmed';
        order.negotiationHistory.push({
          id: uid('neg'),
          actor: 'client',
          actorName: order.clientName,
          action: 'locked',
          amountFcfa: locked,
          note: note || 'Le client valide le tarif final. Aucun supplément unilatéral autorisé.',
          timestamp: nowIso,
        });
        addNotification(
          order.id,
          'company',
          'Prix validé & réservation confirmée',
          `${order.clientName} a validé ${locked.toLocaleString('fr-FR')} FCFA (${order.referenceCode}).`
        );
      } else if (action === 'client_offer') {
        const offer = Math.max(2000, Number(amountFcfa) || order.clientProposedBudgetFcfa);
        order.currentOfferFcfa = offer;
        order.status = 'negotiating_company_turn';
        order.negotiationHistory.push({
          id: uid('neg'),
          actor: 'client',
          actorName: order.clientName,
          action: 'client_offer',
          amountFcfa: offer,
          note: note || `Nouvelle proposition client : ${offer.toLocaleString('fr-FR')} FCFA.`,
          timestamp: nowIso,
        });
        addNotification(
          order.id,
          'company',
          'Nouvelle offre client',
          `${order.clientName} propose ${offer.toLocaleString('fr-FR')} FCFA.`
        );
      }
    }

    order.updatedAt = nowIso;
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 3. Assign Agents (validates team availability!)
  app.post('/api/orders/:id/assign', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const { agentIds } = req.body as { agentIds: string[] };
    if (!Array.isArray(agentIds) || agentIds.length < order.config.agentCount) {
      return res.status(400).json({
        error: `Cette prestation nécessite ${order.config.agentCount} agent(s).`,
      });
    }

    const companyAgents = state.agents.filter(
      (a) => a.companyId === order.companyId && agentIds.includes(a.id)
    );
    if (companyAgents.length !== agentIds.length) {
      return res.status(400).json({ error: 'Agents invalides pour cette entreprise.' });
    }

    order.assignedAgentIds = agentIds;
    order.updatedAt = new Date().toISOString();

    addNotification(
      order.id,
      'client',
      'Équipe affectée à votre intervention',
      `${companyAgents.map((a) => a.name).join(', ')} interviendront sur votre commande ${order.referenceCode}.`
    );
    addNotification(
      order.id,
      'agent',
      `Nouvelle mission affectée · ${order.referenceCode}`,
      `Intervention chez ${order.clientName} (${order.quartierName}, ${order.communeName}).`
    );

    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 4. Agent Field Workflow Actions (Depart -> Arrive -> Start -> Complete)
  app.post('/api/orders/:id/agent-action', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (!order.priceLocked) {
      return res.status(400).json({ error: 'Le prix doit être verrouillé avant le départ de l’équipe.' });
    }

    const { action, note, afterPhotos } = req.body as {
      action: 'depart' | 'arrive' | 'start_work' | 'complete' | 'report_issue';
      note?: string;
      afterPhotos?: string[];
    };

    const nowIso = new Date().toISOString();
    const assigned = state.agents.filter((a) => order.assignedAgentIds.includes(a.id));

    if (action === 'depart') {
      if (assigned.length === 0) {
        return res.status(400).json({ error: 'Veuillez d’abord affecter au moins un agent à la mission.' });
      }
      order.status = 'en_route';
      order.gpsActive = true;
      order.startedTravelAt = nowIso;
      order.lastGpsSyncAt = nowIso;
      assigned.forEach((a) => {
        a.status = 'en_route';
        a.backgroundServiceActive = true;
        a.lastGpsSyncAt = nowIso;
        a.syncIntervalSeconds = 6;
      });
      const lead = assigned[0];
      const dist = Number(haversineKm(lead.currentLocation, order.clientLocation).toFixed(2));
      order.distanceRemainingKm = dist;
      order.etaMinutes = estimateEtaMin(dist);
      order.gpsHistory.push({
        lat: lead.currentLocation.lat,
        lng: lead.currentLocation.lng,
        timestamp: nowIso,
        source: 'agent_app',
      });
      addNotification(
        order.id,
        'client',
        'Votre équipe est en route',
        `${assigned.map((a) => a.name).join(', ')} sont en déplacement. Arrivée estimée : ${order.etaMinutes} min.`
      );
    } else if (action === 'arrive') {
      order.status = 'arrived';
      order.gpsActive = false; // Clôture du suivi GPS en temps réel à l'arrivée sur place
      order.arrivedAt = nowIso;
      order.lastGpsSyncAt = nowIso;
      order.distanceRemainingKm = 0;
      order.etaMinutes = 0;
      assigned.forEach((a) => {
        a.currentLocation = { ...order.clientLocation };
        a.backgroundServiceActive = false;
        a.lastGpsSyncAt = nowIso;
      });
      order.gpsHistory.push({
        lat: order.clientLocation.lat,
        lng: order.clientLocation.lng,
        timestamp: nowIso,
        source: 'agent_app',
      });
      addNotification(
        order.id,
        'client',
        'Votre équipe est arrivée',
        `L’équipe ${order.companyName} est arrivée à votre adresse (${order.quartierName}).`
      );
    } else if (action === 'start_work') {
      order.status = 'in_progress';
      order.gpsActive = false;
      order.startedWorkAt = nowIso;
      assigned.forEach((a) => {
        a.status = 'busy';
        a.backgroundServiceActive = false;
      });
      addNotification(
        order.id,
        'client',
        'Votre intervention a commencé',
        `Le traitement a démarré selon le cahier des charges validé.`
      );
    } else if (action === 'complete') {
      if (Array.isArray(afterPhotos) && afterPhotos.length > 0) {
        order.afterPhotos = [...order.afterPhotos, ...afterPhotos];
      }
      order.status = 'awaiting_client_validation';
      order.completedWorkAt = nowIso;
      order.gpsActive = false; // Privacy rule: GPS sharing stops once intervention work ends
      assigned.forEach((a) => {
        a.status = 'available';
        a.backgroundServiceActive = false;
        a.completedJobs += 1;
      });
      addNotification(
        order.id,
        'client',
        'Votre prestation est terminée',
        `Consultez les photos après intervention et confirmez la fin de la prestation pour régler.`
      );
    } else if (action === 'report_issue') {
      order.issueReport = note || 'Incident terrain signalé par l’agent.';
      order.messages.push({
        id: uid('msg'),
        senderRole: 'agent',
        senderName: assigned[0]?.name || 'Agent terrain',
        text: `Signalement terrain : ${order.issueReport}`,
        timestamp: nowIso,
      });
      addNotification(
        order.id,
        'admin',
        `Signalement agent · ${order.referenceCode}`,
        order.issueReport
      );
    }

    order.updatedAt = nowIso;
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 5. Periodic GPS Coordinate Update (Foreground Service 6s Sync + Scooter Tracker)
  app.post('/api/orders/:id/gps', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (!order.gpsActive) {
      return res.status(400).json({ error: 'Partage GPS inactif pour cette commande.' });
    }

    const {
      lat,
      lng,
      source,
      stepTowardClient,
      accuracyMeters,
      speedKmh,
      backgroundMode,
      permissionMode,
      capturedAt,
    } = req.body as {
      lat?: number;
      lng?: number;
      source?: 'agent_app' | 'scooter_tracker';
      stepTowardClient?: number;
      accuracyMeters?: number;
      speedKmh?: number;
      backgroundMode?: ForegroundSyncMode;
      permissionMode?: LocationPermissionMode;
      capturedAt?: string;
    };

    const assigned = state.agents.filter((a) => order.assignedAgentIds.includes(a.id));
    if (assigned.length === 0) return res.status(400).json({ error: 'Aucun agent affecté.' });

    const nowIso = new Date().toISOString();
    const pointIso =
      typeof capturedAt === 'string' && !Number.isNaN(Date.parse(capturedAt))
        ? capturedAt
        : nowIso;
    const lead = assigned[0];
    let nextLat = typeof lat === 'number' && Number.isFinite(lat) ? lat : lead.currentLocation.lat;
    let nextLng = typeof lng === 'number' && Number.isFinite(lng) ? lng : lead.currentLocation.lng;

    if (typeof stepTowardClient === 'number') {
      const ratio = Math.min(1, Math.max(0.05, stepTowardClient));
      nextLat = lead.currentLocation.lat + (order.clientLocation.lat - lead.currentLocation.lat) * ratio;
      nextLng = lead.currentLocation.lng + (order.clientLocation.lng - lead.currentLocation.lng) * ratio;
    }

    const isLatestFix =
      !order.lastGpsSyncAt || Date.parse(pointIso) >= Date.parse(order.lastGpsSyncAt);

    if (isLatestFix) {
      assigned.forEach((a) => {
        a.currentLocation = { lat: nextLat, lng: nextLng };
        a.lastGpsSyncAt = pointIso;
        a.backgroundServiceActive = true;
        a.syncIntervalSeconds = 6;
        if (typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)) {
          a.gpsAccuracyMeters = Math.round(accuracyMeters);
        }
        if (permissionMode && ['always_allow', 'when_in_use', 'prompt', 'denied'].includes(permissionMode)) {
          a.locationPermissionMode = permissionMode;
        }
      });
    }

    const dist = Number(haversineKm({ lat: nextLat, lng: nextLng }, order.clientLocation).toFixed(2));
    const eta = dist <= 0.08 ? 0 : estimateEtaMin(dist);

    if (isLatestFix) {
      order.distanceRemainingKm = dist;
      order.etaMinutes = eta;
      order.lastGpsSyncAt = pointIso;
    }
    order.gpsHistory.push({
      lat: nextLat,
      lng: nextLng,
      timestamp: pointIso,
      source: source || 'agent_app',
      ...(typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)
        ? { accuracyMeters: Math.round(accuracyMeters) }
        : {}),
      ...(typeof speedKmh === 'number' && Number.isFinite(speedKmh)
        ? { speedKmh: Number(speedKmh.toFixed(1)) }
        : {}),
      ...(backgroundMode ? { backgroundMode } : {}),
    });
    order.gpsHistory.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (order.gpsHistory.length > 80) {
      order.gpsHistory = order.gpsHistory.slice(-80);
    }

    if (dist <= 0.08 && order.status === 'en_route') {
      order.status = 'arrived';
      order.gpsActive = false;
      order.arrivedAt = nowIso;
      assigned.forEach((a) => {
        a.backgroundServiceActive = false;
      });
      addNotification(
        order.id,
        'client',
        'Votre équipe est arrivée',
        `Le traceur GPS indique l’arrivée de votre équipe à destination.`
      );
    }

    order.updatedAt = nowIso;
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 5b. Agent Always-Allow Permission Mode Registration
  app.post('/api/agents/:id/location-permission', (req, res) => {
    const state = store.getState();
    const agent = state.agents.find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent introuvable.' });

    const { permissionMode } = req.body as { permissionMode?: LocationPermissionMode };
    if (
      !permissionMode ||
      !['always_allow', 'when_in_use', 'prompt', 'denied'].includes(permissionMode)
    ) {
      return res.status(400).json({ error: 'Mode de permission localisation invalide.' });
    }

    agent.locationPermissionMode = permissionMode;
    agent.syncIntervalSeconds = 6;
    store.save();
    broadcastUpdate();
    res.json({ agent });
  });

  // 5c. Periodic Agent Foreground Service Heartbeat (continuous DB sync every 5-10s while mission is active)
  app.post('/api/agents/:id/gps-heartbeat', (req, res) => {
    const state = store.getState();
    const agent = state.agents.find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent introuvable.' });

    const {
      lat,
      lng,
      accuracyMeters,
      speedKmh,
      backgroundMode,
      permissionMode,
      orderId,
      capturedAt,
    } = req.body as {
      lat?: number;
      lng?: number;
      accuracyMeters?: number;
      speedKmh?: number;
      backgroundMode?: ForegroundSyncMode;
      permissionMode?: LocationPermissionMode;
      orderId?: string;
      capturedAt?: string;
    };

    const nowIso = new Date().toISOString();
    const pointIso =
      typeof capturedAt === 'string' && !Number.isNaN(Date.parse(capturedAt))
        ? capturedAt
        : nowIso;
    const isLatestAgentFix =
      !agent.lastGpsSyncAt || Date.parse(pointIso) >= Date.parse(agent.lastGpsSyncAt);

    if (isLatestAgentFix) {
      if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
        agent.currentLocation = { lat, lng };
      }
      agent.lastGpsSyncAt = pointIso;
      agent.backgroundServiceActive = backgroundMode !== 'idle';
      agent.syncIntervalSeconds = 6;
      if (typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)) {
        agent.gpsAccuracyMeters = Math.round(accuracyMeters);
      }
      if (permissionMode && ['always_allow', 'when_in_use', 'prompt', 'denied'].includes(permissionMode)) {
        agent.locationPermissionMode = permissionMode;
      }
    }

    const activeOrder = state.orders.find(
      (o) =>
        (orderId ? o.id === orderId : o.assignedAgentIds.includes(agent.id)) &&
        o.status === 'en_route' &&
        o.gpsActive
    );

    if (activeOrder) {
      const pointLat =
        typeof lat === 'number' && Number.isFinite(lat) ? lat : agent.currentLocation.lat;
      const pointLng =
        typeof lng === 'number' && Number.isFinite(lng) ? lng : agent.currentLocation.lng;
      if (isLatestAgentFix) {
        const dist = Number(
          haversineKm({ lat: pointLat, lng: pointLng }, activeOrder.clientLocation).toFixed(2)
        );
        activeOrder.distanceRemainingKm = dist;
        activeOrder.etaMinutes = dist <= 0.08 ? 0 : estimateEtaMin(dist);
        activeOrder.lastGpsSyncAt = pointIso;
        activeOrder.updatedAt = nowIso;
      }
      activeOrder.gpsHistory.push({
        lat: pointLat,
        lng: pointLng,
        timestamp: pointIso,
        source: 'agent_app',
        ...(typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)
          ? { accuracyMeters: Math.round(accuracyMeters) }
          : {}),
        ...(typeof speedKmh === 'number' && Number.isFinite(speedKmh)
          ? { speedKmh: Number(speedKmh.toFixed(1)) }
          : {}),
        ...(backgroundMode ? { backgroundMode } : {}),
      });
      activeOrder.gpsHistory.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      if (activeOrder.gpsHistory.length > 80) {
        activeOrder.gpsHistory = activeOrder.gpsHistory.slice(-80);
      }
    }

    store.save();
    broadcastUpdate();
    res.json({ agent, order: activeOrder || null });
  });

  // 6. Add Before / After Photos
  app.post('/api/orders/:id/photos', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const { type, photos } = req.body as { type: 'before' | 'after'; photos: string[] };
    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Aucune photo fournie.' });
    }
    if (type === 'before') {
      order.beforePhotos = [...order.beforePhotos, ...photos].slice(0, 8);
    } else {
      order.afterPhotos = [...order.afterPhotos, ...photos].slice(0, 8);
    }
    order.updatedAt = new Date().toISOString();
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 7. In-order Messaging (with optional photo)
  app.post('/api/orders/:id/messages', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const { senderRole, senderName, text, photoDataUrl } = req.body;
    if (!text && !photoDataUrl) {
      return res.status(400).json({ error: 'Message vide.' });
    }

    order.messages.push({
      id: uid('msg'),
      senderRole: senderRole || 'client',
      senderName: senderName || 'Utilisateur',
      text: text || '',
      photoDataUrl: photoDataUrl || undefined,
      timestamp: new Date().toISOString(),
    });
    order.updatedAt = new Date().toISOString();
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 8. Client Confirms Completion & Pays (with Commission Ledger)
  app.post('/api/orders/:id/confirm-completion', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    order.clientConfirmedAt = new Date().toISOString();
    order.updatedAt = order.clientConfirmedAt;
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  app.post('/api/orders/:id/pay', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.payment) return res.status(400).json({ error: 'Commande déjà réglée.' });

    const { method, phoneOrRef } = req.body as {
      method: PaymentRecord['method'];
      phoneOrRef?: string;
    };

    const gross = order.finalLockedPriceFcfa ?? order.currentOfferFcfa;
    const sector = state.sectors.find((s) => s.id === 'nettoyage');
    const rate = sector?.commissionRate ?? 0.1;
    const commission = Math.round(gross * rate);
    const companyNet = gross - commission;
    const nowIso = new Date().toISOString();

    const payment: PaymentRecord = {
      id: uid('pay'),
      orderId: order.id,
      method: method || 'airtel_money',
      phoneOrRef: phoneOrRef || order.clientPhone,
      grossAmountFcfa: gross,
      commissionRate: rate,
      commissionFcfa: commission,
      companyNetFcfa: companyNet,
      paidAt: nowIso,
      status: 'paid',
    };

    order.payment = payment;
    order.clientConfirmedAt = order.clientConfirmedAt || nowIso;
    order.status = 'completed';
    order.gpsActive = false;
    order.updatedAt = nowIso;

    const company = state.companies.find((c) => c.id === order.companyId);
    if (company) {
      company.completedInterventions += 1;
    }

    state.transactions.unshift(payment);
    addNotification(
      order.id,
      'client',
      'Paiement confirmé',
      `Reçu de ${gross.toLocaleString('fr-FR')} FCFA enregistré. Votre avis est attendu.`
    );
    addNotification(
      order.id,
      'company',
      `Paiement reçu · ${order.referenceCode}`,
      `Revenu net entreprise : ${companyNet.toLocaleString('fr-FR')} FCFA (commission ${(rate * 100).toFixed(0)} % déduite).`
    );

    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 9. Client Rating & Review
  app.post('/api/orders/:id/review', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const { rating, comment } = req.body as { rating: number; comment: string };
    const cleanRating = Math.min(5, Math.max(1, Number(rating) || 5));
    const nowIso = new Date().toISOString();

    order.review = {
      rating: cleanRating,
      comment: comment || 'Prestation conforme.',
      createdAt: nowIso,
    };

    const company = state.companies.find((c) => c.id === order.companyId);
    if (company) {
      const totalScore = company.rating * company.reviewCount + cleanRating;
      company.reviewCount += 1;
      company.rating = Number((totalScore / company.reviewCount).toFixed(1));
      company.reviews.unshift({
        id: uid('rev'),
        clientName: order.clientName,
        quartier: order.quartierName,
        rating: cleanRating,
        comment: order.review.comment,
        serviceLabel: order.config.categoryLabel,
        createdAt: nowIso.slice(0, 10),
      });
    }

    order.updatedAt = nowIso;
    store.save();
    broadcastUpdate();
    res.json(order);
  });

  // 10. Open Quality Dispute / Claim
  app.post('/api/orders/:id/dispute', (req, res) => {
    const state = store.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const { reason, details } = req.body as { reason: string; details: string };
    const nowIso = new Date().toISOString();

    order.status = 'disputed';
    order.gpsActive = false;
    order.updatedAt = nowIso;

    const dispute: DisputeRecord = {
      id: uid('disp'),
      orderId: order.id,
      companyId: order.companyId,
      companyName: order.companyName,
      clientName: order.clientName,
      reason: reason || 'Insatisfaction sur le résultat',
      details: details || 'Le client demande une vérification qualité par l’administration.',
      status: 'open',
      createdAt: nowIso,
    };

    state.disputes.unshift(dispute);
    addNotification(
      order.id,
      'admin',
      `Réclamation ouverte · ${order.referenceCode}`,
      `${order.clientName} signale un litige avec ${order.companyName}.`
    );

    store.save();
    broadcastUpdate();
    res.json({ order, dispute });
  });

  // 11. Admin Endpoints (Protected strictly for Validated Admin Accounts)
  app.get('/api/admin/users', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const roleFilter = (req.query.role as UserRole | 'all' | undefined) || 'all';
    const statusFilter = (req.query.status as AccountStatus | 'all' | undefined) || 'all';
    const communeFilter = (req.query.communeId as CommuneId | 'all' | undefined) || 'all';
    const search = String(req.query.q || '').trim().toLowerCase();

    const users = state.users
      .filter((u) => {
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (statusFilter !== 'all' && u.status !== statusFilter) return false;
        if (communeFilter !== 'all' && u.communeId !== communeFilter) return false;
        if (search) {
          const hay = `${u.name} ${u.email} ${u.companyName || ''} ${u.communeName}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .map(sanitizeUser);

    res.json({ users });
  });

  app.post('/api/admin/users/:id/status', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const target = state.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    if (target.email.toLowerCase() === MASTER_ADMIN_EMAIL) {
      return res.status(400).json({
        error: 'Le statut du compte Administrateur Principal ne peut pas être modifié.',
      });
    }

    const { status } = req.body as { status: AccountStatus };
    if (!['pending', 'active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide.' });
    }

    target.status = status;

    // Sync linked Company approvalStatus when validating or suspending a Company user
    if (target.role === 'company' && target.companyId) {
      const comp = state.companies.find((c) => c.id === target.companyId);
      if (comp) {
        comp.approvalStatus =
          status === 'active' ? 'approved' : status === 'pending' ? 'pending' : 'suspended';
        comp.verified = status === 'active';
      }
    }

    // Sync linked Agent availability status
    if (target.role === 'agent' && target.agentId) {
      const ag = state.agents.find((a) => a.id === target.agentId);
      if (ag) {
        ag.status = status === 'active' ? 'available' : 'offline';
      }
    }

    store.save();
    broadcastUpdate();
    res.json({ user: sanitizeUser(target) });
  });

  app.post('/api/admin/companies/:id/status', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const company = state.companies.find((c) => c.id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Entreprise introuvable.' });

    const { status } = req.body as { status: CompanyApprovalStatus };
    company.approvalStatus = status;
    company.verified = status === 'approved';

    // Sync linked Company user account status
    const compUser = state.users.find((u) => u.companyId === company.id && u.role === 'company');
    if (compUser) {
      compUser.status =
        status === 'approved' ? 'active' : status === 'pending' ? 'pending' : 'suspended';
    }

    store.save();
    broadcastUpdate();
    res.json(company);
  });

  app.post('/api/admin/tariffs', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const { tariffId, basePriceFcfa, commissionRate } = req.body as {
      tariffId?: string;
      basePriceFcfa?: number;
      commissionRate?: number;
    };

    if (tariffId && typeof basePriceFcfa === 'number') {
      const tariff = state.tariffs.find((t) => t.id === tariffId);
      if (tariff) {
        tariff.basePriceFcfa = Math.max(1000, Math.round(basePriceFcfa));
      }
    }
    if (typeof commissionRate === 'number') {
      const sector = state.sectors.find((s) => s.id === 'nettoyage');
      if (sector) {
        sector.commissionRate = Math.min(0.3, Math.max(0.02, commissionRate));
      }
    }
    store.save();
    broadcastUpdate();
    res.json({ tariffs: state.tariffs, sectors: state.sectors });
  });

  app.post('/api/admin/communes/:communeId/quartiers', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const commune = state.communes.find((c) => c.id === req.params.communeId);
    if (!commune) {
      return res.status(404).json({ error: 'Commune introuvable.' });
    }

    const { name, lat, lng } = req.body as {
      name: string;
      lat?: number;
      lng?: number;
    };

    const cleanName = (name || '').trim();
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Veuillez saisir un nom de quartier valide.' });
    }

    if (commune.quartiers.some((q) => q.name.toLowerCase() === cleanName.toLowerCase())) {
      return res.status(409).json({
        error: `Le quartier « ${cleanName} » existe déjà dans ${commune.name}.`,
      });
    }

    const slug = cleanName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const quartier = {
      id: `${slug || 'q'}_${Date.now().toString(36)}`,
      name: cleanName,
      lat:
        typeof lat === 'number' && Number.isFinite(lat)
          ? Number(lat.toFixed(6))
          : commune.center.lat,
      lng:
        typeof lng === 'number' && Number.isFinite(lng)
          ? Number(lng.toFixed(6))
          : commune.center.lng,
    };

    commune.quartiers.push(quartier);
    store.save();
    broadcastUpdate();
    res.status(201).json({ commune, quartier });
  });

  app.post('/api/admin/disputes/:id/resolve', requireValidatedAdmin, (req, res) => {
    const state = store.getState();
    const dispute = state.disputes.find((d) => d.id === req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Réclamation introuvable.' });

    const { resolution, adminNotes } = req.body as {
      resolution: 'resolved_refund' | 'resolved_warning' | 'dismissed';
      adminNotes?: string;
    };
    const nowIso = new Date().toISOString();
    dispute.status = resolution;
    dispute.adminNotes = adminNotes || 'Décision enregistrée par l’administrateur central.';
    dispute.resolvedAt = nowIso;

    const order = state.orders.find((o) => o.id === dispute.orderId);
    if (order) {
      order.status = 'completed';
      if (resolution === 'resolved_refund' && order.payment) {
        order.payment.status = 'refunded';
      }
      order.updatedAt = nowIso;
    }

    store.save();
    broadcastUpdate();
    res.json(dispute);
  });

  // 12. Admin Manual Broadcast (Segmented by Role & Commune — NEVER triggered automatically on orders)
  app.post('/api/admin/broadcast', requireValidatedAdmin, async (req, res) => {
    const state = store.getState();
    const { title, body, audience, communeId } = req.body as {
      title: string;
      body: string;
      audience: BroadcastAudience;
      communeId: CommuneId | 'all';
    };

    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Titre et message requis pour la diffusion.' });
    }

    const fcmCondition = buildFcmCondition(audience, communeId);
    const matchingCompanies = state.companies.filter(
      (c) =>
        c.approvalStatus === 'approved' &&
        (communeId === 'all' || c.communes.includes(communeId))
    );
    const matchingCompanyIds = matchingCompanies.map((c) => c.id);
    const matchingAgents = state.agents.filter((a) => matchingCompanyIds.includes(a.companyId));
    const estimatedClients =
      audience === 'providers'
        ? 0
        : state.users.filter(
            (u) =>
              u.role === 'client' &&
              u.status === 'active' &&
              (communeId === 'all' || u.communeId === communeId)
          ).length;

    const providerCount =
      audience === 'clients' ? 0 : matchingCompanies.length + matchingAgents.length;
    const recipientCount = estimatedClients + providerCount;

    const broadcast: BroadcastRecord = {
      id: uid('bcast'),
      title: title.trim(),
      body: body.trim(),
      audience,
      communeId,
      fcmCondition,
      recipientCount,
      createdAt: new Date().toISOString(),
    };
    state.broadcasts.unshift(broadcast);
    if (state.broadcasts.length > 30) state.broadcasts = state.broadcasts.slice(0, 30);

    if (audience === 'all' || audience === 'clients') {
      addNotification('broadcast', 'client', broadcast.title, broadcast.body, {
        kind: 'broadcast',
        communeId,
      });
    }
    if (audience === 'all' || audience === 'providers') {
      addNotification('broadcast', 'company', broadcast.title, broadcast.body, {
        kind: 'broadcast',
        communeId,
        targetCompanyIds: matchingCompanyIds,
      });
      addNotification('broadcast', 'agent', broadcast.title, broadcast.body, {
        kind: 'broadcast',
        communeId,
        targetAgentIds: matchingAgents.map((a) => a.id),
      });
    }

    const communeLabel =
      communeId === 'all'
        ? 'Toutes les communes'
        : state.communes.find((c) => c.id === communeId)?.name || communeId;
    const audienceLabel =
      audience === 'all'
        ? 'Clients + Prestataires'
        : audience === 'clients'
        ? 'Clients uniquement'
        : 'Entreprises & Agents uniquement';

    const fcmLog = await dispatchFcmSegmentedMessage({
      kind: 'admin_broadcast',
      condition: fcmCondition,
      title: broadcast.title,
      body: broadcast.body,
      data: { broadcastId: broadcast.id, audience, communeId },
      recipientCount,
      targetSummary: `${audienceLabel} · ${communeLabel}`,
    });
    state.fcmLogs.unshift(fcmLog);
    if (state.fcmLogs.length > 50) state.fcmLogs = state.fcmLogs.slice(0, 50);

    store.save();
    broadcastUpdate();
    res.status(201).json({ broadcast, fcmLog });
  });

  app.post('/api/notifications/:id/read', (req, res) => {
    const state = store.getState();
    const notif = state.notifications.find((n) => n.id === req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification introuvable.' });
    notif.read = true;
    store.save();
    broadcastUpdate();
    res.json(notif);
  });

  // Vite / Static Middleware
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shine x Sanitize (Alp Group) server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
