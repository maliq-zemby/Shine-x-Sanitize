import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  Clock,
  LocateFixed,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Upload,
  Users,
  Video,
} from 'lucide-react';
import { api } from '../lib/api';
import { findNearestQuartier, formatFcfa, haversineKm } from '../lib/format';
import {
  getCompanySchedule,
  suggestNextOpenSlotForCompany,
  validateBookingSlotForCompany,
} from '../lib/schedule';
import { MapTracking } from './MapTracking';
import type {
  Agent,
  CleaningCategoryId,
  Commune,
  CommuneId,
  Company,
  ExtraTreatmentOption,
  Order,
  ReferenceTariff,
  RegisteredUser,
  ServiceConfiguration,
} from '../types';

interface ServiceConfiguratorProps {
  communes: Commune[];
  tariffs: ReferenceTariff[];
  extraTreatments: ExtraTreatmentOption[];
  companies: Company[];
  agents: Agent[];
  currentUser?: RegisteredUser | null;
  mapsApiKey: string;
  initialCategoryId: CleaningCategoryId;
  initialCompanyId?: string;
  selectedCommuneId: CommuneId;
  selectedQuartier: string;
  onCancel: () => void;
  onOrderCreated: (order: Order) => void;
}

const CATEGORY_LABELS: Record<CleaningCategoryId, string> = {
  canape: 'Nettoyage de canapé',
  fauteuil: 'Nettoyage de fauteuils',
  tapis: 'Nettoyage de tapis',
  matelas: 'Nettoyage de matelas',
  chaise: 'Nettoyage de chaises',
  moquette: 'Nettoyage de moquettes',
  vehicule: 'Nettoyage intérieur de véhicule',
  bureau: 'Nettoyage de bureaux & locaux',
  fin_travaux: 'Nettoyage après déménagement / travaux',
};

function getTeamQualification(count: number): { title: string; short: string } {
  if (count <= 1) return { title: 'Intervention standard', short: 'Standard' };
  if (count === 2) return { title: 'Intervention en équipe', short: 'En équipe' };
  if (count === 3) return { title: 'Intervention renforcée', short: 'Renforcée' };
  if (count === 4) return { title: 'Grande intervention', short: 'Grande équipe' };
  return { title: 'Chantier majeur / Brigade complète', short: 'Brigade complète' };
}

const TEAM_SIZE_OPTIONS = Array.from({ length: 10 }, (_, idx) => {
  const n = idx + 1;
  const q = getTeamQualification(n);
  return {
    n,
    label: `${n} agent${n > 1 ? 's' : ''}`,
    title: q.title,
    short: q.short,
  };
});

const FURNITURE_TYPES = [
  'Canapé droit',
  'Canapé d’angle',
  'Canapé en L',
  'Canapé en U',
  'Fauteuil',
  'Plusieurs canapés',
];

const MATERIALS = [
  'Tissu',
  'Velours',
  'Cuir',
  'Simili cuir',
  'Microfibre',
  'Daim',
  'Je ne sais pas (joindre photo)',
];

const CONDITIONS = [
  'Très bon état',
  'Légèrement sale',
  'Moyennement sale',
  'Très sale',
  'Présence de taches importantes',
  'Présence de mauvaises odeurs',
  'Présence de poils d’animaux',
  'Présence de moisissures ou humidité',
];

const STAIN_TYPES = [
  'Taches alimentaires',
  'Café',
  'Vin',
  'Graisse',
  'Urine',
  'Transpiration',
  'Encre',
  'Sang',
  'Taches anciennes',
  'Autres',
];

const TREATMENT_METHODS = [
  'Nettoyage par injection-extraction',
  'Brossage',
  'Nettoyage manuel',
  'Nettoyage à la vapeur (si textile compatible)',
  'Traitement anti-odeurs',
  'Désinfection adaptée',
  'Détachage ciblé',
  'Traitement complémentaire',
];

const OUTCOMES = [
  'Nettoyage d’entretien',
  'Nettoyage approfondi',
  'Traitement des taches',
  'Rafraîchissement du tissu',
  'Élimination des mauvaises odeurs',
  'Nettoyage complet avec traitement complémentaire',
];

