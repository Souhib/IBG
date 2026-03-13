/**
 * Umami analytics tracking utility.
 * Wraps window.umami.track() with a safe no-op when Umami isn't loaded.
 */

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, string | number>) => void
    }
  }
}

export function trackEvent(event: string, data?: Record<string, string | number>) {
  window.umami?.track(event, data)
}
