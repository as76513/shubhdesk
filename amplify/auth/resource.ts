import { defineAuth } from '@aws-amplify/backend';

/**
 * ShubhDesk — Authentication
 * ---------------------------------------------------------------
 * Cognito User Pool with email login and three role groups.
 * With under 10 staff you create each user by hand in the Amplify
 * console and drop them into the right group. No self-signup.
 *
 * Groups:
 *   - sales : telecaller / salesman (creates & works early-stage leads)
 *   - rm    : relationship manager (takes handoff, closes deals)
 *   - admin : sees & edits everything
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['admin', 'rm', 'sales'],
  // Only an admin can create accounts (no public sign-up in the app).
  accountRecovery: 'EMAIL_ONLY',
  userAttributes: {
    // Human-friendly name shown on cards and in the activity log.
    preferredUsername: { mutable: true, required: false },
  },
});
