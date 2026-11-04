import {AuthenticatedEventSource} from '../lib/event-stream.mjs';
import {apiFetch} from './api-client';

export class LearningEventSource extends AuthenticatedEventSource {
  constructor(path: string) {super(path, {fetch: apiFetch});}
}
