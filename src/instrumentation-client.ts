// Client instrumentation — runs once before React hydration (Next.js
// `instrumentation-client` convention). This is where analytics boots.

import {
  initAnalytics,
  capturePageview,
  identifyUser,
  resetUser,
} from "@/lib/analytics";
import { supabase } from "@/lib/supabase";

try {
  initAnalytics();
  // First (initial-load) pageview. Subsequent client navigations are caught
  // by onRouterTransitionStart below.
  capturePageview();

  // Tie analytics identity to the account by UUID (never email/username).
  // Fires INITIAL_SESSION on load, then SIGNED_IN / SIGNED_OUT live.
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      identifyUser(session.user.id);
    } else {
      resetUser();
    }
  });
} catch {
  // Never let analytics setup break the app.
}

// Called by Next.js at the start of every client-side navigation.
export function onRouterTransitionStart(url: string): void {
  try {
    capturePageview(url);
  } catch {
    // ignore
  }
}
