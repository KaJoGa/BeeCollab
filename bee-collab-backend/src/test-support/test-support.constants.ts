/**
 * Every account created by automated tests must use this email suffix
 * (e.g. alice@qa.beecollab.test). The cleanup endpoint only ever touches data
 * that belongs to users with this suffix.
 */
export const TEST_EMAIL_SUFFIX = '@qa.beecollab.test';

/** Minimum length of TEST_ADMIN_TOKEN for the endpoints to be considered configured. */
export const MIN_TOKEN_LENGTH = 16;
