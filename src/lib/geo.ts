/**
 * Places, distances, and where the phone says it is.
 *
 * The geocoder was inside project-map.tsx until the stamp needed it too.
 * Copying it would have given the same addresses two caches under the same
 * localStorage key and two chances to disagree about what "not found" means,
 * so it moved here instead and the map imports it.
 */

export type Point = { lat: number; lon: number };

/**
 * A place, and how sharply Nominatim actually knows it.
 *
 * "area" is a municipality, city or county boundary -- what a vague address
 * falls back to. Asking for "Hörby" returns the KOMMUN, whose centroid can sit
 * kilometres from the site somebody is standing on, and measuring a 4 km fence
 * against that is how a worker who IS on site gets refused. The map is happy
 * with either; the fence is not, so the difference is carried rather than
 * flattened.
 */
export type Place = Point & { precision: "exact" | "area" };

// geo2, not geo: entries cached under the old key hold a bare {lat,lon} with
// no precision on it, and guessing which kind they were is worse than one
// extra lookup per address per phone.
const KEY = (address: string) => `geo2:${address}`;

/**
 * An address to a coordinate, through Nominatim, once.
 *
 * OSM's usage policy is for light, attributed use, and a project address does
 * not move -- so the answer is remembered in localStorage. A MISS IS CACHED
 * TOO, as an empty string: an address Nominatim cannot place will not become
 * placeable by asking again on every load, and hammering it for a site that
 * has no house number yet is exactly the use the policy asks people not to
 * make.
 *
 * Returns null both for "no such place" and for a lookup that could not be
 * made at all. The two are told apart by the caller only where it matters --
 * see stampGate, which needs to know whether the check ran.
 */
export async function geocode(address: string): Promise<Place | null> {
  try {
    const cached = localStorage.getItem(KEY(address));
    if (cached !== null) return cached === "" ? null : (JSON.parse(cached) as Place);
  } catch {
    // A browser with site data blocked still works; it just asks again.
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(address);

  let point: Place | null = null;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as
        { lat: string; lon: string; category?: string }[];
      const hit = body[0];
      if (hit) {
        point = {
          lat: Number(hit.lat),
          lon: Number(hit.lon),
          // category=boundary is what an administrative area comes back as --
          // municipality, city, county. Everything else (a road, a building,
          // a named place) is somewhere you can stand.
          precision: hit.category === "boundary" ? "area" : "exact",
        };
      }
    }
  } catch {
    // Offline, blocked, or rate-limited. NOT cached -- unlike a genuine miss,
    // this says nothing about the address and would poison the entry.
    return null;
  }

  try {
    localStorage.setItem(KEY(address), point ? JSON.stringify(point) : "");
  } catch {
    // The lookup succeeded; only the remembering failed.
  }
  return point;
}

/**
 * Great-circle distance in kilometres.
 *
 * Haversine on a sphere of 6371 km. Wrong by up to about half a percent
 * against the real ellipsoid, which at a 4 km threshold is twenty metres --
 * far inside the error of a phone's own fix, and not worth a heavier formula.
 */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Where the phone says it is, or null if it will not say.
 *
 * Refusal and failure are one answer on purpose: the screen tells someone to
 * allow location sharing either way, and "permission denied" and "no fix
 * available on this device" lead to the same next action.
 *
 * enableHighAccuracy is OFF. A 4 km circle does not need GPS-grade precision,
 * and asking for it costs a cold fix tens of seconds outdoors and often fails
 * indoors -- which is where somebody stands when they arrive at a site hut.
 */
export function currentPosition(timeoutMs = 15000): Promise<Point | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** How far from the site someone may stamp. */
export const GEOFENCE_KM = 4;

export type GateResult =
  | { ok: true }
  /** Refused, or the device cannot say. */
  | { ok: false; reason: "no-position"; message: string }
  /** Outside the fence, with the distance to say so. */
  | { ok: false; reason: "too-far"; message: string; km: number };

/**
 * May this person stamp from where they are standing?
 *
 * THE ONE CASE THAT IS NOT A REFUSAL: an address Nominatim cannot place, one
 * it can only place as a whole municipality, or a lookup that could not be
 * made at all. There is nothing trustworthy to measure against,
 * and the choice is between letting the stamp through and telling somebody
 * standing on a site in the rain that they cannot record the hours they are
 * working because a map service in another country did not answer.
 *
 * This gate exists to catch the honest mistake -- stamping in from the kitchen
 * table -- and it lives in the browser, where anyone who wants to defeat it
 * can. Making it fail closed would not stop that person; it would only stop
 * the one whose site is a new-build with no house number yet. Invariant 3
 * already gives the leader the last word on a stamp, which is the check that
 * actually holds.
 *
 * Flip GEOCODE_FAILURE_BLOCKS if that trade is ever the wrong way round.
 */
const GEOCODE_FAILURE_BLOCKS = false;

/**
 * OFF, DELIBERATELY AND TEMPORARILY.
 *
 * Turned off after live testing: the project addresses in the database are
 * placeholder text -- one live project's site_address is literally "Projektets
 * adress" -- so there is nothing real to measure against, and the fence was
 * refusing legitimate stamps from people standing on site. A gate that blocks
 * the honest case and catches nothing is worse than no gate.
 *
 * NOT DELETED, and not silently parked either: walkthrough:geofence reads this
 * flag and asserts the behaviour it actually implies -- that a stamp from 50 km
 * away now goes through -- so the day somebody flips it back without meaning to,
 * a test says so.
 *
 * Set it back to true once the addresses are real. Confirm first that Nominatim
 * places each project's site_address as something other than category=boundary,
 * then run `npm run walkthrough:geofence`, which switches back to driving all
 * three refusal paths on its own.
 */
const GEOFENCE_ENABLED = false;

export async function stampGate(address: string | null): Promise<GateResult> {
  if (!GEOFENCE_ENABLED) return { ok: true };

  const here = await currentPosition();
  if (!here) {
    return {
      ok: false,
      reason: "no-position",
      message: "Du måste tillåta platsdelning för att stämpla in.",
    };
  }

  // An "area" match is treated exactly like no match: there is a coordinate,
  // but it is a kommun centroid and measuring against it would refuse people
  // standing on the site.
  const found = address ? await geocode(address) : null;
  const site = found?.precision === "exact" ? found : null;
  if (!site) {
    return GEOCODE_FAILURE_BLOCKS
      ? {
          ok: false,
          reason: "no-position",
          message: "Vi kunde inte hitta arbetsplatsens adress på kartan.",
        }
      : { ok: true };
  }

  const km = haversineKm(here, site);
  if (km > GEOFENCE_KM) {
    return {
      ok: false,
      reason: "too-far",
      km,
      message:
        `Du är för långt från arbetsplatsen (${km.toFixed(1)} km). ` +
        `Du måste vara inom ${GEOFENCE_KM} km för att stämpla in.`,
    };
  }
  return { ok: true };
}
