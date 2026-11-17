/// <reference types="google.maps" />
import { useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation } from 'lucide-react';

export interface MapMarkerItem {
  id: string;
  position: { lat: number; lng: number };
  label: string;
  sublabel?: string;
  kind: 'client' | 'agent' | 'company';
}

interface RouteOverlayProps {
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
  trail?: { lat: number; lng: number }[];
}

function RoutePolylineOverlay({ origin, destination, trail }: RouteOverlayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const fitKeyRef = useState<{ key: string | null }>({ key: null })[0];
  const lastComputedOriginRef = useState<{ lat: number; lng: number } | null>(null);
  const [computedPath, setComputedPath] = useState<google.maps.LatLng[] | null>(null);

  useEffect(() => {
    if (!map) return;

    const polylines: google.maps.Polyline[] = [];

    if (trail && trail.length > 1) {
      const trailLine = new google.maps.Polyline({
        path: trail,
        geodesic: true,
        strokeColor: '#10B981',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      });
      polylines.push(trailLine);
    }

    if (origin && destination) {
      if (computedPath && computedPath.length > 0) {
        const routeLine = new google.maps.Polyline({
          path: computedPath,
          geodesic: true,
          strokeColor: '#059669',
          strokeOpacity: 0.88,
          strokeWeight: 4,
          map,
        });
        polylines.push(routeLine);
      } else {
        const directLine = new google.maps.Polyline({
          path: [origin, destination],
          geodesic: true,
          strokeColor: '#059669',
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.75, scale: 3 },
              offset: '0',
              repeat: '14px',
            },
          ],
          map,
        });
        polylines.push(directLine);
      }

      const routeKey = `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
      if (fitKeyRef.key !== routeKey) {
        fitKeyRef.key = routeKey;
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(origin);
        bounds.extend(destination);
        map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
      }
    }

    return () => {
      polylines.forEach((p) => p.setMap(null));
    };
  }, [map, origin?.lat, origin?.lng, destination?.lat, destination?.lng, trail?.length, computedPath, fitKeyRef]);

  useEffect(() => {
    if (!origin || !destination || !routesLib) return;
    const RouteClass = (
      routesLib as unknown as {
        Route?: { computeRoutes: (req: unknown) => Promise<{ routes?: Array<{ path?: google.maps.LatLng[] }> }> };
      }
    ).Route;
    if (!RouteClass) return;

    const prev = lastComputedOriginRef[0];
    if (prev) {
      const movedApproxM =
        Math.hypot(origin.lat - prev.lat, origin.lng - prev.lng) * 111320;
      if (movedApproxM < 120) return;
    }

    let cancelled = false;
    async function compute() {
      try {
        const result = await RouteClass!.computeRoutes({
          origin,
          destination,
          travelMode: 'TWO_WHEELER',
          fields: ['path'],
        });
        if (!cancelled && result.routes && result.routes.length > 0 && result.routes[0].path) {
          lastComputedOriginRef[1]({ lat: origin!.lat, lng: origin!.lng });
          setComputedPath(result.routes[0].path);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
    }

    void compute();
    return () => {
      cancelled = true;
    };
  }, [routesLib, origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  return null;
}

interface MapTrackingProps {
  apiKey: string;
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarkerItem[];
  routeOrigin?: { lat: number; lng: number };
  routeDestination?: { lat: number; lng: number };
  trail?: { lat: number; lng: number }[];
  heightClass?: string;
  onSelectPosition?: (pos: { lat: number; lng: number }) => void;
  draggableMarkerId?: string;
  panOnCenterChange?: boolean;
}

function MapCenterController({
  center,
  enabled,
}: {
  center: { lat: number; lng: number };
  enabled?: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !enabled) return;
    map.panTo(center);
  }, [map, enabled, center.lat, center.lng]);
  return null;
}

export function MapTracking({
  apiKey,
  center,
  zoom = 13,
  markers,
  routeOrigin,
  routeDestination,
  trail,
  heightClass = 'h-[360px]',
  onSelectPosition,
  draggableMarkerId,
  panOnCenterChange,
}: MapTrackingProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedMarker = markers.find((m) => m.id === selectedId) || null;

  if (!apiKey) {
    return (
      <div
        className={`${heightClass} w-full rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] flex flex-col items-center justify-center p-6 text-center`}
      >
        <Navigation className="w-6 h-6 text-[#059669] mb-2" />
        <p className="text-sm font-medium text-[#0F172A]">
          Carte GPS Grand Libreville en cours d’initialisation
        </p>
        <p className="text-xs text-[#475569] mt-1 max-w-md">
          Coordonnées suivies en direct :{' '}
          {markers.map((m) => `${m.label} (${m.position.lat.toFixed(4)}, ${m.position.lng.toFixed(4)})`).join(' · ')}
        </p>
      </div>
    );
  }

  return (
    <div className={`${heightClass} w-full rounded-2xl overflow-hidden border border-[#E2E8F0] relative`}>
      <APIProvider
        apiKey={apiKey}
        language="fr"
        region="GA"
        libraries={['marker', 'routes']}
      >
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          onClick={(e) => {
            if (onSelectPosition && e.detail.latLng) {
              onSelectPosition({
                lat: Number(e.detail.latLng.lat.toFixed(6)),
                lng: Number(e.detail.latLng.lng.toFixed(6)),
              });
            }
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <MapCenterController center={center} enabled={panOnCenterChange} />
          {markers.map((m) => {
            const pinColors =
              m.kind === 'agent'
                ? { background: '#059669', borderColor: '#047857', glyphColor: '#FFFFFF' }
                : m.kind === 'client'
                ? { background: '#0F172A', borderColor: '#1E293B', glyphColor: '#FFFFFF' }
                : { background: '#10B981', borderColor: '#059669', glyphColor: '#FFFFFF' };

            const isDraggable = Boolean(onSelectPosition && draggableMarkerId === m.id);

            return (
              <AdvancedMarker
                key={m.id}
                position={m.position}
                title={m.label}
                draggable={isDraggable}
                onDragEnd={(e) => {
                  if (isDraggable && onSelectPosition && e.latLng) {
                    onSelectPosition({
                      lat: Number(e.latLng.lat().toFixed(6)),
                      lng: Number(e.latLng.lng().toFixed(6)),
                    });
                  }
                }}
                onClick={() => setSelectedId(m.id)}
              >
                <Pin
                  background={pinColors.background}
                  borderColor={pinColors.borderColor}
                  glyphColor={pinColors.glyphColor}
                  scale={m.kind === 'agent' ? 1.15 : 1}
                />
              </AdvancedMarker>
            );
          })}

          {selectedMarker && (
            <InfoWindow
              position={selectedMarker.position}
              onCloseClick={() => setSelectedId(null)}
            >
              <div className="p-1 text-xs text-[#0F172A]">
                <p className="font-semibold flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#059669]" />
                  {selectedMarker.label}
                </p>
                {selectedMarker.sublabel && (
                  <p className="text-[#475569] mt-0.5">{selectedMarker.sublabel}</p>
                )}
              </div>
            </InfoWindow>
          )}

          {(routeOrigin && routeDestination) || (trail && trail.length > 1) ? (
            <RoutePolylineOverlay
              origin={routeOrigin}
              destination={routeDestination}
              trail={trail}
            />
          ) : null}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}
