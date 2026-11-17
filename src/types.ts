export type UserRole = 'client' | 'company' | 'agent' | 'admin';

export type AccountStatus = 'pending' | 'active' | 'suspended';

export type CommuneId = 'libreville' | 'akanda' | 'owendo' | 'ntoum';

export interface Quartier {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Commune {
  id: CommuneId;
  name: string;
  center: { lat: number; lng: number };
  travelFeeFcfa: number;
  quartiers: Quartier[];
}

export type ServiceSectorId =
  | 'nettoyage'
  | 'plomberie'
  | 'electricite'
  | 'climatisation'
  | 'jardinage'
  | 'auto';

export type CleaningCategoryId =
  | 'canape'
  | 'fauteuil'
  | 'tapis'
  | 'matelas'
  | 'chaise'
  | 'moquette'
  | 'vehicule'
  | 'bureau'
  | 'fin_travaux';

export interface ServiceSector {
  id: ServiceSectorId;
  name: string;
  subtitle: string;
  active: boolean;
  commissionRate: number;
}

export interface ReferenceTariff {
  id: string;
  categoryId: CleaningCategoryId;
  code: string;
  label: string;
  basePriceFcfa: number;
  estimatedMinutes: number;
  description: string;
}

export interface ExtraTreatmentOption {
  id: string;
  label: string;
  priceFcfa: number;
  description: string;
}

export type LocationPermissionMode = 'always_allow' | 'when_in_use' | 'prompt' | 'denied';

export type ForegroundSyncMode =
  | 'native_bridge'
  | 'foreground_sw_wakelock'
  | 'visibility_heartbeat'
  | 'idle';

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  specialty: string;
  scooterTrackerId: string;
  status: 'available' | 'en_route' | 'busy' | 'offline';
  currentLocation: { lat: number; lng: number };
  completedJobs: number;
  rating: number;
  locationPermissionMode?: LocationPermissionMode;
  backgroundServiceActive?: boolean;
  lastGpsSyncAt?: string;
  gpsAccuracyMeters?: number;
  syncIntervalSeconds?: number;
}

export interface CompanyReview {
  id: string;
  clientName: string;
  quartier: string;
  rating: number;
  comment: string;
  serviceLabel: string;
  createdAt: string;
}

export type CompanyApprovalStatus = 'approved' | 'pending' | 'suspended';

export type DayOfWeekKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface Company {
  id: string;
  name: string;
  initials: string;
  description: string;
  communes: CommuneId[];
  baseLocation: { lat: number; lng: number };
  address?: string;
  phone: string;
  approvalStatus: CompanyApprovalStatus;
  verified: boolean;
  rating: number;
  reviewCount: number;
  completedInterventions: number;
  estimatedArrivalMin: number;
  equipment: string[];
  methodsSupported: string[];
  categoriesSupported: CleaningCategoryId[];
  openingDays?: DayOfWeekKey[];
  openingTime?: string;
  closingTime?: string;
  workingHours: string;
  galleryKeys: (
    | 'sofa'
    | 'mattress'
    | 'carDetailing'
    | 'carpetFloor'
    | 'armchair'
    | 'postRenovation'
    | 'car'
    | 'office'
    | 'scooter'
    | 'hero'
  )[];
  reviews: CompanyReview[];
}

export type OrderStatus =
  | 'pending_company'
  | 'negotiating_client_turn'
  | 'negotiating_company_turn'
  | 'confirmed'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'awaiting_client_validation'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface NegotiationEntry {
  id: string;
  actor: 'system' | 'client' | 'company';
  actorName: string;
  action: 'reference' | 'client_offer' | 'counter_offer' | 'hold_reference' | 'accepted' | 'locked';
  amountFcfa: number;
  note: string;
  timestamp: string;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: string;
  source: 'agent_app' | 'scooter_tracker';
  accuracyMeters?: number;
  speedKmh?: number;
  backgroundMode?: ForegroundSyncMode;
}

export interface ChatMessage {
  id: string;
  senderRole: 'client' | 'company' | 'agent' | 'system';
  senderName: string;
  text: string;
  photoDataUrl?: string;
  timestamp: string;
}

export interface ServiceConfiguration {
  categoryId: CleaningCategoryId;
  categoryLabel: string;
  // Canape / general furniture
  furnitureType?: string;
  seats?: number;
  material?: string;
  unknownMaterial?: boolean;
  condition?: string;
  stains?: string[];
  stainNotes?: string;
  treatmentMethods?: string[];
  expectedOutcome?: string;
  extraTreatments: string[];
  // Matelas
  mattressSize?: string;
  mattressThickness?: string;
  mattressSides?: '1 face' | '2 faces';
  // Tapis / Moquette
  dimensionsLabel?: string;
  surfaceSqm?: number;
  // Chaises / Fauteuils
  itemCount?: number;
  chairScope?: string;
  // Vehicule
  vehicleModel?: string;
  vehicleSeats?: number;
  vehicleScopes?: string[];
  // Bureau / Fin de travaux
  roomCount?: number;
  frequency?: string;
  officeEquipments?: string[];
  // Scheduling & team
  agentCount: number;
  scheduleType: 'today' | 'tomorrow' | 'custom' | 'urgent';
  scheduledDate: string;
  scheduledTime: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  method: 'airtel_money' | 'moov_money' | 'cash' | 'card';
  phoneOrRef: string;
  grossAmountFcfa: number;
  commissionRate: number;
  commissionFcfa: number;
  companyNetFcfa: number;
  paidAt: string;
  status: 'paid' | 'refunded';
}

