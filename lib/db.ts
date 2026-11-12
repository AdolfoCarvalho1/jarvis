import { sqliteStore, type Store } from "./db/sqlite";
import { supabaseEnabled, supabaseStore } from "./db/supabase";

/**
 * Um único ponto de acesso ao armazenamento.
 * Com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente usa Supabase;
 * sem eles, cai no SQLite local (.data/jarvis.db).
 */
export const storage: Store = supabaseEnabled ? (supabaseStore as unknown as Store) : sqliteStore;
export const storageName = supabaseEnabled ? "supabase" : "sqlite";
