"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geocode, type Point } from "@/lib/geo";

/**
 * A pin on the project's address, drawn with Leaflet over OpenStreetMap.
 *
 * NOT INTERACTIVE, on purpose. Every Leaflet handler is off, so a finger on the
 * map is a finger on the card behind it and the tap reaches the link that
 * opens the phone's own navigation. A leader glancing at where he is going
 * tomorrow should not be able to accidentally pan himself to Denmark, and a
 * map that swallows the tap makes the card look broken.
 *
 * The address is geocoded through lib/geo, which caches in localStorage: OSM's
 * usage policy is for light, attributed use, and a project address does not
 * move. That geocoder lives outside this file because the stamp's geofence
 * needs the same answers, and two caches on one key would eventually disagree.
 *
 * Attribution stays on. It is the condition the tiles are served under.
 */

/**
 * The marker, drawn rather than loaded.
 *
 * Leaflet's default icon resolves its own image URLs relative to the CSS,
 * which a bundler rewrites and a basePath moves again -- the classic result is
 * a map with an invisible pin. A divIcon carrying inline SVG has no URL to get
 * wrong, and it keeps the pin in the same black and white as everything else.
 */
const PIN = L.divIcon({
  className: "",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  html: `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
           <path d="M12 23s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z"
                 fill="#000" stroke="#fff" stroke-width="1.5"/>
           <circle cx="12" cy="10" r="2.6" fill="#fff"/>
         </svg>`,
});

export function ProjectMap({ address }: { address: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<Point | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const p = await geocode(address);
      if (live) setPoint(p);
    })();
    return () => { live = false; };
  }, [address]);

  useEffect(() => {
    if (!point || !box.current) return;

    const map = L.map(box.current, {
      center: [point.lat, point.lon],
      zoom: 15,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    L.marker([point.lat, point.lon], { icon: PIN, interactive: false }).addTo(map);

    return () => { map.remove(); };
  }, [point]);

  // Undefined is still looking; null is an address Nominatim could not place.
  // Neither is an error worth showing: the address is written underneath in
  // both cases, and it is the address that gets someone to the site.
  if (point === undefined) {
    return (
      <div className="h-40 w-full animate-pulse border-b-2 border-black bg-neutral-200" />
    );
  }
  if (point === null) return null;

  return (
    <div
      ref={box}
      aria-hidden
      className="h-40 w-full border-b-2 border-black [&_.leaflet-control-attribution]:text-[9px]"
    />
  );
}

export default ProjectMap;
