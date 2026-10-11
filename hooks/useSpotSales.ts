import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { uploadSpotSalePhoto } from '../lib/storage';
import { discardPhoto, type BlurredPhoto } from '../lib/faceBlur';

/**
 * Spot sales — one event per customer interaction, logged as it happens.
 *
 * There is deliberately NO way to enter a visit total: the count is always
 * derived from these rows (CLAUDE.md "Spot sales"). Rows are append-only; the
 * only mutation is undo within 60 s (undo_spot_sale RPC, soft).
 */

export interface CompetitorBrand {
  id: string;
  name: string;
}

export function useCompetitorBrands() {
  return useQuery({
    queryKey: ['competitor-brands'],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CompetitorBrand[]> => {
      const { data, error } = await supabase
        .from('competitor_brands')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return (data as CompetitorBrand[]) ?? [];
    },
  });
}

export interface MySpotSale {
  id: string;
  created_at: string;
  quantity: number;
  visit_id: string;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** My own spot sales at this store today (undone ones excluded) — the live tally. */
export function useMySpotSalesHere(storeId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['my-spot-sales-here', storeId, userId, startOfToday()],
    enabled: !!userId,
    queryFn: async (): Promise<MySpotSale[]> => {
      const { data, error } = await supabase
        .from('spot_sales')
        .select('id, created_at, quantity, visit_id')
        .eq('user_id', userId!)
        .eq('store_id', storeId)
        .is('undone_at', null)
        .gte('created_at', startOfToday())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as MySpotSale[]) ?? [];
    },
  });
}

export interface SpotSaleInput {
  visitId: string;
  storeId: string;
  userId: string;
  productId: string;
  quantity: number;
  switchedFromId: string;
  note: string;
  photo: BlurredPhoto;
  zoom: number;
  capturedAt: string;
  position: { latitude: number; longitude: number; accuracy: number | null; mocked: boolean } | null;
}

/**
 * Upload the blurred photo, then insert the event. The blurred file is
 * deleted afterwards whatever happens — the local copy has no further use and
 * must not linger in the cache.
 *
 * If the insert fails after the upload, the object is an orphan in the locked
 * bucket; the hourly purge still deletes it at 90 days (it sweeps objects, not
 * rows), so a failed save never leaves a customer photo behind for ever.
 */
export function useLogSpotSale() {
  const qc = useQueryClient();
  return async (i: SpotSaleInput): Promise<MySpotSale> => {
    try {
      const path = await uploadSpotSalePhoto(i.photo.uri, i.userId);
      const { data, error } = await supabase
        .from('spot_sales')
        .insert({
          visit_id: i.visitId,
          // The server overwrites this from the visit, so it can't be pointed
          // at a different shop; sent because the column is NOT NULL.
          store_id: i.storeId,
          user_id: i.userId,
          product_id: i.productId,
          quantity: i.quantity,
          switched_from_id: i.switchedFromId,
          note: i.note.trim() || null,
          photo_path: path,
          faces_blurred: i.photo.faces,
          photo_hash: i.photo.hash,
          zoom: i.zoom,
          captured_at: i.capturedAt,
          latitude: i.position?.latitude ?? null,
          longitude: i.position?.longitude ?? null,
          accuracy_m: i.position?.accuracy ?? null,
          is_mock_location: i.position?.mocked ?? false,
        })
        .select('id, created_at, quantity, visit_id')
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['my-spot-sales-here'] });
      return data as MySpotSale;
    } finally {
      await discardPhoto(i.photo.uri);
    }
  };
}

/** Undo within 60 s of logging. The server enforces the window, not this. */
export function useUndoSpotSale() {
  const qc = useQueryClient();
  return async (id: string) => {
    const { error } = await supabase.rpc('undo_spot_sale', { p_id: id });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['my-spot-sales-here'] });
  };
}
