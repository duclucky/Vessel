const uploadError = (message, code = 'shelby_upload_failed') => Object.assign(
  new Error(message),
  { code },
);

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw uploadError(json.error || `Upload request failed (${response.status})`, json.code);
  }
  return json;
}

export async function uploadBlobViaVesselGateway(blobData, {
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  registrationUid,
  blobMerkleRoot,
  request = fetch,
  onProgress,
} = {}) {
  const data = blobData instanceof Uint8Array ? blobData : new Uint8Array(blobData || []);
  if (
    !data.byteLength
    || !quoteToken
    || !paidAuthorization
    || !uploadContext
    || !contractQuote
    || !contractSignature
    || !registrationUid
    || !blobMerkleRoot
  ) {
    throw uploadError('Paid upload context is required', 'invalid_paid_authorization');
  }
  const start = await readJson(await request('/api/shelby/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteToken,
      paidAuthorization,
      uploadContext,
      contractQuote,
      contractSignature,
      totalBytes: data.byteLength,
      registrationUid,
      blobMerkleRoot,
    }),
  }));
  if (!start.uploadId || !start.uploadToken || !Number.isSafeInteger(start.partSize) || start.partSize <= 0) {
    throw uploadError('Vessel returned an invalid Shelby upload session');
  }

  const part = data.subarray(0);
  const uploaded = await readJson(await request(`/api/shelby/uploads/${encodeURIComponent(start.uploadId)}/parts/0`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      Authorization: `Bearer ${start.uploadToken}`,
    },
    body: part,
  }));
  const uploadedBytes = Number(uploaded.uploadedBytes || data.byteLength);
  onProgress?.({ uploadedBytes, totalBytes: data.byteLength, partIdx: 1, totalParts: 1 });

  const completed = await readJson(await request(`/api/shelby/uploads/${encodeURIComponent(start.uploadId)}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${start.uploadToken}`,
    },
    body: JSON.stringify({ spAcks: uploaded.spAcks }),
  }));
  return Object.freeze({ uploadId: start.uploadId, uploadedBytes, commitPayload: completed.commitPayload });
}
