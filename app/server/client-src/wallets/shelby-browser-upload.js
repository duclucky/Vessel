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
    }),
  }));
  if (!start.uploadId || !start.uploadToken || !Number.isSafeInteger(start.partSize) || start.partSize <= 0) {
    throw uploadError('Vessel returned an invalid Shelby upload session');
  }

  let uploadedBytes = 0;
  let partIdx = 0;
  for (let offset = 0; offset < data.byteLength; offset += start.partSize) {
    const part = data.subarray(offset, Math.min(data.byteLength, offset + start.partSize));
    await readJson(await request(`/api/shelby/uploads/${encodeURIComponent(start.uploadId)}/parts/${partIdx}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        Authorization: `Bearer ${start.uploadToken}`,
      },
      body: part,
    }));
    uploadedBytes += part.byteLength;
    partIdx += 1;
    onProgress?.({ uploadedBytes, totalBytes: data.byteLength, partIdx, totalParts: Math.ceil(data.byteLength / start.partSize) });
  }

  await readJson(await request(`/api/shelby/uploads/${encodeURIComponent(start.uploadId)}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${start.uploadToken}` },
  }));
  return Object.freeze({ uploadId: start.uploadId, uploadedBytes });
}