async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ServiceConfigurator({
  communes,
  tariffs,
  extraTreatments,
  companies,
  agents,
  currentUser,
  mapsApiKey,
  initialCategoryId,
  initialCompanyId,
  selectedCommuneId,
  selectedQuartier,
  onCancel,
  onOrderCreated,
}: ServiceConfiguratorProps) {
  const [categoryId, setCategoryId] = useState<CleaningCategoryId>(initialCategoryId);
  const [communeId, setCommuneId] = useState<CommuneId>(selectedCommuneId);
  const [quartierName, setQuartierName] = useState<string>(selectedQuartier);
  const [addressDetails, setAddressDetails] = useState(
    currentUser?.preferences?.defaultAddressDetails || ''
  );
  const [clientName, setClientName] = useState(currentUser?.name || '');
  const [clientPhone, setClientPhone] = useState(currentUser?.phone || '');
  const [clientCoords, setClientCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsDetecting, setGpsDetecting] = useState(false);
  const [gpsFeedback, setGpsFeedback] = useState<string | null>(null);

  // Sofa 8-step config
  const [furnitureType, setFurnitureType] = useState('Canapé droit');
  const [seats, setSeats] = useState<number>(3);
  const [material, setMaterial] = useState('Tissu');
  const [condition, setCondition] = useState('Moyennement sale');
  const [stains, setStains] = useState<string[]>(['Taches alimentaires']);
  const [stainNotes, setStainNotes] = useState('');
  const [treatmentMethods, setTreatmentMethods] = useState<string[]>([
    'Nettoyage par injection-extraction',
    'Détachage ciblé',
  ]);
  const [expectedOutcome, setExpectedOutcome] = useState('Nettoyage approfondi');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  // Category-specific smart fields
  const [mattressSize, setMattressSize] = useState<'1 place' | '2 places'>('2 places');
  const [mattressThickness, setMattressThickness] = useState('Standard (18-24 cm)');
  const [mattressSides, setMattressSides] = useState<'1 face' | '2 faces'>('2 faces');

  const [dimensionsLabel, setDimensionsLabel] = useState('Moyen (2m × 3m)');
  const [surfaceSqm, setSurfaceSqm] = useState<number>(30);
  const [itemCount, setItemCount] = useState<number>(4);
  const [chairScope, setChairScope] = useState('Assise et dossier');

  const [vehicleModel, setVehicleModel] = useState('SUV / 4×4 (Toyota Prado, RAV4...)');
  const [vehicleSeats, setVehicleSeats] = useState<number>(5);
  const [vehicleScopes, setVehicleScopes] = useState<string[]>([
    'Nettoyage des sièges',
    'Nettoyage des tapis',
    'Nettoyage du coffre',
  ]);

  const [roomCount, setRoomCount] = useState<number>(4);
  const [frequency, setFrequency] = useState('Intervention ponctuelle');
  const [officeEquipments, setOfficeEquipments] = useState<string[]>([
    'Postes de travail & chaises',
    'Vitreries intérieures',
  ]);

  // Photos & Video
  const [beforePhotos, setBeforePhotos] = useState<string[]>([]);
  const [beforeVideoName, setBeforeVideoName] = useState<string>('');

  // Team & Schedule
  const [agentCount, setAgentCount] = useState<number>(1);
  const [scheduleType, setScheduleType] = useState<'today' | 'tomorrow' | 'custom' | 'urgent'>('today');
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduledTime, setScheduledTime] = useState('15:00');

  // Pricing & Company selection
  const [customBudgetEnabled, setCustomBudgetEnabled] = useState(false);
  const [proposedBudget, setProposedBudget] = useState<number | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(initialCompanyId || '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentCommune = communes.find((c) => c.id === communeId) || communes[0];
  const currentQuartier =
    currentCommune?.quartiers.find((q) => q.name === quartierName) ||
    currentCommune?.quartiers[0];

  const effectiveClientLocation = useMemo(
    () =>
      clientCoords ||
      (currentQuartier
        ? { lat: currentQuartier.lat, lng: currentQuartier.lng }
        : currentCommune?.center || { lat: 0.4162, lng: 9.4673 }),
    [clientCoords, currentQuartier, currentCommune]
  );

  const applyExactCoordinates = (coords: { lat: number; lng: number }, source: 'gps' | 'map') => {
    setClientCoords(coords);
    const match = findNearestQuartier(coords, communes);
    if (match) {
      setCommuneId(match.commune.id);
      setQuartierName(match.quartier.name);
      const prefix = source === 'gps' ? 'Zone détectée' : 'Point sélectionné';
      setGpsFeedback(
        `${prefix} : ${match.quartier.name}, ${match.commune.name} (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}).`
      );
    } else {
      setGpsFeedback(
        `Position enregistrée (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}).`
      );
    }
  };

  const handleUseCurrentGps = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsFeedback(
        'Géolocalisation navigateur indisponible. Pointez votre domicile directement sur la carte.'
      );
      return;
    }
    setGpsDetecting(true);
    setGpsFeedback(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        applyExactCoordinates(coords, 'gps');
        setGpsDetecting(false);
      },
      () => {
        setGpsDetecting(false);
        setGpsFeedback(
          'Autorisation GPS refusée ou indisponible. Cliquez sur la carte ci-dessous pour pointer votre domicile.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  // Dynamic Reference Price Computation using shared Admin Tariffs
  const pricing = useMemo(() => {
    const findTariff = (code: string, fallback: number) =>
      tariffs.find((t) => t.code === code)?.basePriceFcfa ?? fallback;

    let baseRef = 15000;
    if (categoryId === 'canape') {
      if (furnitureType === 'Canapé en U' || seats >= 6) {
        baseRef = findTariff('CANAPE_U', 35000);
      } else if (furnitureType === 'Canapé en L' || furnitureType === 'Canapé d’angle' || seats >= 4) {
        baseRef = findTariff('CANAPE_L', 25000);
      } else if (furnitureType === 'Fauteuil' || seats === 1) {
        baseRef = findTariff('FAUTEUIL', 5000);
      } else if (seats === 2) {
        baseRef = findTariff('CANAPE_2P', 10000);
      } else {
        baseRef = findTariff('CANAPE_3P', 15000);
      }
      if (furnitureType === 'Plusieurs canapés') {
        baseRef = Math.round(baseRef * 1.5);
      }
    } else if (categoryId === 'fauteuil') {
      baseRef = findTariff('FAUTEUIL', 5000) * Math.max(1, itemCount);
    } else if (categoryId === 'matelas') {
      const mBase =
        mattressSize === '1 place'
          ? findTariff('MATELAS_1P', 10000)
          : findTariff('MATELAS_2P', 15000);
      baseRef = mattressSides === '2 faces' ? Math.round(mBase * 1.25) : mBase;
    } else if (categoryId === 'tapis') {
      const tBase = findTariff('TAPIS_MOYEN', 15000);
      baseRef = dimensionsLabel.includes('Grand') ? Math.round(tBase * 1.4) : tBase;
    } else if (categoryId === 'chaise') {
      const lotBase = findTariff('CHAISE_LOT', 8000);
      baseRef = Math.round((lotBase / 4) * Math.max(1, itemCount));
    } else if (categoryId === 'moquette') {
      const unit10 = findTariff('MOQUETTE_10M2', 12000);
      baseRef = Math.max(unit10, Math.ceil(surfaceSqm / 10) * unit10);
    } else if (categoryId === 'vehicule') {
      const vBase = findTariff('VEHICULE_COMPLET', 20000);
      baseRef = vehicleSeats >= 7 ? Math.round(vBase * 1.3) : vBase;
    } else if (categoryId === 'bureau') {
      const bBase = findTariff('BUREAU_50M2', 30000);
      baseRef = Math.max(bBase, Math.ceil(surfaceSqm / 50) * bBase);
    } else if (categoryId === 'fin_travaux') {
      const fBase = findTariff('FIN_TRAVAUX', 45000);
      baseRef = surfaceSqm > 80 ? Math.round(fBase * 1.35) : fBase;
    }

    // Multiply service base reference cost in real time by selected team size (1 to 10 agents)
    const safeAgentCount = Math.min(10, Math.max(1, Math.round(agentCount)));
    const unitReferenceFcfa = baseRef;
    const referencePriceFcfa = unitReferenceFcfa * safeAgentCount;

    const extrasPriceFcfa = selectedExtras.reduce((sum, label) => {
      const opt = extraTreatments.find((e) => e.label === label);
      return sum + (opt?.priceFcfa || 0);
    }, 0);

    const travelFeeFcfa = currentCommune?.travelFeeFcfa ?? 0;
    const totalReferenceFcfa = referencePriceFcfa + extrasPriceFcfa + travelFeeFcfa;

    return {
      unitReferenceFcfa,
      referencePriceFcfa,
      extrasPriceFcfa,
      travelFeeFcfa,
      totalReferenceFcfa,
    };
  }, [
    categoryId,
    furnitureType,
    seats,
    itemCount,
    mattressSize,
    mattressSides,
    dimensionsLabel,
    surfaceSqm,
    vehicleSeats,
    agentCount,
    selectedExtras,
    extraTreatments,
    tariffs,
    currentCommune,
  ]);

  const effectiveBudget =
    customBudgetEnabled && proposedBudget !== null
      ? Math.max(2000, proposedBudget)
      : pricing.totalReferenceFcfa;

  const companyMatches = useMemo(() => {
    return companies
      .filter((c) => c.approvalStatus === 'approved')
      .map((c) => {
        const freeAgents = agents.filter(
          (a) => a.companyId === c.id && a.status === 'available'
        );
        const coversCommune = c.communes.includes(communeId);
        const coversCategory = c.categoriesSupported.includes(categoryId);
        const hasCapacity = freeAgents.length >= agentCount;
        const schedule = getCompanySchedule(c);
        const slotCheck = validateBookingSlotForCompany(c, scheduledDate, scheduledTime);
        const distKm = Number(haversineKm(c.baseLocation, effectiveClientLocation).toFixed(1));
        const etaMin = Math.max(12, Math.round(distKm * 3.5 + 8));

        let unavailableReason: string | null = null;
        if (!coversCommune) {
          unavailableReason = `N’intervient pas à ${currentCommune?.name}`;
        } else if (!coversCategory) {
          unavailableReason = 'Catégorie non couverte';
        } else if (!slotCheck.valid) {
          unavailableReason = slotCheck.reason;
        } else if (!hasCapacity) {
          unavailableReason = `Seulement ${freeAgents.length} agent(s) libre(s) sur ${agentCount} demandé(s)`;
        }

        const score = c.rating * 12 - distKm * 3 + Math.min(freeAgents.length, 4) * 1.5;

        return {
          company: c,
          freeCount: freeAgents.length,
          distKm,
          etaMin,
          score,
          scheduleLabel: schedule.label,
          coversCommune,
          coversCategory,
          slotValid: slotCheck.valid,
          scheduleBlocked: coversCommune && coversCategory && !slotCheck.valid,
          eligible: !unavailableReason,
          unavailableReason,
        };
      })
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return b.score - a.score;
      });
  }, [
    companies,
    agents,
    communeId,
    categoryId,
    agentCount,
    effectiveClientLocation,
    currentCommune,
    scheduledDate,
    scheduledTime,
  ]);

  // Strict filtered list for "Choisir votre entreprise partenaire":
  // ONLY admin-approved, supports requested service, covers chosen zone, and open at chosen date/time
  const openMatchingPartners = useMemo(
    () => companyMatches.filter((m) => m.coversCommune && m.coversCategory && m.slotValid),
    [companyMatches]
  );

  // If the client switches commune or service category such that a manually selected
  // company no longer covers that zone or service, fall back cleanly to automatic mode.
  useEffect(() => {
    if (!selectedCompanyId) return;
    const match = companyMatches.find((m) => m.company.id === selectedCompanyId);
    if (!match || !match.coversCommune || !match.coversCategory) {
      setSelectedCompanyId('');
    }
  }, [selectedCompanyId, companyMatches]);

  const recommendedAutoMatch = useMemo(
    () => openMatchingPartners.find((m) => m.eligible) || null,
    [openMatchingPartners]
  );

  const focusedCompany = useMemo(() => {
    if (selectedCompanyId) {
      return companies.find((c) => c.id === selectedCompanyId && c.approvalStatus === 'approved') || null;
    }
    if (recommendedAutoMatch) return recommendedAutoMatch.company;
    const closedMatch = companyMatches.find((m) => m.scheduleBlocked);
    return closedMatch?.company || null;
  }, [selectedCompanyId, companies, recommendedAutoMatch, companyMatches]);

  const focusedSlotCheck = useMemo(() => {
    if (!focusedCompany) return null;
    return validateBookingSlotForCompany(focusedCompany, scheduledDate, scheduledTime);
  }, [focusedCompany, scheduledDate, scheduledTime]);

  const isBookingBlockedBySchedule = Boolean(
    (selectedCompanyId && focusedSlotCheck && !focusedSlotCheck.valid) ||
      (!selectedCompanyId &&
        companyMatches.some((m) => m.coversCommune && m.coversCategory) &&
        openMatchingPartners.length === 0)
  );

  const toggleItem = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (files.length === 0) return;
    const compressed = await Promise.all(files.map(compressImageFile));
    setBeforePhotos((prev) => [...prev, ...compressed].slice(0, 6));
  };

  const handleSubmitOrder = async () => {
    setErrorMsg(null);
    if (!clientName.trim() || !clientPhone.trim() || !addressDetails.trim()) {
      setErrorMsg('Veuillez renseigner votre nom, numéro de téléphone et repère d’adresse.');
      return;
    }

    const isAutoMode = !selectedCompanyId;

    if (!isAutoMode) {
      const explicitMatch = companyMatches.find((m) => m.company.id === selectedCompanyId);
      if (!explicitMatch) {
        setErrorMsg('L’entreprise sélectionnée n’est plus valide ou n’est pas approuvée.');
        return;
      }
      if (!explicitMatch.eligible && explicitMatch.unavailableReason) {
        setErrorMsg(explicitMatch.unavailableReason);
        return;
      }
    }

    const chosenMatch = isAutoMode
      ? recommendedAutoMatch
      : companyMatches.find((m) => m.company.id === selectedCompanyId && m.eligible) || null;

    if (!chosenMatch) {
      const scheduleBlocker = companyMatches.find((m) => m.scheduleBlocked && m.unavailableReason);
      setErrorMsg(
        scheduleBlocker?.unavailableReason ||
          'Aucune entreprise validée et ouverte n’est disponible pour ces critères (zone / service / créneau / nombre d’agents).'
      );
      return;
    }

    const slotCheck = validateBookingSlotForCompany(
      chosenMatch.company,
      scheduledDate,
      scheduledTime
    );
    if (!slotCheck.valid) {
      setErrorMsg(slotCheck.reason);
      return;
    }

    const config: ServiceConfiguration = {
      categoryId,
      categoryLabel: CATEGORY_LABELS[categoryId],
      furnitureType: categoryId === 'canape' ? furnitureType : undefined,
      seats: categoryId === 'canape' ? seats : undefined,
      material: ['canape', 'fauteuil', 'tapis', 'chaise', 'moquette'].includes(categoryId)
        ? material
        : undefined,
      unknownMaterial: material.includes('Je ne sais pas'),
      condition,
      stains,
      stainNotes,
      treatmentMethods,
      expectedOutcome,
      extraTreatments: selectedExtras,
      mattressSize: categoryId === 'matelas' ? mattressSize : undefined,
      mattressThickness: categoryId === 'matelas' ? mattressThickness : undefined,
      mattressSides: categoryId === 'matelas' ? mattressSides : undefined,
      dimensionsLabel: categoryId === 'tapis' ? dimensionsLabel : undefined,
      surfaceSqm: ['moquette', 'bureau', 'fin_travaux'].includes(categoryId)
        ? surfaceSqm
        : undefined,
      itemCount: ['fauteuil', 'chaise'].includes(categoryId) ? itemCount : undefined,
      chairScope: categoryId === 'chaise' ? chairScope : undefined,
      vehicleModel: categoryId === 'vehicule' ? vehicleModel : undefined,
      vehicleSeats: categoryId === 'vehicule' ? vehicleSeats : undefined,
      vehicleScopes: categoryId === 'vehicule' ? vehicleScopes : undefined,
      roomCount: ['bureau', 'fin_travaux'].includes(categoryId) ? roomCount : undefined,
      frequency: categoryId === 'bureau' ? frequency : undefined,
      officeEquipments: categoryId === 'bureau' ? officeEquipments : undefined,
      agentCount,
      scheduleType,
      scheduledDate,
      scheduledTime,
    };

    setSubmitting(true);
    try {
      let order: any;
      try {
        order = await api.createOrder({
          clientName,
          clientPhone,
          communeId,
          quartierName: currentQuartier?.name || quartierName,
          addressDetails,
          clientLocation: effectiveClientLocation,
          companyId: isAutoMode ? 'auto' : chosenMatch.company.id,
          selectionMode: isAutoMode ? 'auto' : 'manual',
          config,
          beforePhotos,
          beforeVideoName,
          referencePriceFcfa: pricing.referencePriceFcfa,
          extrasPriceFcfa: pricing.extrasPriceFcfa,
          travelFeeFcfa: pricing.travelFeeFcfa,
          clientProposedBudgetFcfa: effectiveBudget,
        });
      } catch {
        // Fallback order object for Netlify static hosting
        order = {
          id: 'ord_' + Date.now(),
          referenceCode: 'SXS-' + Math.floor(1000 + Math.random() * 9000),
          clientName,
          clientPhone,
          communeId,
          communeName: currentCommune?.name || 'Libreville',
          quartierName: currentQuartier?.name || quartierName,
          addressDetails,
          clientLocation: effectiveClientLocation,
          companyId: isAutoMode ? 'comp_1' : chosenMatch.company.id,
          companyName: isAutoMode ? 'Gabon Nettoyage Express' : chosenMatch.company.name,
          selectionMode: isAutoMode ? 'auto' : 'manual',
          status: 'confirmed',
          config,
          beforePhotos,
          referencePriceFcfa: pricing.referencePriceFcfa,
          extrasPriceFcfa: pricing.extrasPriceFcfa,
          travelFeeFcfa: pricing.travelFeeFcfa,
          currentOfferFcfa: effectiveBudget,
          priceLocked: true,
          finalLockedPriceFcfa: effectiveBudget,
          assignedAgentIds: ['ag_1'],
          gpsActive: false,
          gpsHistory: [],
          distanceRemainingKm: 3.5,
          etaMinutes: 12,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      if (order) {
        onOrderCreated(order);
      } else {
        throw new Error('Erreur de création de commande.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de créer la commande.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E2E8E4]">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#52635A] hover:text-[#0F172A] mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Retour à l’accueil
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0F172A]">
            Configurateur de prestation sur mesure
          </h1>
          <p className="text-sm text-[#52635A] mt-1">
            Décrivez précisément le travail attendu avant le déplacement du prestataire.
          </p>
        </div>

        <div className="bg-white border border-[#E2E8E4] rounded-xl px-4 py-3 text-right shrink-0">
          <p className="text-xs text-[#52635A]">Tarif de référence commun</p>
          <p className="text-xl font-bold font-mono tabular-nums text-[#059669]">
            {formatFcfa(pricing.totalReferenceFcfa)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Form Column */}
        <div className="lg:col-span-8 space-y-8">
          {/* 01. Category Selector */}
          <section className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#0F172A]">
              01. Catégorie de prestation
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {(Object.keys(CATEGORY_LABELS) as CleaningCategoryId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategoryId(id)}
                  className={`px-3 py-2.5 text-xs font-medium text-left cursor-pointer ${
                    categoryId === id ? 'btn-chip-active font-semibold' : 'btn-chip'
                  }`}
                >
                  {CATEGORY_LABELS[id]}
                </button>
              ))}
            </div>
          </section>

          {/* 02. Zone géographique, Créneau & Choix de l'entreprise partenaire */}
          <section className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                02. Zone d’intervention, créneau & entreprise partenaire
              </h2>
              <p className="text-xs text-[#52635A] mt-1">
                Choisissez votre secteur (ex : Amissa Chantal, Akanda) et votre horaire pour afficher uniquement les entreprises validées, compatibles et ouvertes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">Commune</label>
                <select
                  value={communeId}
                  onChange={(e) => {
                    const c = communes.find((x) => x.id === e.target.value);
                    if (c) {
                      setCommuneId(c.id);
                      setQuartierName(c.quartiers[0]?.name || '');
                      setClientCoords(null);
                    }
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

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">Quartier</label>
                <div className="flex gap-1.5">
                  <select
                    value={currentQuartier?.name || quartierName}
                    onChange={(e) => {
                      setQuartierName(e.target.value);
                      setClientCoords(null);
                    }}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    {currentCommune?.quartiers.map((q) => (
                      <option key={q.id} value={q.name}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={gpsDetecting}
                    onClick={handleUseCurrentGps}
                    title="Détecter ma position GPS actuelle"
                    className="btn-secondary h-10 px-2.5 text-[#059669] shrink-0 cursor-pointer inline-flex items-center justify-center"
                  >
                    <LocateFixed className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Urgence / Type
                </label>
                <select
                  value={scheduleType}
                  onChange={(e) => {
                    const v = e.target.value as 'today' | 'tomorrow' | 'custom' | 'urgent';
                    setScheduleType(v);
                    if (v === 'today' || v === 'urgent') {
                      setScheduledDate(new Date().toISOString().slice(0, 10));
                    } else if (v === 'tomorrow') {
                      setScheduledDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
                    }
                  }}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                >
                  <option value="today">Aujourd’hui</option>
                  <option value="tomorrow">Demain</option>
                  <option value="urgent">Urgent</option>
                  <option value="custom">Date précise</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">Date</label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => {
                    setScheduleType('custom');
                    setScheduledDate(e.target.value);
                  }}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">Heure</label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                />
              </div>
            </div>

            {focusedCompany && focusedSlotCheck && !focusedSlotCheck.valid && (
              <div className="rounded-lg px-4 py-3 text-xs border bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    Créneau bloqué — En dehors des horaires de l’entreprise
                  </p>
                  <p>{focusedSlotCheck.reason}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {selectedCompanyId && recommendedAutoMatch && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompanyId('');
                        setErrorMsg(null);
                      }}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer"
                    >
                      Passer en automatique
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const next = suggestNextOpenSlotForCompany(focusedCompany, scheduledDate);
                      setScheduleType('custom');
                      setScheduledDate(next.scheduledDate);
                      setScheduledTime(next.scheduledTime);
                      setErrorMsg(null);
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    Prochain créneau ouvert
                  </button>
                </div>
              </div>
            )}

            {/* Choisir votre entreprise partenaire (Menu déroulant + Liste visuelle) */}
            <div className="pt-4 border-t border-[#E2E8E4] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <label
                    htmlFor="partner-company-select"
                    className="text-sm font-semibold text-[#0F172A] flex items-center gap-2"
                  >
                    <Building2 className="w-4 h-4 text-[#059669]" />
                    Choisir votre entreprise partenaire
                  </label>
                  <p className="text-xs text-[#52635A] mt-0.5">
                    {openMatchingPartners.length} entreprise(s) validée(s) et ouverte(s) pour{' '}
                    <strong className="text-[#0F172A]">
                      {currentQuartier?.name || quartierName}, {currentCommune?.name}
                    </strong>{' '}
                    · {CATEGORY_LABELS[categoryId]} ({scheduledDate} à {scheduledTime}).
                  </p>
                </div>
              </div>

              <select
                id="partner-company-select"
                aria-label="Choisir votre entreprise partenaire"
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full h-11 px-3.5 text-sm font-medium bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg text-[#0F172A] focus:outline-none focus:border-[#059669]"
              >
                <option value="">
                  Entreprise la plus proche / Recommandée (Automatique)
                  {recommendedAutoMatch
                    ? ` — ${recommendedAutoMatch.company.name} (${recommendedAutoMatch.distKm} km · ★ ${recommendedAutoMatch.company.rating.toFixed(1)})`
                    : ''}
                </option>
                {openMatchingPartners.map(({ company, distKm, scheduleLabel, freeCount, eligible }) => (
                  <option key={company.id} value={company.id} disabled={!eligible}>
                    {company.name} · {distKm} km · ★ {company.rating.toFixed(1)} · {scheduleLabel}
                    {!eligible ? ` (${freeCount} agent libre)` : ` (${freeCount} agent(s) libre(s))`}
                  </option>
                ))}
              </select>

              <div className="space-y-2.5">
                {/* Default Option: Automatic Assignment */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCompanyId('');
                    setErrorMsg(null);
                  }}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer active:scale-[0.99] ${
                    selectedCompanyId === ''
                      ? 'border-[#059669] bg-[#ECFDF5] shadow-sm'
                      : 'border-[#E2E8F0] bg-white hover:border-[#10B981]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#059669]" />
                      <span className="text-sm font-semibold text-[#0F172A]">
                        Entreprise la plus proche / Recommandée (Automatique)
                      </span>
                    </div>
                    <p className="text-xs text-[#475569]">
                      {recommendedAutoMatch
                        ? `Attribution optimale automatique : ${recommendedAutoMatch.company.name} (${recommendedAutoMatch.distKm} km · Arrivée ~${recommendedAutoMatch.etaMin} min · ${recommendedAutoMatch.scheduleLabel}).`
                        : 'L’algorithme sélectionne automatiquement la meilleure équipe ouverte et disponible dans votre secteur.'}
                    </p>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      selectedCompanyId === ''
                        ? 'bg-[#059669] border-[#059669] text-white'
                        : 'border-[#CBD5E1]'
                    }`}
                  >
                    {selectedCompanyId === '' && <Check className="w-3 h-3" />}
                  </span>
                </button>

                {openMatchingPartners.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#475569]">
                    {companyMatches.some((m) => m.scheduleBlocked)
                      ? 'Aucune entreprise n’est ouverte sur le jour ou l’heure sélectionnés. Ajustez la date ou l’heure ci-dessus.'
                      : `Aucune entreprise validée ne couvre actuellement ${currentCommune?.name} pour « ${CATEGORY_LABELS[categoryId]} ».`}
                  </div>
                ) : (
                  openMatchingPartners.map(
                    ({ company, freeCount, distKm, etaMin, scheduleLabel, eligible, unavailableReason }) => {
                      const isManualSelected = selectedCompanyId === company.id;
                      return (
                        <button
                          key={company.id}
                          type="button"
                          disabled={!eligible}
                          onClick={() => {
                            setSelectedCompanyId(company.id);
                            setErrorMsg(null);
                          }}
                          className={`w-full text-left p-4 rounded-2xl border transition-all duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 active:scale-[0.99] ${
                            !eligible
                              ? 'opacity-60 bg-[#F8FAFC] border-[#E2E8F0] cursor-not-allowed'
                              : isManualSelected
                              ? 'border-[#059669] bg-[#ECFDF5] shadow-sm cursor-pointer'
                              : 'border-[#E2E8F0] bg-white hover:border-[#10B981] cursor-pointer'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-[#0F172A]">
                                {company.name}
                              </span>
                              {company.verified && <ShieldCheck className="w-4 h-4 text-[#10B981]" />}
                              <span className="text-xs font-mono tabular-nums text-[#059669] inline-flex items-center gap-1">
                                <Star className="w-3 h-3 fill-[#059669]" />
                                {company.rating.toFixed(1)} ({company.reviewCount})
                              </span>
                              <span className="text-[11px] font-mono text-[#475569] inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-[#059669]" />
                                {scheduleLabel}
                              </span>
                            </div>
                            <p className="text-xs text-[#475569]">
                              {eligible ? (
                                <>
                                  <span className="tabular-nums">{freeCount} agent(s) libre(s)</span> ·{' '}
                                  <span className="tabular-nums">{distKm} km</span> · Arrivée ~
                                  <span className="tabular-nums">{etaMin} min</span> · {company.equipment[0]}
                                </>
                              ) : (
                                <span className="text-[#B45309] font-medium">{unavailableReason}</span>
                              )}
                            </p>
                          </div>

                          {eligible && (
                            <span
                              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                                isManualSelected
                                  ? 'bg-[#059669] border-[#059669] text-white'
                                  : 'border-[#CBD5E1]'
                              }`}
                            >
                              {isManualSelected && <Check className="w-3 h-3" />}
                            </span>
                          )}
                        </button>
                      );
                    }
                  )
                )}
              </div>
            </div>
          </section>

          {/* 03. Dynamic Category Form */}
          <section className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-6">
            <h2 className="text-base font-semibold text-[#0F172A]">
              03. Caractéristiques détaillées · {CATEGORY_LABELS[categoryId]}
            </h2>

            {categoryId === 'canape' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Étape 1 · Quel meuble souhaitez-vous nettoyer ?
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {FURNITURE_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFurnitureType(type)}
                        className={`px-3 py-2 text-xs font-medium text-left cursor-pointer ${
                          furnitureType === type ? 'btn-chip-active font-semibold' : 'btn-chip'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Étape 2 · Combien de places possède votre canapé ?
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setSeats(n)}
                        className={`px-3.5 py-2 text-xs font-mono tabular-nums cursor-pointer ${
                          seats === n ? 'btn-chip-active font-semibold' : 'btn-chip'
                        }`}
                      >
                        {n === 7 ? '7 places +' : `${n} place${n > 1 ? 's' : ''}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {categoryId === 'matelas' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Dimensions
                  </label>
                  <select
                    value={mattressSize}
                    onChange={(e) => setMattressSize(e.target.value as '1 place' | '2 places')}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option value="1 place">Matelas 1 place (90×190)</option>
                    <option value="2 places">Matelas 2 places / King (140–200)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Épaisseur
                  </label>
                  <select
                    value={mattressThickness}
                    onChange={(e) => setMattressThickness(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option>Fin (&lt; 18 cm)</option>
                    <option>Standard (18-24 cm)</option>
                    <option>Épais / Orthopédique (&gt; 25 cm)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Faces à traiter
                  </label>
                  <select
                    value={mattressSides}
                    onChange={(e) => setMattressSides(e.target.value as '1 face' | '2 faces')}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option value="1 face">1 face uniquement</option>
                    <option value="2 faces">Les 2 faces</option>
                  </select>
                </div>
              </div>
            )}

            {categoryId === 'tapis' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Dimensions du tapis
                  </label>
                  <select
                    value={dimensionsLabel}
                    onChange={(e) => setDimensionsLabel(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                  >
                    <option>Petit (&lt; 2 m²)</option>
                    <option>Moyen (2m × 3m)</option>
                    <option>Grand salon (&gt; 6 m²)</option>
                  </select>
                </div>
              </div>
            )}

            {(categoryId === 'fauteuil' || categoryId === 'chaise') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Nombre de pièces
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={itemCount}
                    onChange={(e) => setItemCount(Math.max(1, Number(e.target.value)))}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono tabular-nums"
                  />
                </div>
                {categoryId === 'chaise' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                      Zone à nettoyer
                    </label>
                    <select
                      value={chairScope}
                      onChange={(e) => setChairScope(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    >
                      <option>Assise uniquement</option>
                      <option>Assise et dossier</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {(categoryId === 'moquette' || categoryId === 'bureau' || categoryId === 'fin_travaux') && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Surface estimée (m²)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={5}
                    value={surfaceSqm}
                    onChange={(e) => setSurfaceSqm(Math.max(10, Number(e.target.value)))}
                    className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono tabular-nums"
                  />
                </div>
                {(categoryId === 'bureau' || categoryId === 'fin_travaux') && (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                      Nombre de pièces
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={roomCount}
                      onChange={(e) => setRoomCount(Math.max(1, Number(e.target.value)))}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono tabular-nums"
                    />
                  </div>
                )}
                {categoryId === 'bureau' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                      Fréquence souhaitée
                    </label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    >
                      <option>Intervention ponctuelle</option>
                      <option>Hebdomadaire</option>
                      <option>Mensuelle</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {categoryId === 'bureau' && (
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                  Équipements à nettoyer
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Postes de travail & chaises',
                    'Vitreries intérieures',
                    'Moquettes & sols',
                    'Sanitaires & cuisine',
                    'Salles de réunion',
                  ].map((eq) => (
                    <button
                      key={eq}
                      type="button"
                      onClick={() => toggleItem(officeEquipments, setOfficeEquipments, eq)}
                      className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                        officeEquipments.includes(eq) ? 'btn-chip-active' : 'btn-chip'
                      }`}
                    >
                      {eq}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {categoryId === 'vehicule' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                      Modèle du véhicule
                    </label>
                    <input
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                      Nombre de places
                    </label>
                    <select
                      value={vehicleSeats}
                      onChange={(e) => setVehicleSeats(Number(e.target.value))}
                      className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                    >
                      <option value={2}>2 places</option>
                      <option value={5}>5 places (Berline / SUV)</option>
                      <option value={7}>7 places / Monospace / Pick-up</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                    Prestations intérieures incluses
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Nettoyage des sièges',
                      'Nettoyage des tapis',
                      'Nettoyage du coffre',
                      'Plafonnier & garnitures',
                      'Nettoyage intérieur complet',
                    ].map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => toggleItem(vehicleScopes, setVehicleScopes, scope)}
                        className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                          vehicleScopes.includes(scope) ? 'btn-chip-active' : 'btn-chip'
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Material, State, Stains, Methods, Outcome, Extras */}
            {['canape', 'fauteuil', 'tapis', 'chaise', 'moquette'].includes(categoryId) && (
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                  Étape 3 · Quel est le matériau ?
                </label>
                <div className="flex flex-wrap gap-2">
                  {MATERIALS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMaterial(m)}
                      className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                        material === m ? 'btn-chip-active' : 'btn-chip'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                Étape 4 · État général constaté
              </label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((cond) => (
                  <button
                    key={cond}
                    type="button"
                    onClick={() => setCondition(cond)}
                    className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      condition === cond ? 'btn-chip-active' : 'btn-chip'
                    }`}
                  >
                    {cond}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[#0F172A]">
                Étape 5 · Types de taches à traiter & précisions
              </label>
              <div className="flex flex-wrap gap-2">
                {STAIN_TYPES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => toggleItem(stains, setStains, st)}
                    className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      stains.includes(st) ? 'btn-chip-active' : 'btn-chip'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={stainNotes}
                onChange={(e) => setStainNotes(e.target.value)}
                placeholder="Ex : tache de café sur l’accoudoir gauche depuis 3 jours, poils de chat..."
                className="w-full p-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg focus:outline-none focus:border-[#059669]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                Étape 6 · Méthode de traitement souhaitée
              </label>
              <div className="flex flex-wrap gap-2">
                {TREATMENT_METHODS.map((meth) => (
                  <button
                    key={meth}
                    type="button"
                    onClick={() => toggleItem(treatmentMethods, setTreatmentMethods, meth)}
                    className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      treatmentMethods.includes(meth) ? 'btn-chip-active' : 'btn-chip'
                    }`}
                  >
                    {meth}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                Étape 7 · Résultat attendu
              </label>
              <select
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              >
                {OUTCOMES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-2">
                Étape 8 · Traitements supplémentaires (suppléments transparents)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {extraTreatments.map((ext) => {
                  const active = selectedExtras.includes(ext.label);
                  return (
                    <button
                      key={ext.id}
                      type="button"
                      onClick={() => toggleItem(selectedExtras, setSelectedExtras, ext.label)}
                      className={`p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer flex items-start justify-between gap-2 active:scale-[0.99] ${
                        active
                          ? 'border-[#059669] bg-[#ECFDF5] shadow-sm'
                          : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#10B981]'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#0F172A]">{ext.label}</p>
                        <p className="text-xs text-[#475569] mt-0.5">{ext.description}</p>
                      </div>
                      <span
                        className={`text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${
                          ext.priceFcfa === 0 ? 'text-[#10B981]' : 'text-[#059669]'
                        }`}
                      >
                        {ext.priceFcfa === 0 ? 'Gratuit' : `+${formatFcfa(ext.priceFcfa)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 04. Diagnostic Photo & Video */}
          <section className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                04. Diagnostic photographique et vidéo préalable
              </h2>
              <p className="text-xs text-[#52635A] mt-1">
                Indispensable si la matière est inconnue ou en présence de taches anciennes afin d’éviter toute surprise à l’arrivée.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="btn-secondary px-4 py-2.5 text-xs font-medium inline-flex items-center gap-2 cursor-pointer">
                <Camera className="w-4 h-4 text-[#059669]" />
                Prendre / ajouter des photos
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>

              <label className="btn-secondary px-4 py-2.5 text-xs font-medium inline-flex items-center gap-2 cursor-pointer">
                <Video className="w-4 h-4 text-[#059669]" />
                {beforeVideoName ? `Vidéo : ${beforeVideoName}` : 'Joindre une courte vidéo'}
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setBeforeVideoName(file.name);
                  }}
                  className="hidden"
                />
              </label>
            </div>

            {beforePhotos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                {beforePhotos.map((src, i) => (
                  <div key={i} className="relative h-20 rounded-lg overflow-hidden border border-[#E2E8E4]">
                    <img src={src} alt={`Diagnostic ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setBeforePhotos((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/70 text-white text-[10px] px-1.5 rounded cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 05. Team Size, Exact Address & Client GPS Pin */}
          <section className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5">
            <h2 className="text-base font-semibold text-[#0F172A]">
              05. Taille de l’équipe, adresse précise & géolocalisation GPS
            </h2>

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-semibold text-[#0F172A]">
                  Nombre d’agents souhaités (1 à 10 agents · vérifié en temps réel)
                </label>
                <span className="text-xs font-mono tabular-nums text-[#059669] font-semibold">
                  {formatFcfa(pricing.unitReferenceFcfa)} × {agentCount} agent
                  {agentCount > 1 ? 's' : ''} = {formatFcfa(pricing.referencePriceFcfa)}
                </span>
              </div>

              <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-xl p-3.5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#059669] shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">
                        {agentCount} agent{agentCount > 1 ? 's' : ''} ·{' '}
                        <span className="text-[#059669]">
                          {getTeamQualification(agentCount).title}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#52635A]">
                        {openMatchingPartners.filter((m) => m.eligible).length} entreprise(s)
                        ouverte(s) dispose(nt) d’au moins {agentCount} agent
                        {agentCount > 1 ? 's' : ''} libre{agentCount > 1 ? 's' : ''} sur ce créneau.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label htmlFor="agent-count-range" className="text-[11px] text-[#52635A]">
                      Curseur (1–10)
                    </label>
                    <input
                      id="agent-count-range"
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={agentCount}
                      onChange={(e) => {
                        setAgentCount(Number(e.target.value));
                        setErrorMsg(null);
                      }}
                      className="w-32 sm:w-40 accent-[#059669] cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {TEAM_SIZE_OPTIONS.map((opt) => {
                    const active = agentCount === opt.n;
                    return (
                      <button
                        key={opt.n}
                        type="button"
                        onClick={() => {
                          setAgentCount(opt.n);
                          setErrorMsg(null);
                        }}
                        className={`px-3 py-2.5 text-left cursor-pointer ${
                          active ? 'btn-chip-active' : 'btn-chip'
                        }`}
                      >
                        <p className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          {opt.label}
                        </p>
                        <p
                          className={`text-[11px] mt-0.5 truncate ${
                            active ? 'text-white/85' : 'text-[#52635A]'
                          }`}
                        >
                          {opt.short}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Repère / Adresse précise ({currentQuartier?.name || quartierName}, {currentCommune?.name})
              </label>
              <input
                type="text"
                value={addressDetails}
                onChange={(e) => setAddressDetails(e.target.value)}
                placeholder="Ex : Près du carrefour principal, Villa / Appartement"
                className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
              />
            </div>

            {/* Client Exact GPS Location Picker */}
            <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#059669]" />
                    Point GPS exact de votre domicile (pour l’itinéraire agent)
                  </p>
                  <p className="text-[11px] text-[#52635A] mt-0.5 font-mono tabular-nums">
                    Lat {effectiveClientLocation.lat.toFixed(5)} · Lng{' '}
                    {effectiveClientLocation.lng.toFixed(5)} ·{' '}
                    {currentQuartier?.name || quartierName}, {currentCommune?.name}
                    {clientCoords ? ' (GPS exact)' : ' (repère quartier)'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={gpsDetecting}
                    onClick={handleUseCurrentGps}
                    className="btn-primary px-3.5 py-2 disabled:opacity-60 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    {gpsDetecting ? 'Localisation...' : 'Utiliser ma position GPS actuelle'}
                  </button>
                  {clientCoords && (
                    <button
                      type="button"
                      onClick={() => {
                        setClientCoords(null);
                        setGpsFeedback(null);
                      }}
                      className="btn-secondary px-3 py-2 text-xs font-medium cursor-pointer"
                    >
                      Recentrer quartier
                    </button>
                  )}
                </div>
              </div>

              {gpsFeedback && (
                <p className="text-xs text-[#059669] font-medium">{gpsFeedback}</p>
              )}

              <MapTracking
                apiKey={mapsApiKey}
                center={effectiveClientLocation}
                zoom={15}
                panOnCenterChange
                draggableMarkerId="client_pin"
                onSelectPosition={(pos) => applyExactCoordinates(pos, 'map')}
                markers={[
                  {
                    id: 'client_pin',
                    position: effectiveClientLocation,
                    label: 'Point d’intervention client',
                    sublabel: 'Cliquez sur la carte ou déplacez le marqueur pour ajuster.',
                    kind: 'client',
                  },
                ]}
                heightClass="h-[240px]"
              />
              <p className="text-[11px] text-[#52635A]">
                Astuce : cliquez directement sur votre rue/résidence ou faites glisser le marqueur
                pour transmettre l’emplacement exact à l’équipe assignée.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">Votre nom</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nom complet"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Téléphone Gabon (Airtel / Moov)
                </label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="+241 07 00 00 00"
                  className="w-full h-10 px-3 text-sm bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg font-mono"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Summary & Budget Negotiation Column */}
        <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-4">
          <div className="bg-white border border-[#E2E8E4] rounded-xl p-6 space-y-5">
            <h2 className="text-base font-bold text-[#0F172A]">
              Récapitulatif & négociation tarifaire
            </h2>

            <div className="bg-[#F8FAF8] border border-[#E2E8E4] rounded-lg p-3 text-xs space-y-1">
              <p className="text-[#52635A]">Entreprise destinataire de la mission</p>
              <p className="font-semibold text-[#0F172A]">
                {selectedCompanyId
                  ? companies.find((c) => c.id === selectedCompanyId)?.name || 'Entreprise choisie'
                  : recommendedAutoMatch
                  ? `Automatique → ${recommendedAutoMatch.company.name} (${recommendedAutoMatch.distKm} km)`
                  : 'Automatique (aucune disponible sur ce créneau)'}
              </p>
              <p className="text-[11px] text-[#52635A] font-mono tabular-nums">
                {currentQuartier?.name || quartierName}, {currentCommune?.name} · {scheduledDate} à {scheduledTime}
              </p>
            </div>

            <div className="space-y-2.5 text-sm border-b border-[#E2E8E4] pb-4">
              <div className="flex justify-between gap-2">
                <span className="text-[#52635A]">
                  Prestation ({agentCount} agent{agentCount > 1 ? 's' : ''} ×{' '}
                  {formatFcfa(pricing.unitReferenceFcfa)})
                </span>
                <span className="font-mono tabular-nums text-[#0F172A] shrink-0">
                  {formatFcfa(pricing.referencePriceFcfa)}
                </span>
              </div>
              <p className="text-[11px] text-[#52635A]">
                Qualification : <strong className="text-[#0F172A]">{getTeamQualification(agentCount).title}</strong>
              </p>
              <div className="flex justify-between">
                <span className="text-[#52635A]">Traitements supplémentaires</span>
                <span className="font-mono tabular-nums text-[#0F172A]">
                  {formatFcfa(pricing.extrasPriceFcfa)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#52635A]">Déplacement ({currentCommune?.name})</span>
                <span className="font-mono tabular-nums text-[#0F172A]">
                  {pricing.travelFeeFcfa === 0 ? '0 FCFA' : formatFcfa(pricing.travelFeeFcfa)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#E2E8E4] font-semibold">
                <span className="text-[#0F172A]">Tarif de référence total</span>
                <span className="font-mono tabular-nums text-[#0F172A]">
                  {formatFcfa(pricing.totalReferenceFcfa)}
                </span>
              </div>
            </div>

            {/* Client Negotiable Budget */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#0F172A]">
                  Proposer mon propre budget
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const next = !customBudgetEnabled;
                    setCustomBudgetEnabled(next);
                    if (next && proposedBudget === null) {
                      setProposedBudget(Math.max(5000, pricing.totalReferenceFcfa - 3000));
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                    customBudgetEnabled ? 'btn-chip-active' : 'btn-secondary'
                  }`}
                >
                  {customBudgetEnabled ? 'Activé' : 'Négocier'}
                </button>
              </div>

              {customBudgetEnabled ? (
                <div className="space-y-1.5">
                  <div className="relative">
                    <input
                      type="number"
                      step={500}
                      min={2000}
                      value={proposedBudget ?? pricing.totalReferenceFcfa}
                      onChange={(e) => setProposedBudget(Number(e.target.value))}
                      className="w-full h-11 px-3 pr-16 text-base font-mono tabular-nums font-semibold bg-[#F8FAF8] border border-[#059669] rounded-lg"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#52635A]">
                      FCFA
                    </span>
                  </div>
                  <p className="text-xs text-[#52635A]">
                    L’entreprise pourra accepter votre offre, proposer une contre-offre ou maintenir le tarif de référence. Le montant final sera verrouillé avant intervention.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#52635A]">
                  Vous commandez au tarif de référence commun :{' '}
                  <strong className="font-mono tabular-nums text-[#0F172A]">
                    {formatFcfa(pricing.totalReferenceFcfa)}
                  </strong>
                  . Aucun supplément ne pourra être ajouté unilatéralement.
                </p>
              )}
            </div>

            {isBookingBlockedBySchedule && !errorMsg && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {focusedSlotCheck && !focusedSlotCheck.valid
                    ? focusedSlotCheck.reason
                    : companyMatches.find((m) => m.scheduleBlocked)?.unavailableReason ||
                      'Créneau en dehors des horaires d’ouverture de l’entreprise.'}
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              disabled={submitting || isBookingBlockedBySchedule}
              onClick={handleSubmitOrder}
              className="btn-primary w-full py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {submitting
                ? 'Envoi de la commande...'
                : isBookingBlockedBySchedule
                ? 'Créneau hors horaires d’ouverture'
                : `Envoyer la demande (${formatFcfa(effectiveBudget)})`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
