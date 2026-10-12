/**
 * lib/vault.ts: vault entry point. Re-exports the AES-256-GCM crypto
 * primitives (crypto.ts) and the per-tenant encrypted secret store
 * (store.ts). Python equivalent: the vault/ package.
 */
export {
  encrypt,
  decrypt,
  generateMasterKey,
  mask,
  VaultError,
} from "./vault/crypto";
export { VaultStore, vaultStore } from "./vault/store";
