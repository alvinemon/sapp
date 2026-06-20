/** Rough area labels from coordinates — Bangladesh cities + grid fallback. */

const BD_ZONES: { name: string; latMin: number; latMax: number; lngMin: number; lngMax: number }[] = [
  { name: "Dhaka", latMin: 23.68, latMax: 23.98, lngMin: 90.28, lngMax: 90.55 },
  { name: "Gazipur", latMin: 23.95, latMax: 24.15, lngMin: 90.35, lngMax: 90.55 },
  { name: "Narayanganj", latMin: 23.55, latMax: 23.75, lngMin: 90.45, lngMax: 90.65 },
  { name: "Chittagong", latMin: 22.25, latMax: 22.45, lngMin: 91.72, lngMax: 91.92 },
  { name: "Sylhet", latMin: 24.85, latMax: 25.05, lngMin: 91.82, lngMax: 92.02 },
  { name: "Rajshahi", latMin: 24.32, latMax: 24.45, lngMin: 88.55, lngMax: 88.68 },
  { name: "Khulna", latMin: 22.78, latMax: 22.88, lngMin: 89.52, lngMax: 89.58 },
  { name: "Barishal", latMin: 22.68, latMax: 22.75, lngMin: 90.33, lngMax: 90.40 },
  { name: "Rangpur", latMin: 25.72, latMax: 25.78, lngMin: 89.22, lngMax: 89.28 },
  { name: "Mymensingh", latMin: 24.72, latMax: 24.78, lngMin: 90.38, lngMax: 90.45 },
  { name: "Cox's Bazar", latMin: 21.40, latMax: 21.48, lngMin: 91.95, lngMax: 92.02 },
];

export function areaFromCoords(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return "Unknown area";
  }
  for (const z of BD_ZONES) {
    if (lat >= z.latMin && lat <= z.latMax && lng >= z.lngMin && lng <= z.lngMax) {
      return z.name;
    }
  }
  const gLat = (Math.round(lat * 20) / 20).toFixed(2);
  const gLng = (Math.round(lng * 20) / 20).toFixed(2);
  return `Grid ${gLat}°, ${gLng}°`;
}
