import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * ShubhDesk backend.
 * Add more resources here later (storage for documents, functions
 * for scheduled reminders, etc.) as the app grows.
 */
defineBackend({
  auth,
  data,
});
