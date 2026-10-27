'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import { destinationMarkers, findDestination } from '@/content/destinations';
import { usePresentation } from '@/i18n/client';
import { translate } from '@/i18n/messages';
import 'leaflet/dist/leaflet.css';

export function DestinationAtlas({ initialId = 'L01' }: { initialId?: string }) {
  const { locale, t } = usePresentation();
  const [selectedId, setSelectedId] = useState<string>(findDestination(initialId)?.id ?? 'L01');
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'tiles'>('loading');
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markerRefs = useRef(new Map<string, LeafletMarker>());
  const selected = findDestination(selectedId)!;
  const selectedPoint = destinationMarkers.find(point => point.destinationId === selected.id);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('destination', id);
    // Native history integrates with Next's search-param hook and keeps language links equivalent.
    window.history.replaceState(null, '', url.pathname + url.search);
  }, []);

  useEffect(() => {
    if (!active || !container.current) return;
    let cancelled = false;
    let instance: LeafletMap | undefined;
    import('leaflet').then(L => {
      if (cancelled || !container.current) return;
      instance = L.map(container.current, { scrollWheelZoom: false, zoomControl: false, attributionControl: false });
      map.current = instance;
      L.control.zoom({ zoomInTitle: translate(locale, 'Zoom in'), zoomOutTitle: translate(locale, 'Zoom out') }).addTo(instance);
      const attribution = L.control.attribution({ prefix: false }).addTo(instance);
      attribution.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>');
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        minZoom: 3, maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin',
      }).on('tileerror', () => { if (!cancelled) setStatus('tiles'); }).addTo(instance);
      instance.fitBounds(destinationMarkers.map(point => [point.latitude, point.longitude] as [number, number]), { padding: [44, 44] });
      destinationMarkers.forEach((point, index) => {
        const destination = findDestination(point.destinationId)!;
        const marker = L.marker([point.latitude, point.longitude], {
          keyboard: true, title: point.meaning[locale],
          icon: L.divIcon({ className: `atlas-marker marker-${destination.category}`, html: `<span aria-hidden="true">${index + 1}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
        }).on('click', () => select(point.destinationId)).addTo(instance!);
        const element = marker.getElement();
        element?.setAttribute('aria-label', point.meaning[locale]);
        element?.setAttribute('aria-controls', 'atlas-selected');
        element?.addEventListener('keydown', event => {
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); select(point.destinationId); }
        });
        markerRefs.current.set(point.destinationId, marker);
      });
      setStatus(current => current === 'tiles' ? current : 'ready');
    }).catch(() => { if (!cancelled) setStatus('failed'); });
    const markers = markerRefs.current;
    return () => { cancelled = true; instance?.remove(); map.current = null; markers.clear(); };
  }, [active, locale, select]);

  useEffect(() => {
    markerRefs.current.forEach((marker, id) => {
      marker.getElement()?.setAttribute('aria-pressed', String(id === selectedId));
      marker.getElement()?.classList.toggle('is-selected', id === selectedId);
      marker.setZIndexOffset(id === selectedId ? 1000 : 0);
    });
  }, [selectedId, status]);

  const statusKey = { idle: 'Map network notice', loading: 'Map loading', ready: 'Map ready', failed: 'Map unavailable', tiles: 'Map tiles unavailable' } as const;
  return <section className="destination-atlas" aria-labelledby="atlas-title">
    <div className="atlas-heading"><h2 id="atlas-title">{t('Verified visitor sites')}</h2><p>{t('Map scope')}</p></div>
    <div className="atlas-layout">
      <div className="atlas-map-column">
        <button type="button" aria-expanded={active} aria-controls="destination-map" onClick={() => { setStatus(active ? 'idle' : 'loading'); setActive(value => !value); }}>{t(active ? 'Hide interactive map' : 'Show interactive map')}</button>
        <p className="map-status" role="status">{t(statusKey[status])}</p>
        <div id="destination-map" hidden={!active}>
          <div ref={container} className="atlas-map" role="region" aria-label={t('Verified visitor sites')} />
          <p className="map-credit"><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap">{t('Report a map issue')}</a></p>
        </div>
        <noscript><p>{t('Map unavailable')}</p></noscript>
        <p className="locality-note">{t('Locality disclosure')}</p>
      </div>
      <div className="atlas-list-column">
        <h3>{t('Around Plateliai')}</h3>
        <ol className="atlas-site-list" aria-label={t('Select a map destination')}>
          {destinationMarkers.map((point, index) => {
            const destination = findDestination(point.destinationId)!;
            return <li key={point.destinationId}><button type="button" aria-pressed={selectedId === point.destinationId} aria-controls="atlas-selected" onClick={() => select(point.destinationId)}><span className={`marker-number marker-${destination.category}`} aria-hidden="true">{index + 1}</span><span>{point.meaning[locale]}</span></button><a className="atlas-source-link" href={point.source} aria-label={t('Official visitor information for {name}', { name: point.meaning[locale] })}>{t('Official visitor information')}</a></li>;
          })}
        </ol>
        <p className="selection-status" role="status">{t('Selected destination: {name}', { name: selected.name[locale] })}</p>
        <section id="atlas-selected" className="atlas-selected" aria-labelledby="selected-title">
          <h3 id="selected-title">{selected.name[locale]}</h3><p>{selected.description[locale]}</p>
          {selectedPoint ? <p>{t('Map point meaning')}: {selectedPoint.meaning[locale]}</p> : <p>{t('No map point')}</p>}
          <a href={selected.source} aria-label={t('Official visitor information for {name}', { name: selected.name[locale] })}>{t('Official visitor information')}</a>
        </section>
      </div>
    </div>
  </section>;
}
