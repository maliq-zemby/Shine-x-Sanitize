import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword, type StoredUser } from './auth.ts';

export const MASTER_ADMIN_EMAIL = 'maliqzemby8@gmail.com';
import type {
  Agent,
  BootstrapPayload,
  BroadcastRecord,
  Commune,
  Company,
  DisputeRecord,
  ExtraTreatmentOption,
  FcmDispatchLog,
  NotificationItem,
  Order,
  PaymentRecord,
  ReferenceTariff,
  ServiceSector,
} from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'komo-db.json');

export interface DatabaseState extends BootstrapPayload {
  users: StoredUser[];
}

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

export function estimateEtaMin(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / 22) * 60 + 1));
}

function createInitialState(): DatabaseState {
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();

  const communes: Commune[] = [
    {
      id: 'libreville',
      name: 'Libreville',
      center: { lat: 0.4162, lng: 9.4673 },
      travelFeeFcfa: 0,
      quartiers: [
        { id: 'batterie4', name: 'Batterie IV', lat: 0.4255, lng: 9.4392 },
        { id: 'louis', name: 'Louis', lat: 0.4182, lng: 9.4425 },
        { id: 'glass', name: 'Glass', lat: 0.3792, lng: 9.4578 },
        { id: 'mont_bouet', name: 'Mont-Bouët', lat: 0.3982, lng: 9.4562 },
        { id: 'nzeng_ayong', name: 'Nzeng-Ayong', lat: 0.4148, lng: 9.4932 },
        { id: 'kalikak', name: 'Kalikak', lat: 0.4328, lng: 9.4512 },
        { id: 'charbonnages', name: 'Charbonnages', lat: 0.4368, lng: 9.4745 },
        { id: 'lalala', name: 'Lalala', lat: 0.3658, lng: 9.4682 },
        { id: 'akebe', name: 'Akébé', lat: 0.3895, lng: 9.4648 },
        { id: 'nombakele', name: 'Nombakélé', lat: 0.3945, lng: 9.4508 },
        { id: 'alibandeng', name: 'Alibandeng', lat: 0.4518, lng: 9.4342 },
        { id: 'mindoube', name: 'Mindoubé', lat: 0.3935, lng: 9.4978 },
        { id: 'pk8', name: 'PK8 / PK12', lat: 0.4025, lng: 9.5245 },
      ],
    },
    {
      id: 'akanda',
      name: 'Akanda',
      center: { lat: 0.509, lng: 9.439 },
      travelFeeFcfa: 1500,
      quartiers: [
        { id: 'amissa_chantal', name: 'Amissa Chantal', lat: 0.5255, lng: 9.4378 },
        { id: 'angondje', name: 'Angondjé', lat: 0.5138, lng: 9.4425 },
        { id: 'sabliere', name: 'La Sablière', lat: 0.4785, lng: 9.4235 },
        { id: 'avorbam', name: 'Avorbam', lat: 0.4915, lng: 9.4312 },
        { id: 'malibe', name: 'Malibé', lat: 0.5425, lng: 9.4565 },
        { id: 'cap_esterias', name: 'Cap Estérias', lat: 0.6062, lng: 9.3388 },
        { id: 'okala', name: 'Okala', lat: 0.4645, lng: 9.4342 },
        { id: 'premier_campement', name: 'Premier Campement', lat: 0.4712, lng: 9.4265 },
        { id: 'delta_postal', name: 'Delta Postal', lat: 0.5025, lng: 9.4375 },
        { id: 'cite_des_ailes', name: 'Cité des Ailes', lat: 0.5105, lng: 9.4355 },
        { id: 'marseille', name: 'Marseille', lat: 0.5198, lng: 9.4495 },
        { id: 'santa_clara', name: 'Santa Clara', lat: 0.5765, lng: 9.3645 },
      ],
    },
    {
      id: 'owendo',
      name: 'Owendo',
      center: { lat: 0.2965, lng: 9.505 },
      travelFeeFcfa: 1500,
      quartiers: [
        { id: 'owendo_centre', name: 'Centre Owendo', lat: 0.2968, lng: 9.5032 },
        { id: 'alenakiri', name: 'Alénakiri', lat: 0.3245, lng: 9.4858 },
        { id: 'nomba', name: 'Nomba Domaine', lat: 0.3125, lng: 9.5142 },
        { id: 'sni', name: 'SNI Owendo', lat: 0.3052, lng: 9.4975 },
        { id: 'akournam', name: 'Akournam', lat: 0.2895, lng: 9.5215 },
        { id: 'barracuda', name: 'Barracuda', lat: 0.3335, lng: 9.4792 },
      ],
    },
    {
      id: 'ntoum',
      name: 'Grand Libreville · Bikélé / Ntoum',
      center: { lat: 0.391, lng: 9.658 },
      travelFeeFcfa: 3000,
      quartiers: [
        { id: 'bikele', name: 'Bikélé', lat: 0.3822, lng: 9.6152 },
        { id: 'essassa', name: 'Essassa', lat: 0.3865, lng: 9.6458 },
        { id: 'nkoltang', name: 'Nkoltang', lat: 0.3948, lng: 9.6825 },
        { id: 'ntoum_centre', name: 'Ntoum Centre', lat: 0.3912, lng: 9.7612 },
      ],
    },
  ];

  const sectors: ServiceSector[] = [
    {
      id: 'nettoyage',
      name: 'Nettoyage Professionnel',
      subtitle: 'Canapés, matelas, tapis, véhicules, bureaux et fin de chantier',
      active: true,
      commissionRate: 0.1,
    },
    {
      id: 'plomberie',
      name: 'Plomberie & Sanitaire',
      subtitle: 'Dépannage fuites, chauffe-eau et raccordements (prochainement)',
      active: false,
      commissionRate: 0.1,
    },
    {
      id: 'electricite',
      name: 'Électricité & Groupes',
      subtitle: 'Tableaux électriques, onduleurs et dépannage (prochainement)',
      active: false,
      commissionRate: 0.1,
    },
    {
      id: 'climatisation',
      name: 'Climatisation & Froid',
      subtitle: 'Entretien split, recharge gaz et désinfection (prochainement)',
      active: false,
      commissionRate: 0.1,
    },
    {
      id: 'jardinage',
      name: 'Jardinage & Espaces Verts',
      subtitle: 'Tonte, taille et entretien résidentiel (prochainement)',
      active: false,
      commissionRate: 0.1,
    },
    {
      id: 'auto',
      name: 'Entretien Automobile Mobile',
      subtitle: 'Diagnostic, vidange et lavage écologique à domicile (prochainement)',
      active: false,
      commissionRate: 0.1,
    },
  ];

  const tariffs: ReferenceTariff[] = [
    { id: 't_canape_2', categoryId: 'canape', code: 'CANAPE_2P', label: 'Canapé 2 places', basePriceFcfa: 10000, estimatedMinutes: 55, description: 'Injection-extraction ou méthode adaptée textile' },
    { id: 't_canape_3', categoryId: 'canape', code: 'CANAPE_3P', label: 'Canapé 3 places', basePriceFcfa: 15000, estimatedMinutes: 75, description: 'Nettoyage en profondeur et détachage ciblé' },
    { id: 't_canape_l', categoryId: 'canape', code: 'CANAPE_L', label: 'Canapé en L (4-5 places)', basePriceFcfa: 25000, estimatedMinutes: 105, description: 'Traitement intégral méridienne incluse' },
    { id: 't_canape_u', categoryId: 'canape', code: 'CANAPE_U', label: 'Canapé en U (6+ places)', basePriceFcfa: 35000, estimatedMinutes: 140, description: 'Intervention grand volume recommandée à 2 agents' },
    { id: 't_fauteuil', categoryId: 'fauteuil', code: 'FAUTEUIL', label: 'Fauteuil individuel', basePriceFcfa: 5000, estimatedMinutes: 35, description: 'Fauteuil salon, bergère ou fauteuil de bureau' },
    { id: 't_matelas_1', categoryId: 'matelas', code: 'MATELAS_1P', label: 'Matelas 1 place', basePriceFcfa: 10000, estimatedMinutes: 45, description: 'Désinfection et extraction acariens' },
    { id: 't_matelas_2', categoryId: 'matelas', code: 'MATELAS_2P', label: 'Matelas 2 places / King', basePriceFcfa: 15000, estimatedMinutes: 65, description: 'Traitement taches, auréoles et mauvaises odeurs' },
    { id: 't_tapis', categoryId: 'tapis', code: 'TAPIS_MOYEN', label: 'Tapis moyen', basePriceFcfa: 15000, estimatedMinutes: 60, description: 'Brossage rotatif, shampooing et extraction' },
    { id: 't_chaise', categoryId: 'chaise', code: 'CHAISE_LOT', label: 'Chaises (tarif unitaire de base 2 000 FCFA)', basePriceFcfa: 8000, estimatedMinutes: 40, description: 'Base 4 chaises — ajustée au nombre réel' },
    { id: 't_moquette', categoryId: 'moquette', code: 'MOQUETTE_10M2', label: 'Moquette (tranche de 10 m²)', basePriceFcfa: 12000, estimatedMinutes: 60, description: 'Brossage mécanique et injection-extraction' },
    { id: 't_vehicule', categoryId: 'vehicule', code: 'VEHICULE_COMPLET', label: 'Intérieur véhicule complet', basePriceFcfa: 20000, estimatedMinutes: 90, description: 'Sièges, moquettes, garnitures et coffre' },
    { id: 't_bureau', categoryId: 'bureau', code: 'BUREAU_50M2', label: 'Bureaux & locaux (base 50 m²)', basePriceFcfa: 30000, estimatedMinutes: 120, description: 'Postes de travail, vitrerie et sols professionnels' },
    { id: 't_fin_travaux', categoryId: 'fin_travaux', code: 'FIN_TRAVAUX', label: 'Après déménagement ou travaux', basePriceFcfa: 45000, estimatedMinutes: 180, description: 'Remise en état complète par équipe dédiée' },
  ];

  const extraTreatments: ExtraTreatmentOption[] = [
    { id: 'desodorisation', label: 'Désodorisation profonde', priceFcfa: 0, description: 'Neutralisation moléculaire des odeurs persistantes' },
    { id: 'anti_acariens', label: 'Traitement anti-acariens adapté', priceFcfa: 3500, description: 'Solution certifiée pour textiles et literie' },
    { id: 'protection_textile', label: 'Protection textile imperméabilisante', priceFcfa: 10000, description: 'Barrière anti-taches longue durée' },
    { id: 'antibacterien', label: 'Traitement antibactérien adapté', priceFcfa: 3000, description: 'Assainissement vapeur ou enzymatique sans chlore' },
    { id: 'nettoyage_vapeur', label: 'Nettoyage à vapeur', priceFcfa: 5000, description: 'Assainissement thermique et élimination des germes en profondeur' },
  ];

  const companies: Company[] = [];
  const agents: Agent[] = [];
  const orders: Order[] = [];
  const transactions: PaymentRecord[] = [];
  const disputes: DisputeRecord[] = [];
  const notifications: NotificationItem[] = [];
  const broadcasts: BroadcastRecord[] = [];
  const fcmLogs: FcmDispatchLog[] = [];

  const masterAdminPassword = process.env.MASTER_ADMIN_PASSWORD || 'bac2k230';

  const users: StoredUser[] = [
    {
      id: 'usr_admin_master',
      name: 'ZEMBY Maliq',
      email: MASTER_ADMIN_EMAIL,
      role: 'admin',
      communeId: 'libreville',
      communeName: 'Libreville',
      quartierName: 'Louis',
      status: 'active',
      createdAt: now.toISOString(),
      passwordHash: hashPassword(masterAdminPassword),
    },
  ];

  return {
    communes,
    sectors,
    tariffs,
    extraTreatments,
    companies,
    agents,
    orders,
    disputes,
    transactions,
    notifications,
    broadcasts,
    fcmLogs,
    users,
  };
}

