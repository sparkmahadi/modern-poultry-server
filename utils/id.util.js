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


module.exports = { extractProductId, normalizeId };
