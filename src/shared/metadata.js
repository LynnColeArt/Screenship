export function buildExportMetadata(baseMetadata, exportFormat) {
  return {
    ...baseMetadata,
    exportFormat,
    exportedAt: new Date().toISOString()
  };
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_META_KEYWORD = "screenship.meta";
const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/\0";
const WEBP_FLAG_XMP = 0x04;
const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_ALPHA = 0x10;
const WEBP_FLAG_ICC = 0x20;
const WEBP_FLAG_ANIMATION = 0x02;

const utf8Encoder = new TextEncoder();

function encodeAscii(text) {
  const output = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    output[i] = text.charCodeAt(i) & 0x7f;
  }
  return output;
}

function decodeAscii(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function writeUint32BE(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function writeUint32LE(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ]);
}

function writeUint24LE(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
}

let crc32Table = null;

function getCrc32Table() {
  if (crc32Table) {
    return crc32Table;
  }

  crc32Table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[n] = c >>> 0;
  }
  return crc32Table;
}

function crc32(bytes) {
  const table = getCrc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function xmlEscape(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildXmpPacket(metadataJson) {
  const payload = xmlEscape(metadataJson);
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:screenship="https://screenship.app/ns/1.0/">',
    `<screenship:payload>${payload}</screenship:payload>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>'
  ].join("");
}

function createPngChunk(type, data) {
  const typeBytes = encodeAscii(type);
  const chunkBody = concatBytes([typeBytes, data]);
  const checksum = crc32(chunkBody);
  return concatBytes([writeUint32BE(data.length), typeBytes, data, writeUint32BE(checksum)]);
}

function createPngITXtChunk(metadataJson) {
  const keywordBytes = encodeAscii(PNG_META_KEYWORD);
  const textBytes = utf8Encoder.encode(metadataJson);

  // keyword\0 + compression flag + compression method + language\0 + translated\0 + text
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  let offset = 0;
  data.set(keywordBytes, offset);
  offset += keywordBytes.length;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data.set(textBytes, offset);

  return createPngChunk("iTXt", data);
}

function getPngChunkKeyword(chunkType, chunkData) {
  if (chunkType !== "iTXt" && chunkType !== "tEXt") {
    return null;
  }
  const separator = chunkData.indexOf(0);
  if (separator < 0) {
    return null;
  }
  return decodeAscii(chunkData.subarray(0, separator));
}

function embedPngMetadata(bytes, metadataJson) {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error("Invalid PNG payload.");
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("Blob is not a PNG file.");
    }
  }

  const outputParts = [bytes.subarray(0, 8)];
  const iTXtChunk = createPngITXtChunk(metadataJson);
  let cursor = 8;
  let inserted = false;

  while (cursor + 8 <= bytes.length) {
    const length = readUint32BE(bytes, cursor);
    const type = decodeAscii(bytes.subarray(cursor + 4, cursor + 8));
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;

    if (chunkEnd > bytes.length) {
      throw new Error("Corrupt PNG chunk boundaries.");
    }

    const chunkData = bytes.subarray(dataStart, dataEnd);
    const keyword = getPngChunkKeyword(type, chunkData);
    const isExistingScreenShipMetadata = keyword === PNG_META_KEYWORD;

    if (type === "IEND" && !inserted) {
      outputParts.push(iTXtChunk);
      inserted = true;
    }

    if (!isExistingScreenShipMetadata) {
      outputParts.push(bytes.subarray(cursor, chunkEnd));
    }

    cursor = chunkEnd;

    if (type === "IEND") {
      break;
    }
  }

  if (!inserted) {
    throw new Error("PNG is missing IEND chunk.");
  }

  return concatBytes(outputParts);
}

function createJpegXmpSegment(metadataJson) {
  const prefixBytes = encodeAscii(XMP_NAMESPACE);
  const xmpPacket = buildXmpPacket(metadataJson);
  const payload = concatBytes([prefixBytes, utf8Encoder.encode(xmpPacket)]);

  if (payload.length + 2 > 0xffff) {
    throw new Error("Metadata payload too large for JPEG APP1 segment.");
  }

  const length = payload.length + 2;
  return concatBytes([
    new Uint8Array([0xff, 0xe1, (length >>> 8) & 0xff, length & 0xff]),
    payload
  ]);
}

function isJpegXmpSegment(marker, segmentPayload) {
  if (marker !== 0xe1 || segmentPayload.length < XMP_NAMESPACE.length) {
    return false;
  }
  const prefixBytes = encodeAscii(XMP_NAMESPACE);
  for (let i = 0; i < prefixBytes.length; i += 1) {
    if (segmentPayload[i] !== prefixBytes[i]) {
      return false;
    }
  }
  return true;
}

function embedJpegMetadata(bytes, metadataJson) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Blob is not a JPEG file.");
  }

  const app1Segment = createJpegXmpSegment(metadataJson);
  const parts = [bytes.subarray(0, 2)];
  let cursor = 2;
  let inserted = false;

  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff || cursor + 1 >= bytes.length) {
      parts.push(bytes.subarray(cursor));
      break;
    }

    let markerStart = cursor;
    while (markerStart < bytes.length && bytes[markerStart] === 0xff) {
      markerStart += 1;
    }
    if (markerStart >= bytes.length) {
      break;
    }

    const marker = bytes[markerStart];
    cursor = markerStart + 1;

    const isStandaloneMarker =
      marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);

    if (isStandaloneMarker) {
      const markerBytes = bytes.subarray(markerStart - 1, cursor);
      if (marker === 0xd9 && !inserted) {
        parts.push(app1Segment);
        inserted = true;
      }
      parts.push(markerBytes);
      if (marker === 0xd9) {
        break;
      }
      continue;
    }

    if (cursor + 1 >= bytes.length) {
      throw new Error("Corrupt JPEG segment length.");
    }

    const segmentLength = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (segmentLength < 2) {
      throw new Error("Invalid JPEG segment length.");
    }

    const segmentDataStart = cursor + 2;
    const segmentEnd = segmentDataStart + segmentLength - 2;
    if (segmentEnd > bytes.length) {
      throw new Error("Corrupt JPEG segment boundaries.");
    }

    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    if (!inserted && !isAppSegment) {
      parts.push(app1Segment);
      inserted = true;
    }

    const payload = bytes.subarray(segmentDataStart, segmentEnd);
    if (!isJpegXmpSegment(marker, payload)) {
      parts.push(bytes.subarray(markerStart - 1, segmentEnd));
    }

    if (marker === 0xda) {
      parts.push(bytes.subarray(segmentEnd));
      break;
    }

    cursor = segmentEnd;
  }

  if (!inserted) {
    parts.push(app1Segment);
  }

  return concatBytes(parts);
}

function parseWebPChunks(bytes) {
  if (
    bytes.length < 12 ||
    decodeAscii(bytes.subarray(0, 4)) !== "RIFF" ||
    decodeAscii(bytes.subarray(8, 12)) !== "WEBP"
  ) {
    throw new Error("Blob is not a WebP file.");
  }

  const chunks = [];
  let cursor = 12;

  while (cursor + 8 <= bytes.length) {
    const type = decodeAscii(bytes.subarray(cursor, cursor + 4));
    const size = readUint32LE(bytes, cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + (size % 2);

    if (chunkEnd > bytes.length) {
      throw new Error("Corrupt WebP chunk boundaries.");
    }

    chunks.push({
      type,
      size,
      data: bytes.subarray(dataStart, dataEnd)
    });

    cursor = chunkEnd;
  }

  return chunks;
}

function parseWebPDimensionsFromChunks(chunks) {
  const vp8x = chunks.find((chunk) => chunk.type === "VP8X");
  if (vp8x && vp8x.data.length >= 10) {
    const width = 1 + (vp8x.data[4] | (vp8x.data[5] << 8) | (vp8x.data[6] << 16));
    const height = 1 + (vp8x.data[7] | (vp8x.data[8] << 8) | (vp8x.data[9] << 16));
    return { width, height };
  }

  const vp8 = chunks.find((chunk) => chunk.type === "VP8 ");
  if (vp8 && vp8.data.length >= 10) {
    const hasStartCode = vp8.data[3] === 0x9d && vp8.data[4] === 0x01 && vp8.data[5] === 0x2a;
    if (hasStartCode) {
      const width = (vp8.data[6] | (vp8.data[7] << 8)) & 0x3fff;
      const height = (vp8.data[8] | (vp8.data[9] << 8)) & 0x3fff;
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }

  const vp8l = chunks.find((chunk) => chunk.type === "VP8L");
  if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
    const packed =
      (vp8l.data[1] |
        (vp8l.data[2] << 8) |
        (vp8l.data[3] << 16) |
        (vp8l.data[4] << 24)) >>>
      0;
    const width = (packed & 0x3fff) + 1;
    const height = ((packed >>> 14) & 0x3fff) + 1;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return null;
}

async function getWebPDimensions(blob, chunks) {
  const parsed = parseWebPDimensionsFromChunks(chunks);
  if (parsed) {
    return parsed;
  }

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
    return dimensions;
  }

  throw new Error("Unable to determine WebP dimensions.");
}

function webPChunk(type, data) {
  const header = concatBytes([encodeAscii(type), writeUint32LE(data.length)]);
  const pad = data.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  return concatBytes([header, data, pad]);
}

function createWebPVp8xData(flags, width, height) {
  if (width < 1 || height < 1 || width > 0x1000000 || height > 0x1000000) {
    throw new Error("WebP dimensions are out of VP8X range.");
  }

  const data = new Uint8Array(10);
  data[0] = flags & 0x3e;
  data.set(writeUint24LE(width - 1), 4);
  data.set(writeUint24LE(height - 1), 7);
  return data;
}

function buildWebPXmpChunk(metadataJson) {
  const packet = buildXmpPacket(metadataJson);
  return {
    type: "XMP ",
    data: utf8Encoder.encode(packet)
  };
}

function inferWebPFlags(chunks) {
  let flags = 0;
  const has = (type) => chunks.some((chunk) => chunk.type === type);

  if (has("ICCP")) {
    flags |= WEBP_FLAG_ICC;
  }
  if (has("ALPH")) {
    flags |= WEBP_FLAG_ALPHA;
  }
  if (has("EXIF")) {
    flags |= WEBP_FLAG_EXIF;
  }
  if (has("ANIM") || has("ANMF")) {
    flags |= WEBP_FLAG_ANIMATION;
  }

  const vp8l = chunks.find((chunk) => chunk.type === "VP8L");
  if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
    const packed =
      (vp8l.data[1] |
        (vp8l.data[2] << 8) |
        (vp8l.data[3] << 16) |
        (vp8l.data[4] << 24)) >>>
      0;
    if ((packed & (1 << 28)) !== 0) {
      flags |= WEBP_FLAG_ALPHA;
    }
  }

  flags |= WEBP_FLAG_XMP;
  return flags;
}

async function embedWebPMetadata(blob, bytes, metadataJson) {
  const parsedChunks = parseWebPChunks(bytes);
  const chunks = parsedChunks.filter((chunk) => chunk.type !== "XMP ");
  const xmpChunk = buildWebPXmpChunk(metadataJson);

  const vp8xIndex = chunks.findIndex((chunk) => chunk.type === "VP8X");
  if (vp8xIndex >= 0) {
    const existing = chunks[vp8xIndex];
    const data = new Uint8Array(10);
    data.set(existing.data.subarray(0, Math.min(10, existing.data.length)));
    data[0] |= WEBP_FLAG_XMP;
    chunks[vp8xIndex] = { type: "VP8X", data };
  } else {
    const { width, height } = await getWebPDimensions(blob, chunks);
    const flags = inferWebPFlags(chunks);
    chunks.unshift({
      type: "VP8X",
      data: createWebPVp8xData(flags, width, height)
    });
  }

  const xmpInsertIndex = chunks.findIndex(
    (chunk) => chunk.type === "VP8 " || chunk.type === "VP8L"
  );
  if (xmpInsertIndex >= 0) {
    chunks.splice(xmpInsertIndex, 0, xmpChunk);
  } else {
    chunks.push(xmpChunk);
  }

  const chunkBytes = chunks.map((chunk) => webPChunk(chunk.type, chunk.data));
  const webpPayload = concatBytes([encodeAscii("WEBP"), ...chunkBytes]);
  const output = concatBytes([encodeAscii("RIFF"), writeUint32LE(webpPayload.length), webpPayload]);
  return output;
}

export async function embedMetadata(blob, format, metadata) {
  const normalized = String(format).toLowerCase();
  const metadataJson = JSON.stringify(metadata);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (normalized === "png") {
    const payload = embedPngMetadata(bytes, metadataJson);
    return new Blob([payload], { type: "image/png" });
  }

  if (normalized === "jpg" || normalized === "jpeg") {
    const payload = embedJpegMetadata(bytes, metadataJson);
    return new Blob([payload], { type: "image/jpeg" });
  }

  if (normalized === "webp") {
    const payload = await embedWebPMetadata(blob, bytes, metadataJson);
    return new Blob([payload], { type: "image/webp" });
  }

  return blob;
}
