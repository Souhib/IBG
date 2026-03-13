import { MapPin, Search, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export interface CityCoordinates {
  city: string
  lat: number
  lng: number
  timezone?: string
}

interface CitySelectorProps {
  onSelect: (coords: CityCoordinates) => void
  initialCity?: string
}

const STORAGE_CITY_KEY = "ipg-city"
const STORAGE_COORDS_KEY = "ipg-coordinates"

export function loadStoredCity(): CityCoordinates | null {
  try {
    const city = localStorage.getItem(STORAGE_CITY_KEY)
    const coordsStr = localStorage.getItem(STORAGE_COORDS_KEY)
    if (city && coordsStr) {
      const coords = JSON.parse(coordsStr)
      return { city, lat: coords.lat, lng: coords.lng, timezone: coords.timezone }
    }
  } catch {}
  return null
}

export function storeCity(data: CityCoordinates) {
  localStorage.setItem(STORAGE_CITY_KEY, data.city)
  localStorage.setItem(STORAGE_COORDS_KEY, JSON.stringify({ lat: data.lat, lng: data.lng, timezone: data.timezone }))
}

async function fetchTimezone(lat: number, lng: number): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto&forecast_days=1`,
    )
    const data = await res.json()
    if (data.timezone) return data.timezone as string
  } catch {
    // Open-Meteo unavailable
  }
  return undefined
}

export async function refreshTimezoneIfMissing(coords: CityCoordinates): Promise<CityCoordinates | null> {
  if (coords.timezone) return null
  const timezone = await fetchTimezone(coords.lat, coords.lng)
  if (!timezone) return null
  const updated = { ...coords, timezone }
  storeCity(updated)
  return updated
}

// Free city search via Open-Meteo geocoding API
interface OpenMeteoGeoResult {
  id: number
  name: string
  latitude: number
  longitude: number
  country: string
  admin1?: string
}

async function searchCitiesFree(query: string): Promise<OpenMeteoGeoResult[]> {
  if (query.length < 2) return []
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`,
    )
    const data = await res.json()
    return (data.results || []) as OpenMeteoGeoResult[]
  } catch {
    return []
  }
}

// Free reverse geocoding via Nominatim (OpenStreetMap)
async function reverseGeocodeFree(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`,
      { headers: { "Accept-Language": "en" } },
    )
    const data = await res.json()
    return data.address?.city || data.address?.town || data.address?.village || data.address?.county || "My Location"
  } catch {
    return "My Location"
  }
}

export async function autoDetectLocationByIP(): Promise<CityCoordinates | null> {
  try {
    const res = await fetch("https://ipapi.co/json/")
    const data = await res.json()
    if (data.city && data.latitude && data.longitude) {
      const coords: CityCoordinates = {
        city: data.city,
        lat: data.latitude,
        lng: data.longitude,
        timezone: data.timezone,
      }
      storeCity(coords)
      return coords
    }
  } catch {
    // IP geolocation unavailable
  }
  return null
}

export function CitySelector({ onSelect, initialCity }: CitySelectorProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [detecting, setDetecting] = useState(false)
  const [selectedCity, setSelectedCity] = useState(initialCity || "")
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [predictions, setPredictions] = useState<OpenMeteoGeoResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleSearch = useCallback(
    (input: string) => {
      setQuery(input)
      if (input.length < 2) {
        setPredictions([])
        setShowDropdown(false)
        return
      }

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = setTimeout(async () => {
        const results = await searchCitiesFree(input)
        setPredictions(results)
        setShowDropdown(true)
      }, 300)
    },
    [],
  )

  const selectPrediction = useCallback(
    async (result: OpenMeteoGeoResult) => {
      const timezone = await fetchTimezone(result.latitude, result.longitude)
      const data: CityCoordinates = {
        city: result.name,
        lat: result.latitude,
        lng: result.longitude,
        timezone,
      }
      storeCity(data)
      setSelectedCity(data.city)
      setQuery("")
      setShowDropdown(false)
      setPredictions([])
      onSelect(data)
    },
    [onSelect],
  )

  const detectLocation = useCallback(async () => {
    setDetecting(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
      )
      const { latitude: lat, longitude: lng } = position.coords
      const cityName = await reverseGeocodeFree(lat, lng)
      const timezone = await fetchTimezone(lat, lng)
      const data: CityCoordinates = { city: cityName, lat, lng, timezone }
      storeCity(data)
      setSelectedCity(data.city)
      onSelect(data)
    } catch (err) {
      console.error("Location detection failed:", err)
    } finally {
      setDetecting(false)
    }
  }, [onSelect])

  return (
    <div className="relative" ref={dropdownRef}>
      {selectedCity ? (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{selectedCity}</span>
          <button
            type="button"
            onClick={() => {
              setSelectedCity("")
              inputRef.current?.focus()
            }}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
          >
            {t("prayer.changeCity")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={detectLocation}
            disabled={detecting}
            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {detecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            {t("prayer.useMyLocation")}
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => predictions.length > 0 && setShowDropdown(true)}
              placeholder={t("prayer.searchCity")}
              className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {showDropdown && predictions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg z-50 max-h-48 overflow-auto">
                {predictions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectPrediction(r)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground ml-1 text-xs">
                      {[r.admin1, r.country].filter(Boolean).join(", ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
