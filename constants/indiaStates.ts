/**
 * The 28 states + 8 union territories of India.
 *
 * Stored value is the plain state NAME — the same free-text form already held in
 * `company_facilities.state` and `stores.state`, so existing rows stay valid and
 * nothing needs migrating. The picker only constrains what new entries can be.
 */
export const INDIA_STATES: string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

export const INDIA_UNION_TERRITORIES: string[] = [
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

/** Flat list for search; states first, then UTs. */
export const INDIA_STATES_AND_UTS: string[] = [...INDIA_STATES, ...INDIA_UNION_TERRITORIES];
