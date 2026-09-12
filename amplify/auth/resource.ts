import { defineAuth } from '@aws-amplify/backend';

/**
 * ShubhDesk — Authentication
 * ---------------------------------------------------------------
 * Cognito User Pool with email login and role groups.
 * With under 10 staff you create each user by hand in the Amplify
 * console and drop them into the right group. No self-signup.
 *
 * Groups:
 *   - wealth_manager : works a lead end-to-end, New Lead → Meeting →
 *                      Joint Meeting → Deal Closed
 *   - advisor        : trade log plus the same Lead pipeline as
 *                      wealth_manager
 *   - admin          : sees & edits everything
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['admin', 'wealth_manager', 'advisor'],
  // Only an admin can create accounts (no public sign-up in the app).
  accountRecovery: 'EMAIL_ONLY',
  userAttributes: {
    // Human-friendly name shown on cards and in the activity log.
    preferredUsername: { mutable: true, required: false },
  },
});
