import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  LocateFixed,
  MapPin,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { ASSET_MAP, type AssetKey } from '../lib/assets';
import { findNearestQuartier, formatFcfa, haversineKm, ORDER_STATUS_META } from '../lib/format';
import type {
  Agent,
  BroadcastRecord,
  CleaningCategoryId,
  Commune,
  CommuneId,
  Company,
  Order,
  ReferenceTariff,
  ServiceSector,
} from '../types';

interface ClientHomeProps {
  communes: Commune[];
  sectors: ServiceSector[];
  tariffs: ReferenceTariff[];
  companies: Company[];
  agents: Agent[];
  orders: Order[];
  broadcasts: BroadcastRecord[];
  selectedCommuneId: CommuneId;
  selectedQuartier: string;
  onSelectLocation: (communeId: CommuneId, quartier: string) => void;
  onLaunchConfigurator: (categoryId: CleaningCategoryId, preselectedCompanyId?: string) => void;
  onOpenOrder: (orderId: string) => void;
}

const CLEANING_CATEGORIES: {
  id: CleaningCategoryId;
  label: string;
  startingFcfa: number;
  imageKey: AssetKey;
  imageAlt: string;
  summary: string;
}[] = [
  {
    id: 'canape',
    label: 'Canapés & salons',
    startingFcfa: 10000,
    imageKey: 'sofa',
    imageAlt: 'Agent effectuant le nettoyage en profondeur par injection-extraction d’un canapé en tissu',
    summary: 'Droit, angle, L ou U · Tissu, velours, cuir, microfibre',
  },
  {
    id: 'matelas',
    label: 'Matelas & literie',
    startingFcfa: 10000,
    imageKey: 'mattress',
    imageAlt: 'Agent traitant un matelas à la vapeur pour désinfection anti-acariens',
    summary: '1 ou 2 faces · Désinfection anti-acariens et anti-odeurs',
  },
  {
    id: 'tapis',
    label: 'Tapis',
    startingFcfa: 15000,
    imageKey: 'carpetFloor',
    imageAlt: 'Technicien lavant et extrayant un grand tapis de salon avec matériel professionnel',
    summary: 'Laine, synthétique, soie · Brossage et extraction',
  },
  {
    id: 'fauteuil',
    label: 'Fauteuils',
    startingFcfa: 5000,
    imageKey: 'armchair',
    imageAlt: 'Nettoyage professionnel en profondeur d’un fauteuil rembourré',
    summary: 'Fauteuil de salon, cuir ou tissu, traitement unitaire ou lot',
  },
  {
    id: 'chaise',
    label: 'Chaises',
    startingFcfa: 8000,
    imageKey: 'office',
    imageAlt: 'Entretien et assainissement de chaises et assises de réunion ou salle à manger',
    summary: 'Assise et dossier · Salle à manger ou salle de réunion',
  },
  {
    id: 'moquette',
    label: 'Moquettes & sols',
    startingFcfa: 12000,
    imageKey: 'carpetFloor',
    imageAlt: 'Lavage et lustrage professionnel de sols et moquettes avec monobrosse et extracteur',
    summary: 'Au m² · Résidentiel, hôtels et espaces professionnels',
  },
  {
    id: 'vehicule',
    label: 'Intérieur véhicules',
    startingFcfa: 20000,
    imageKey: 'carDetailing',
    imageAlt: 'Traitement vapeur et nettoyage complet d’un habitacle et des sièges de véhicule',
    summary: 'Sièges, tapis, ciel de toit et coffre à domicile',
  },
  {
    id: 'bureau',
    label: 'Bureaux & locaux',
    startingFcfa: 30000,
    imageKey: 'office',
    imageAlt: 'Entretien de bureaux professionnels, vitrages et sols en bois',
    summary: 'Équipes multi-agents · Ponctuel ou contrat périodique',
  },
  {
    id: 'fin_travaux',
    label: 'Après travaux / déménagement',
    startingFcfa: 45000,
    imageKey: 'postRenovation',
    imageAlt: 'Brigade dédiée en tenue de chantier éliminant poussières de plâtre et résidus post-construction',
    summary: 'Remise en état complète par brigade dédiée',
  },
];

