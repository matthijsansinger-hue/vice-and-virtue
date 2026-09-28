import { createClient } from "@supabase/supabase-js";

// Reads the two values from .env.local (local) or Vercel env vars (production).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Every HTTP request gets a hard deadline. Browsers never time a fetch out on
// their own, so under load (or on flaky venue Wi-Fi) a request could stay
// pending forever — which is exactly how a refreshed room page got stuck on
// "Entering the castle…" and how a host's phase advance silently died. With a
// deadline the request fails instead, and the callers' retry paths take over.
// A caller-supplied signal (e.g. `.abortSignal()`) is still honoured.
const REQUEST_TIMEOUT_MS = 15_000;

// Built from a plain AbortController (not AbortSignal.timeout/any) so it works
// on older phone browsers too — a missing API here would break every request.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

// A single shared Supabase client the whole app imports from.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});
