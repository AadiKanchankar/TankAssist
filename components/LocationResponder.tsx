import { useLocationResponder } from '../hooks/useLocationResponder';

/** Invisible mount point for the rep-side location responder (see the hook). */
export default function LocationResponder() {
  useLocationResponder();
  return null;
}
