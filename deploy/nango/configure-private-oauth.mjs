import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// The pinned generic client prefers CIMD whenever NANGO_SERVER_URL is HTTPS,
// even for a private tailnet URL that a provider cannot retrieve. Keep that
// upstream behavior available, but explicitly require DCR on this deployment.
const [path] = process.argv.slice(2);
if (!path) throw new Error('NANGO_PRIVATE_OAUTH_BUILD_INPUT_REQUIRED');
const source = readFileSync(path, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== '0e6bd6502654934ee574fdd6ef9b244d35ce29159f9e31f456502c8a16583328') {
  throw new Error('NANGO_PINNED_OAUTH_SOURCE_CHANGED');
}
const needle = 'export function chooseMcpClientIdMethod(metadata, cimdUrl) {';
if (source.split(needle).length !== 2) {
  throw new Error('NANGO_PINNED_OAUTH_METHOD_SIGNATURE_CHANGED');
}
const policy = `${needle}
    if (process.env['TALENT_SIGNAL_NANGO_DCR_ONLY'] === 'true') {
        if (metadata.registration_endpoint) return 'dcr';
        throw new Error('MCP_DCR_REQUIRED_FOR_PRIVATE_DEPLOYMENT');
    }`;
const output = source.replace(needle, policy);
writeFileSync(path, output);
console.log(JSON.stringify({ patched_method_count: 1,
  source_sha256: sourceHash,
  patched_sha256: createHash('sha256').update(output).digest('hex') }));
