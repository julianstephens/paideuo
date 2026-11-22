/* oxlint-disable import/no-commonjs */
// PocketBase's SHA-256 helper returns hex. PKCE uses unpadded base64url of the digest bytes.
const pkceChallenge = (verifier) => {
  const hex = $security.sha256(verifier);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let offset = 0; offset < hex.length; offset += 6) {
    const chunk = hex.slice(offset, offset + 6);
    const bits = parseInt(chunk.padEnd(6, "0"), 16);
    encoded += alphabet[(bits >> 18) & 63] + alphabet[(bits >> 12) & 63];
    if (chunk.length >= 4) encoded += alphabet[(bits >> 6) & 63];
    if (chunk.length === 6) encoded += alphabet[bits & 63];
  }
  return encoded;
};

module.exports = { pkceChallenge };
