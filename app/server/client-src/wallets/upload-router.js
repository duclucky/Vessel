export function createUploadRouter({ aptosUpload, solanaUpload, evmUpload }) {
  return {
    async upload(file, context = {}) {
      const { session } = context;
      if (!session) throw new Error('Connect a wallet before uploading');
      if (session.chain === 'aptos' && session.mode === 'native') {
        return aptosUpload(file, context);
      }
      if (session.chain === 'solana' && session.mode === 'daa') {
        return solanaUpload(file, context);
      }
      if (session.chain === 'evm' && session.mode === 'daa' && typeof evmUpload === 'function') {
        return evmUpload(file, context);
      }
      throw new Error(`Uploads are unavailable for ${session.chain || 'this wallet'}`);
    },
  };
}
