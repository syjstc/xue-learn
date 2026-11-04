import type {ComponentProps} from 'react';
import {SequentialJourneyPath as SharedJourney} from '../../../desktop/src/components/goals/sequential-journey-path';

export * from '../../../desktop/src/components/goals/sequential-journey-path';

/** The plugin starts with the course modules; it has no separate orientation. */
export function SequentialJourneyPath(props: ComponentProps<typeof SharedJourney>) {
  return <SharedJourney {...props} orientation={null} />;
}