export class Store {
  private state: DatabaseState;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<DatabaseState>;
        const defaults = createInitialState();
        this.state = {
          ...defaults,
          ...parsed,
          broadcasts: Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [],
          fcmLogs: Array.isArray(parsed.fcmLogs) ? parsed.fcmLogs : [],
          users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : defaults.users,
        };
      } catch {
        this.state = createInitialState();
        this.save();
      }
    } else {
      this.state = createInitialState();
      this.save();
    }
    this.ensureMasterAdminAccount();
    this.ensureDefaultCommuneQuartiers();
    this.ensureExtraTreatmentsUpToDate();
  }

  private ensureDefaultCommuneQuartiers(): void {
    const defaults = createInitialState().communes;
    let changed = false;

    for (const defC of defaults) {
      const existingC = this.state.communes.find((c) => c.id === defC.id);
      if (!existingC) {
        this.state.communes.push(defC);
        changed = true;
        continue;
      }
      for (const defQ of defC.quartiers) {
        const already = existingC.quartiers.some(
          (q) => q.id === defQ.id || q.name.toLowerCase() === defQ.name.toLowerCase()
        );
        if (!already) {
          existingC.quartiers.push(defQ);
          changed = true;
        }
      }
    }

    if (changed) {
      this.save();
    }
  }

  private ensureExtraTreatmentsUpToDate(): void {
    const defaults = createInitialState().extraTreatments;
    if (!Array.isArray(this.state.extraTreatments)) {
      this.state.extraTreatments = defaults;
      this.save();
      return;
    }

    let changed = false;
    const targetIds = new Set(['desodorisation', 'protection_textile', 'nettoyage_vapeur']);

    for (const def of defaults) {
      const existing = this.state.extraTreatments.find((e) => e.id === def.id);
      if (!existing) {
        this.state.extraTreatments.push(def);
        changed = true;
      } else if (targetIds.has(def.id)) {
        if (
          existing.priceFcfa !== def.priceFcfa ||
          existing.label !== def.label ||
          existing.description !== def.description
        ) {
          existing.priceFcfa = def.priceFcfa;
          existing.label = def.label;
          existing.description = def.description;
          changed = true;
        }
      }
    }

    if (changed) {
      this.save();
    }
  }

  private ensureMasterAdminAccount(): void {
    const masterAdminPassword = process.env.MASTER_ADMIN_PASSWORD || 'bac2k230';
    let changed = false;

    const beforeLen = this.state.users.length;
    this.state.users = this.state.users.filter(
      (u) =>
        u.email.toLowerCase() === MASTER_ADMIN_EMAIL ||
        (u.id !== 'usr_admin_master' && u.role !== 'admin')
    );
    if (this.state.users.length !== beforeLen) {
      changed = true;
    }

    const existing = this.state.users.find(
      (u) => u.email.toLowerCase() === MASTER_ADMIN_EMAIL
    );
    if (existing) {
      if (existing.name !== 'ZEMBY Maliq') {
        existing.name = 'ZEMBY Maliq';
        changed = true;
      }
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        changed = true;
      }
      if (existing.status !== 'active') {
        existing.status = 'active';
        changed = true;
      }
      if (!verifyPassword(masterAdminPassword, existing.passwordHash)) {
        existing.passwordHash = hashPassword(masterAdminPassword);
        changed = true;
      }
    } else {
      this.state.users.unshift({
        id: 'usr_admin_master',
        name: 'ZEMBY Maliq',
        email: MASTER_ADMIN_EMAIL,
        role: 'admin',
        communeId: 'libreville',
        communeName: 'Libreville',
        quartierName: 'Louis',
        status: 'active',
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(masterAdminPassword),
      });
      changed = true;
    }

    if (changed) {
      this.save();
    }
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public save(): void {
    fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf8');
  }

  public resetDemo(): DatabaseState {
    this.state = createInitialState();
    this.save();
    return this.state;
  }
}

export const store = new Store();
