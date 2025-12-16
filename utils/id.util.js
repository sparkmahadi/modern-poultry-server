const { ObjectId } = require("mongodb");

function extractProductId(rawId) {
  if (!rawId) return null;
  if (typeof rawId === "object" && rawId.$oid) return rawId.$oid;
  if (typeof rawId === "string") return rawId;
  if (rawId instanceof ObjectId) return rawId.toString();
  return null;
}

module.exports = { extractProductId };
