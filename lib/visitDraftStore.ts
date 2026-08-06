/**
 * Keystore I/O for the visit form draft. The rules live in visitDraft.ts
 * (pure, tested); this file is only the encrypted read/write, kept separate so
 * the rules stay runnable under tsx without pulling in react-native.
 *
 * Storage is the existing chunked SecureStore adapter — Android Keystore /
 * iOS Keychain — NOT AsyncStorage, because a draft carries store identity and
 * stock quantities.
 */
import { SecureStorageAdapter } from './secureStorage';
import {
  DRAFT_PREFIX,
  VisitDraft,
  draftHasContent,
  parseDraft,
  pruneDraft,
} from './visitDraft';

export async function saveDraft(visitId: string, draft: VisitDraft): Promise<void> {
  const body = pruneDraft({ ...draft, savedAt: new Date().toISOString() });
  if (!draftHasContent(body)) return;
  try {
    await SecureStorageAdapter.setItem(DRAFT_PREFIX + visitId, JSON.stringify(body));
  } catch {
    // A draft is a convenience layered on top of the server-side resume;
    // a Keystore hiccup must never break the visit itself.
  }
}

export async function loadDraft(visitId: string): Promise<VisitDraft | null> {
  try {
    return parseDraft(await SecureStorageAdapter.getItem(DRAFT_PREFIX + visitId));
  } catch {
    return null;
  }
}

export async function clearDraft(visitId: string): Promise<void> {
  try {
    await SecureStorageAdapter.removeItem(DRAFT_PREFIX + visitId);
  } catch {
    /* the visit is already checked out server-side; a stale key is harmless */
  }
}
