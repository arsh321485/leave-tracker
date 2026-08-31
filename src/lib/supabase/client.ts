import { createClient } from "@supabase/supabase-js";

/**
 * Browser-safe Supabase client.
 * Leave data still goes through Prisma + Auth.js; this is available for
 * Supabase Storage/Realtime or future features.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  return createClient(url, key);
}
