import React from 'react';
import EmptyState from './EmptyState';

/** Shared fetch-error state (DESIGN §9: say what happened + what to do). */
export default function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn’t load"
      message="Check your connection and try again."
      actionLabel="Retry"
      onAction={onRetry}
    />
  );
}