export interface DisputeRecord {
  id: string;
  orderId: string;
  companyId: string;
  companyName: string;
  clientName: string;
  reason: string;
  details: string;
  status: 'open' | 'resolved_refund' | 'resolved_warning' | 'dismissed';
  adminNotes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface NotificationItem {
  id: string;
  orderId: string;
  targetRole: 'client' | 'company' | 'agent' | 'admin';
  kind?: 'targeted_order' | 'broadcast' | 'order_update' | 'new_registration';
  communeId?: CommuneId | 'all';
  targetCompanyIds?: string[];
  targetAgentIds?: string[];
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface UserPreferences {
  notificationsEnabled?: boolean;
  smsUpdatesEnabled?: boolean;
  preferredPaymentMethod?: 'airtel_money' | 'moov_money' | 'cash' | 'card';
  defaultAddressDetails?: string;
  lastActiveView?: 'home' | 'configurator' | 'orders' | 'pro' | 'admin' | 'auth';
  lastProTab?: 'company' | 'agent';
  lastSelectedOrderId?: string | null;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  communeId: CommuneId;
  communeName: string;
  quartierName?: string;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt?: string;
  updatedAt?: string;
  companyId?: string;
  companyName?: string;
  agentId?: string;
  specialty?: string;
  scooterTrackerId?: string;
  agentStatus?: Agent['status'];
  preferences?: UserPreferences;
}

export interface ProfileUpdatePayload {
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
  agentStatus?: Agent['status'];
  preferences?: UserPreferences;
}

export interface ProfileSyncResponse {
  user: RegisteredUser;
  company?: Company;
  agent?: Agent;
}

export interface AuthResponse {
  token: string;
  user: RegisteredUser;
  company?: Company;
  agent?: Agent;
}

export interface BroadcastRecord {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'clients' | 'providers';
  communeId: CommuneId | 'all';
  fcmCondition: string;
  recipientCount: number;
  createdAt: string;
}

export interface FcmDispatchLog {
  id: string;
  kind: 'targeted_order' | 'admin_broadcast' | 'new_registration';
  condition: string;
  title: string;
  body: string;
  data: Record<string, string>;
  recipientCount: number;
  targetSummary: string;
  deliveryMode: 'fcm_http_v1' | 'simulated_local';
  createdAt: string;
}

export interface Order {
  id: string;
  referenceCode: string;
  clientName: string;
  clientPhone: string;
  communeId: CommuneId;
  communeName: string;
  quartierName: string;
  addressDetails: string;
  clientLocation: { lat: number; lng: number };
  companyId: string;
  companyName: string;
  selectionMode?: 'auto' | 'manual';
  assignedAgentIds: string[];
  status: OrderStatus;
  config: ServiceConfiguration;
  beforePhotos: string[];
  beforeVideoName?: string;
  afterPhotos: string[];
  // Pricing & Negotiation
  referencePriceFcfa: number;
  extrasPriceFcfa: number;
  travelFeeFcfa: number;
  clientProposedBudgetFcfa: number;
  currentOfferFcfa: number;
  finalLockedPriceFcfa: number | null;
  priceLocked: boolean;
  negotiationHistory: NegotiationEntry[];
  // GPS & Execution
  gpsActive: boolean;
  gpsHistory: GpsPoint[];
  etaMinutes: number | null;
  distanceRemainingKm: number | null;
  lastGpsSyncAt?: string;
  startedTravelAt?: string;
  arrivedAt?: string;
  startedWorkAt?: string;
  completedWorkAt?: string;
  clientConfirmedAt?: string;
  // Quality, Messaging, Payment, Review
  messages: ChatMessage[];
  payment?: PaymentRecord;
  review?: {
    rating: number;
    comment: string;
    createdAt: string;
  };
  issueReport?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapPayload {
  communes: Commune[];
  sectors: ServiceSector[];
  tariffs: ReferenceTariff[];
  extraTreatments: ExtraTreatmentOption[];
  companies: Company[];
  agents: Agent[];
  orders: Order[];
  disputes: DisputeRecord[];
  transactions: PaymentRecord[];
  notifications: NotificationItem[];
  broadcasts: BroadcastRecord[];
  fcmLogs: FcmDispatchLog[];
}
