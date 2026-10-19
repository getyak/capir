// Synthetic process peer: never execute CLI options, model input or network IO.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const marker = 'SYNTHETIC_PRIVATE_STDERR_' + (process.env.CAPIR_CALLBACK_CONTROL === '1' ? 'WITH' : 'WITHOUT');
process.stderr.write(marker + '\n', () => writeFileSync(join(process.cwd(), 'ready'), 'ready'));
setInterval(() => {}, 1000);
