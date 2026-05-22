import { createClient } from "@supabase/supabase-js";

// Reads the two values from .env.local (local) or Vercel env vars (production).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// A single shared Supabase client the whole app imports from.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
