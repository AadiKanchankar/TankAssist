import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { uploadChallanPhoto } from '../lib/storage';
import { ChallanLine, filledLines, sortOwnBrandFirst } from '../lib/challan';

/**
 * Catalog columns the CHALLAN form reads.
 *
 * No price columns, deliberately — same rule as the rep's order picker. A rep
 * device never holds pricing, and a challan needs none: it records what was
 * physically delivered, not what it was worth.
 */
const CHALLAN_PRODUCT_COLUMNS = 'id, name, brand, unit, unit_size, unit_of_measure, qty_per_carton';

export interface ChallanProduct {
  id: string;
  name: string;
  brand: string | null;
  unit: string;
  unit_size: number | null;
  unit_of_measure: string | null;
  qty_per_carton: number;
}

/**
 * Active products, our own line floated to the top.
 *
 * `is_out_of_stock` is NOT filtered here (unlike the order picker): a challan
 * records a delivery that has already happened, and whether we can currently
 * sell the product says nothing about whether it arrived last Tuesday.
 */
export function useChallanProducts() {
  return useQuery({
    queryKey: ['challan-products'],
    refetchOnMount: false,
    queryFn: async (): Promise<ChallanProduct[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(CHALLAN_PRODUCT_COLUMNS)
        .eq('is_active', true);
      if (error) throw error;
      return sortOwnBrandFirst((data as ChallanProduct[]) ?? []);
    },
  });
}

export interface NewChallan {
  storeId: string;
  /** The visit the rep was inside, when there is one. Provenance only. */
  visitId: string | null;
  challanDate: string;
  challanNumber: string | null;
  notes: string | null;
  photoUri: string;
  lines: ChallanLine[];
  /**
   * Set on RETRY, when the header saved but its lines did not. Skips the photo
   * upload and the header insert so the retry cannot create a SECOND challan —
   * the same orphan-recovery shape as management's "Retry Save" on Add User.
   */
  existingChallanId?: string | null;
}

/**
 * Thrown when the header landed but the lines did not.
 *
 * Carries the challan id so the screen can offer a retry that completes the
 * existing row. `challans` has no DELETE policy (the photo is evidence), so a
 * header cannot be rolled back — finishing it is the only way to clear it.
 */
export class ChallanLinesError extends Error {
  constructor(
    public challanId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChallanLinesError';
  }
}

export function useCreateChallan(repId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewChallan): Promise<string> => {
      if (!repId) throw new Error('You are not signed in.');

      // Validated here and not only in the form: the DB refuses an all-zero
      // line outright (challan_items_nonempty), so sending one would surface
      // as a raw constraint error instead of a sentence the rep can act on.
      const lines = filledLines(input.lines);
      if (!lines.length) {
        throw new Error('Enter a quantity against at least one product before saving.');
      }

      let challanId = input.existingChallanId ?? null;

      if (!challanId) {
        // Photo first. A challan row without its document is worse than no row
        // at all, and the row is the thing we cannot delete afterwards.
        const photoPath = await uploadChallanPhoto(input.photoUri, repId);

        const { data, error } = await supabase
          .from('challans')
          .insert({
            store_id: input.storeId,
            visit_id: input.visitId,
            challan_date: input.challanDate,
            challan_number: input.challanNumber,
            photo_path: photoPath,
            recorded_by: repId,
            notes: input.notes,
          })
          .select('id')
          .single();
        if (error) throw error;
        challanId = (data as { id: string }).id;
      }

      const { error: itemsError } = await supabase.from('challan_items').insert(
        lines.map((l) => ({
          challan_id: challanId,
          product_id: l.product_id,
          qty_qts: l.qty_qts,
          qty_pints: l.qty_pints,
          qty_nips: l.qty_nips,
        })),
      );
      if (itemsError) {
        throw new ChallanLinesError(
          challanId,
          `The challan photo was saved but its quantities were not: ${itemsError.message}`,
        );
      }

      return challanId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-challans'] });
    },
  });
}