export function ClientHome({
  communes,
  sectors,
  tariffs,
  companies,
  agents,
  orders,
  broadcasts,
  selectedCommuneId,
  selectedQuartier,
  onSelectLocation,
  onLaunchConfigurator,
  onOpenOrder,
}: ClientHomeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recommended' | 'rating' | 'arrival' | 'agents'>('recommended');
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [inspectedCompanyId, setInspectedCompanyId] = useState<string | null>(null);
  const [dismissedBroadcastIds, setDismissedBroadcastIds] = useState<string[]>([]);
  const [failedImageKeys, setFailedImageKeys] = useState<Record<string, boolean>>({});

  const activeBroadcast = broadcasts.find(
    (b) =>
      !dismissedBroadcastIds.includes(b.id) &&
      (b.audience === 'all' || b.audience === 'clients') &&
      (b.communeId === 'all' || b.communeId === selectedCommuneId)
  );

  const currentCommune = communes.find((c) => c.id === selectedCommuneId) || communes[0];
  const currentQuartierObj =
    currentCommune?.quartiers.find((q) => q.name === selectedQuartier) ||
    currentCommune?.quartiers[0];

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus('Géolocalisation indisponible sur cet appareil.');
      return;
    }
    setGeoStatus('Détection précise de votre quartier...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const match = findNearestQuartier(userPoint, communes);
        if (!match) {
          setGeoStatus('Aucune zone correspondante trouvée.');
          return;
        }
        onSelectLocation(match.commune.id, match.quartier.name);
        setGeoStatus(`Zone détectée : ${match.quartier.name}, ${match.commune.name}`);
      },
      () => {
        setGeoStatus('Position non autorisée — sélectionnez votre commune manuellement.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const approvedCompanies = useMemo(() => {
    const filtered = companies.filter((c) => {
      if (c.approvalStatus !== 'approved') return false;
      const inCommune = c.communes.includes(selectedCommuneId);
      if (!inCommune) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.equipment.some((e) => e.toLowerCase().includes(q))
      );
    });

    const enriched = filtered.map((c) => {
      const availCount = agents.filter((a) => a.companyId === c.id && a.status === 'available').length;
      const totalAgents = agents.filter((a) => a.companyId === c.id).length;
      const distKm = currentQuartierObj
        ? Number(haversineKm(c.baseLocation, currentQuartierObj).toFixed(1))
        : 3.5;
      return { company: c, availCount, totalAgents, distKm };
    });

    enriched.sort((a, b) => {
      if (sortBy === 'rating') return b.company.rating - a.company.rating;
      if (sortBy === 'arrival') return a.distKm - b.distKm;
      if (sortBy === 'agents') return b.availCount - a.availCount;
      // Recommended: balanced quality + availability + proximity
      const scoreA = a.company.rating * 20 + a.availCount * 6 - a.distKm * 2;
      const scoreB = b.company.rating * 20 + b.availCount * 6 - b.distKm * 2;
      return scoreB - scoreA;
    });

    return enriched;
  }, [companies, agents, selectedCommuneId, searchQuery, sortBy, currentQuartierObj]);

  const activeOrders = orders.filter(
    (o) => !['completed', 'cancelled'].includes(o.status)
  );

  const filteredCategories = CLEANING_CATEGORIES.filter((cat) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return cat.label.toLowerCase().includes(q) || cat.summary.toLowerCase().includes(q);
  });

  const inspectedCompany = companies.find((c) => c.id === inspectedCompanyId) || null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      {activeBroadcast && (
        <div className="bg-[#F1F5F9] border border-[#059669]/25 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Megaphone className="w-4 h-4 text-[#059669] mt-0.5 shrink-0" />
            <div className="text-xs space-y-0.5">
              <p className="font-semibold text-[#0F172A]">{activeBroadcast.title}</p>
              <p className="text-[#475569]">{activeBroadcast.body}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fermer l’annonce"
            onClick={() => setDismissedBroadcastIds((p) => [...p, activeBroadcast.id])}
            className="text-[#475569] hover:text-[#0F172A] p-1 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hero Split + Unified Search */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
          <div className="space-y-4">
            <p className="text-xs font-medium text-[#059669] tracking-wide">
              Grand Libreville · Libreville · Akanda · Owendo
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-[#0F172A] tracking-tight leading-tight text-balance">
              Services professionnels à domicile, tarif négocié et suivi GPS en direct.
            </h1>
            <p className="text-base text-[#475569] max-w-xl leading-relaxed">
              Décrivez votre besoin avec précision, proposez votre budget sur la base d’une grille
              commune transparente, comparez les entreprises vérifiées de votre commune et suivez
              l’équipe jusqu’à votre porte.
            </p>
          </div>

          {/* Search + Location Controls */}
          <div className="mt-8 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5 relative">
                <Search className="w-4 h-4 text-[#475569] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Canapé, matelas, véhicule..."
                  className="w-full h-11 pl-10 pr-3 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-[#0F172A] placeholder:text-[#475569] focus:outline-none focus:border-[#059669]"
                />
              </div>

              <div className="sm:col-span-3">
                <select
                  aria-label="Commune"
                  value={selectedCommuneId}
                  onChange={(e) => {
                    const nextC = communes.find((c) => c.id === e.target.value);
                    if (nextC) {
                      onSelectLocation(nextC.id, nextC.quartiers[0]?.name || '');
                    }
                  }}
                  className="w-full h-11 px-3 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-[#0F172A] focus:outline-none focus:border-[#059669]"
                >
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4 flex gap-2">
                <select
                  aria-label="Quartier"
                  value={selectedQuartier}
                  onChange={(e) => onSelectLocation(selectedCommuneId, e.target.value)}
                  className="w-full h-11 px-3 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-[#0F172A] focus:outline-none focus:border-[#059669]"
                >
                  {currentCommune?.quartiers.map((q) => (
                    <option key={q.id} value={q.name}>
                      {q.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleDetectLocation}
                  title="Utiliser ma position GPS"
                  className="btn-secondary h-11 px-3.5 text-[#059669] shrink-0 cursor-pointer inline-flex items-center justify-center"
                >
                  <LocateFixed className="w-4 h-4" />
                </button>
              </div>
            </div>

            {geoStatus && (
              <p className="text-xs text-[#059669] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {geoStatus}
              </p>
            )}

            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onLaunchConfigurator('canape')}
                className="btn-primary px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                Configurer un nettoyage de canapé
                <ArrowRight className="w-4 h-4" />
              </button>
              <span className="text-xs text-[#475569]">
                Déplacement {currentCommune?.name} :{' '}
                <strong className="font-mono tabular-nums text-[#0F172A]">
                  {currentCommune?.travelFeeFcfa === 0
                    ? 'Inclus'
                    : formatFcfa(currentCommune?.travelFeeFcfa || 0)}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl overflow-hidden border border-[#E2E8F0] bg-[#F1F5F9] min-h-[280px] relative">
          <img
            src={ASSET_MAP.hero}
            alt="Salon contemporain entretenu à Libreville"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 text-white">
            <p className="text-xs font-medium text-white/85">
              Standard Shine x Sanitize · Alp Group · Grand Libreville
            </p>
            <p className="text-sm font-semibold mt-0.5">
              Prix verrouillé avant le départ · Photos avant et après obligatoires
            </p>
          </div>
        </div>
      </section>

      {/* 4 Guarantees Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            title: 'Grille commune négociable',
            detail: 'Tarifs de référence identiques, budget client proposable avant validation.',
          },
          {
            title: 'Disponibilité réelle vérifiée',
            detail: 'Seules les entreprises ayant le nombre d’agents libres apparaissent.',
          },
          {
            title: 'Suivi GPS sur trottinette',
            detail: 'Localisation en direct et heure d’arrivée estimée durant le trajet.',
          },
          {
            title: 'Dossier qualité verrouillé',
            detail: 'Aucun supplément unilatéral · Paiement Airtel Money, Moov Money ou espèces.',
          },
        ].map((g) => (
          <div key={g.title} className="bg-white border border-[#E2E8F0] rounded-xl p-4">
            <p className="text-sm font-semibold text-[#0F172A]">{g.title}</p>
            <p className="text-xs text-[#475569] mt-1 leading-relaxed">{g.detail}</p>
          </div>
        ))}
      </section>

      {/* Active Reservations Banner */}
      {activeOrders.length > 0 && (
        <section className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E2E8F0]">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                Réservations en cours ({activeOrders.length})
              </h2>
              <p className="text-xs text-[#475569] mt-0.5">
                Suivez l’avancement des négociations tarifaires et l’arrivée GPS des équipes.
              </p>
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {activeOrders.map((ord) => {
              const meta = ORDER_STATUS_META[ord.status];
              return (
                <div
                  key={ord.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569]">
                      <span className="font-mono font-semibold text-[#0F172A]">
                        {ord.referenceCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{ord.config.categoryLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {ord.quartierName}, {ord.communeName}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-medium ${
                          meta.tone === 'green'
                            ? 'text-[#10B981]'
                            : meta.tone === 'red'
                            ? 'text-[#B91C1C]'
                            : 'text-[#B45309]'
                        }`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[#0F172A]">
                      {ord.companyName} —{' '}
                      <span className="font-mono tabular-nums">
                        {formatFcfa(ord.finalLockedPriceFcfa ?? ord.currentOfferFcfa)}
                      </span>
                      {ord.etaMinutes !== null && ord.gpsActive && (
                        <span className="text-xs text-[#059669] ml-2">
                          (Arrivée estimée : {ord.etaMinutes} min · {ord.distanceRemainingKm} km)
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenOrder(ord.id)}
                    className="btn-outline-green px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Ouvrir le suivi
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Service Categories + Multi-sector Roadmap */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F172A]">
              Services disponibles · Nettoyage professionnel
            </h2>
            <p className="text-sm text-[#475569] mt-1">
              Sélectionnez une prestation pour ouvrir le configurateur intelligent et obtenir le tarif de référence.
            </p>
          </div>
          <p className="text-xs text-[#475569]">
            Tarifs de base administrés · Négociables avant commande
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredCategories.map((cat) => {
            const matchingTariff = tariffs.find((t) => t.categoryId === cat.id);
            const price = matchingTariff ? matchingTariff.basePriceFcfa : cat.startingFcfa;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onLaunchConfigurator(cat.id)}
                className="group text-left bg-white border border-[#E2E8F0] hover:border-[#10B981] hover:-translate-y-0.5 hover:shadow-md rounded-2xl overflow-hidden transition-all duration-150 cursor-pointer flex flex-col"
              >
                <div className="aspect-[4/3] w-full bg-[#F1F5F9] overflow-hidden relative">
                  {failedImageKeys[cat.id] ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] text-[#059669] px-4 text-center">
                      <Sparkles className="w-6 h-6" />
                      <span className="text-xs font-semibold">{cat.label}</span>
                    </div>
                  ) : (
                    <img
                      src={ASSET_MAP[cat.imageKey]}
                      alt={cat.imageAlt}
                      loading="eager"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setFailedImageKeys((prev) => ({ ...prev, [cat.id]: true }))
                      }
                      className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-base font-semibold text-[#0F172A]">{cat.label}</h3>
                      <span className="text-xs font-mono tabular-nums text-[#059669] font-medium whitespace-nowrap">
                        dès {formatFcfa(price)}
                      </span>
                    </div>
                    <p className="text-xs text-[#475569] mt-1.5 leading-relaxed">{cat.summary}</p>
                  </div>
                  <span className="text-xs font-medium text-[#059669] inline-flex items-center gap-1">
                    Personnaliser la prestation <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Multi-sector scalability strip */}
        <div className="bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl p-5">
          <p className="text-xs font-semibold text-[#0F172A]">
            Architecture multiservices évolutive · Prochains secteurs intégrés à Shine x Sanitize (Alp Group)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
            {sectors
              .filter((s) => !s.active)
              .map((s) => (
                <div key={s.id} className="bg-white border border-[#E2E8F0] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[#0F172A]">{s.name}</p>
                  <p className="text-xs text-[#475569] mt-1">{s.subtitle}</p>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* Company Comparator by Commune */}
      <section className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F172A]">
              Entreprises vérifiées à {currentCommune?.name} ({approvedCompanies.length})
            </h2>
            <p className="text-sm text-[#475569] mt-1">
              Comparez la disponibilité des agents, les équipements professionnels, les délais et les avis.
            </p>
          </div>

          <div className="tab-group flex items-center gap-1 self-start">
            {(
              [
                { id: 'recommended', label: 'Pertinence' },
                { id: 'rating', label: 'Mieux notées' },
                { id: 'arrival', label: 'Plus proches' },
                { id: 'agents', label: 'Agents libres' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  sortBy === opt.id ? 'tab-segment-active font-semibold' : 'tab-segment'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {approvedCompanies.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-[#0F172A]">
              Aucune entreprise active référencée à {currentCommune?.name} pour le moment
            </p>
            <p className="text-xs text-[#475569] max-w-lg mx-auto">
              Les nouvelles entreprises prestataires inscrites apparaîtront ici dès leur validation
              par l’administration centrale.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {approvedCompanies.map(({ company, availCount, totalAgents, distKm }) => (
            <div
              key={company.id}
              className="bg-white border border-[#E2E8F0] rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#1E293B] text-white font-display font-bold text-sm flex items-center justify-center shrink-0">
                      {company.initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-base font-semibold text-[#0F172A]">{company.name}</h3>
                        {company.verified && (
                          <ShieldCheck
                            className="w-4 h-4 text-[#10B981] shrink-0"
                            aria-label="Entreprise vérifiée"
                          />
                        )}
                      </div>
                      <p className="text-xs text-[#475569] mt-0.5">
                        {company.address} · <span className="tabular-nums">{distKm} km</span>
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-[#0F172A] inline-flex items-center gap-1 tabular-nums">
                      <Star className="w-3.5 h-3.5 text-[#059669] fill-[#059669]" />
                      {company.rating.toFixed(1)}
                    </p>
                    <p className="text-xs text-[#475569] tabular-nums">
                      {company.reviewCount} avis · {company.completedInterventions} missions
                    </p>
                  </div>
                </div>

                <p className="text-xs text-[#475569] leading-relaxed">{company.description}</p>

                <div className="pt-2 border-t border-[#E2E8F0] grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[#475569]">Agents libres</p>
                    <p className="font-semibold text-[#0F172A] tabular-nums mt-0.5">
                      {availCount} / {totalAgents} disponibles
                    </p>
                  </div>
                  <div>
                    <p className="text-[#475569]">Arrivée estimée</p>
                    <p className="font-semibold text-[#0F172A] tabular-nums mt-0.5">
                      ~{Math.max(12, Math.round(distKm * 3.5 + 8))} min
                    </p>
                  </div>
                  <div>
                    <p className="text-[#475569]">Horaires</p>
                    <p className="font-semibold text-[#0F172A] mt-0.5 truncate">
                      {company.workingHours}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-[#475569]">
                  <span className="font-medium text-[#0F172A]">Matériel :</span>{' '}
                  {company.equipment.slice(0, 2).join(' · ')}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() =>
                    setInspectedCompanyId(inspectedCompanyId === company.id ? null : company.id)
                  }
                  className="text-xs font-medium text-[#475569] hover:text-[#0F172A] underline underline-offset-4 cursor-pointer"
                >
                  {inspectedCompanyId === company.id ? 'Masquer la fiche' : 'Voir réalisations & avis'}
                </button>
                <button
                  type="button"
                  onClick={() => onLaunchConfigurator('canape', company.id)}
                  className="btn-primary px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Commander avec cette entreprise
                </button>
              </div>
            </div>
          ))}
        </div>
        )}

        {/* Expanded Company Profile Drawer/Panel */}
        {inspectedCompany && (
          <div className="bg-white border border-[#059669]/30 rounded-2xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A]">
                  Fiche professionnelle · {inspectedCompany.name}
                </h3>
                <p className="text-xs text-[#475569] mt-0.5">
                  Certifiée par l’administration Shine x Sanitize (Alp Group) · Zones :{' '}
                  {inspectedCompany.communes.join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedCompanyId(null)}
                className="text-xs font-medium text-[#475569] hover:text-[#0F172A] cursor-pointer"
              >
                Fermer
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {inspectedCompany.galleryKeys.map((key, idx) => (
                <div key={idx} className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-[#F1F5F9]">
                  <img
                    src={ASSET_MAP[key]}
                    alt={`Réalisation ${inspectedCompany.name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-center"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#0F172A]">Équipements & méthodes disponibles</p>
                <ul className="space-y-1 text-xs text-[#475569]">
                  {inspectedCompany.equipment.map((eq) => (
                    <li key={eq} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                      {eq}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#0F172A]">Derniers avis clients vérifiés</p>
                {inspectedCompany.reviews.length === 0 ? (
                  <p className="text-xs text-[#475569]">Aucun avis publié pour le moment.</p>
                ) : (
                  <div className="space-y-2">
                    {inspectedCompany.reviews.map((rev) => (
                      <div key={rev.id} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#0F172A]">
                            {rev.clientName} · {rev.quartier}
                          </span>
                          <span className="font-mono tabular-nums text-[#059669] font-semibold">
                            {rev.rating.toFixed(1)} / 5
                          </span>
                        </div>
                        <p className="text-xs text-[#475569] mt-1">{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
