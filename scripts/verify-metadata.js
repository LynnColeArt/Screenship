#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/\0";
const KEYWORD = "screenship.meta";

function usage() {
  console.error("Usage: node scripts/verify-metadata.js <image-file>");
}

function decodeAscii(buffer) {
  return Buffer.from(buffer).toString("ascii");
}

function xmlUnescape(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parsePngMetadata(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file.");
  }

  let cursor = 8;
  while (cursor + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const type = decodeAscii(bytes.subarray(cursor + 4, cursor + 8));
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) {
      throw new Error("Corrupt PNG chunk boundaries.");
    }

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "iTXt" || type === "tEXt") {
      const keywordEnd = data.indexOf(0);
      if (keywordEnd >= 0) {
        const keyword = decodeAscii(data.subarray(0, keywordEnd));
        if (keyword === KEYWORD) {
          if (type === "tEXt") {
            return data.subarray(keywordEnd + 1).toString("utf8");
          }

          const compressionFlag = data[keywordEnd + 1];
          if (compressionFlag !== 0) {
            throw new Error("Compressed iTXt is not supported by verifier.");
          }

          const langEnd = data.indexOf(0, keywordEnd + 3);
          if (langEnd < 0) {
            throw new Error("Invalid iTXt language tag field.");
          }
          const translatedEnd = data.indexOf(0, langEnd + 1);
          if (translatedEnd < 0) {
            throw new Error("Invalid iTXt translated keyword field.");
          }
          return data.subarray(translatedEnd + 1).toString("utf8");
        }
      }
    }

    cursor = chunkEnd;
    if (type === "IEND") {
      break;
    }
  }

  throw new Error("No ScreenShip metadata found in PNG.");
}

function parseJpegMetadata(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Not a JPEG file.");
  }

  const xmpPrefix = Buffer.from(XMP_NAMESPACE, "ascii");
  let cursor = 2;

  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff || cursor + 1 >= bytes.length) {
      break;
    }

    while (cursor < bytes.length && bytes[cursor] === 0xff) {
      cursor += 1;
    }
    if (cursor >= bytes.length) {
      break;
    }

    const marker = bytes[cursor];
    cursor += 1;

    if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (cursor + 1 >= bytes.length) {
      break;
    }

    const segmentLength = bytes.readUInt16BE(cursor);
    if (segmentLength < 2) {
      throw new Error("Invalid JPEG segment length.");
    }

    const segmentDataStart = cursor + 2;
    const segmentDataEnd = segmentDataStart + segmentLength - 2;
    if (segmentDataEnd > bytes.length) {
      throw new Error("Corrupt JPEG segment boundaries.");
    }

    if (marker === 0xe1) {
      const payload = bytes.subarray(segmentDataStart, segmentDataEnd);
      if (payload.subarray(0, xmpPrefix.length).equals(xmpPrefix)) {
        const xmp = payload.subarray(xmpPrefix.length).toString("utf8");
        const match = xmp.match(/<screenship:payload>([\s\S]*?)<\/screenship:payload>/);
        if (!match) {
          throw new Error("Found XMP but no ScreenShip payload field.");
        }
        return xmlUnescape(match[1]);
      }
    }

    if (marker === 0xda) {
      break;
    }

    cursor = segmentDataEnd;
  }

  throw new Error("No ScreenShip metadata found in JPEG.");
}

function parseWebpMetadata(bytes) {
  if (
    bytes.length < 12 ||
    decodeAscii(bytes.subarray(0, 4)) !== "RIFF" ||
    decodeAscii(bytes.subarray(8, 12)) !== "WEBP"
  ) {
    throw new Error("Not a WebP file.");
  }

  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const type = decodeAscii(bytes.subarray(cursor, cursor + 4));
    const size = bytes.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + (size % 2);
    if (chunkEnd > bytes.length) {
      throw new Error("Corrupt WebP chunk boundaries.");
    }

    if (type === "XMP ") {
      const xmp = bytes.subarray(dataStart, dataEnd).toString("utf8");
      const match = xmp.match(/<screenship:payload>([\s\S]*?)<\/screenship:payload>/);
      if (!match) {
        throw new Error("Found WebP XMP but no ScreenShip payload field.");
      }
      return xmlUnescape(match[1]);
    }

    cursor = chunkEnd;
  }

  throw new Error("No ScreenShip metadata found in WebP.");
}

function main() {
  const target = process.argv[2];
  if (!target) {
    usage();
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), target);
  const bytes = fs.readFileSync(filePath);

  let format = "";
  let metadataText = "";

  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    format = "png";
    metadataText = parsePngMetadata(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = "jpg";
    metadataText = parseJpegMetadata(bytes);
  } else if (decodeAscii(bytes.subarray(0, 4)) === "RIFF" && decodeAscii(bytes.subarray(8, 12)) === "WEBP") {
    format = "webp";
    metadataText = parseWebpMetadata(bytes);
  } else {
    throw new Error("Unsupported file format.");
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch (error) {
    throw new Error(`Metadata payload is not valid JSON: ${error.message}`);
  }

  console.log(`Format: ${format}`);
  console.log(JSON.stringify(metadata, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`verify-metadata failed: ${error.message}`);
  process.exit(2);
}

