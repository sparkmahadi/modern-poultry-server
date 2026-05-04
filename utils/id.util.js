const { ObjectId } = require("mongodb");

function extractProductId(rawId) {
  if (!rawId) return null;
  if (typeof rawId === "object" && rawId.$oid) return rawId.$oid;
  if (typeof rawId === "string") return rawId;
  if (rawId instanceof ObjectId) return rawId.toString();
  return null;
}

/**
 * UNIVERSAL ID NORMALIZER
 * - handles string, ObjectId, { $oid }
 * - safely converts only when valid
 */
function normalizeId(value, { asObjectId = false } = {}) {
  if (!value) return null;

  let id = value;

  // 1️⃣ Mongo export format { $oid: "..." }
  if (typeof id === "object" && id.$oid) {
    id = id.$oid;
  }

  // 2️⃣ ObjectId instance
  if (id instanceof ObjectId) {
    return asObjectId ? id : id.toString();
  }

  // 3️⃣ string
  if (typeof id === "string") {
    const isMongoId = ObjectId.isValid(id);

    if (isMongoId) {
      return asObjectId ? new ObjectId(id) : id;
    }

    // business ID like "item001"
    return id;
  }

  return null;
}


const normalizeIdV2 = (value, label = "id") => {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }

  let id = value;

  // Handle { $oid }
  if (typeof id === "object" && id !== null && id.$oid) {
    id = id.$oid;
  }

  // Already ObjectId
  if (id instanceof ObjectId) {
    return id;
  }

  // String → validate
  if (typeof id === "string" && ObjectId.isValid(id)) {
    return new ObjectId(id);
  }

  console.error(`❌ Invalid ObjectId for ${label}:`, value);
  throw new Error(`Invalid ${label}`);
};

module.exports = { extractProductId, normalizeId, normalizeIdV2 };
