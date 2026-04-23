import { generateTotpCode } from '../apps/api/src/admin-auth.service.js';
import { getTestRuntimeConfig } from './lib/test-helpers.js';

function main() {
  const config = getTestRuntimeConfig();

  console.log(
    JSON.stringify(
      {
        adminId: config.adminId,
        mfaCode: generateTotpCode(config.adminMfaSecret),
        note: 'TOTP changes every 30 seconds.'
      },
      null,
      2
    )
  );
}

main();
