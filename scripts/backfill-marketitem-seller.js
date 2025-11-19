#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const MarketItem = require('../src/models/MarketItem');
const Purchase = require('../src/models/Purchase');
const User = require('../src/models/User');

function safeId(v) {
  try {
    if (!v) return null;
    if (mongoose.Types.ObjectId.isValid(v)) return String(v);
    if (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v)) return v;
    if (typeof v === 'object') {
      if (v._id && mongoose.Types.ObjectId.isValid(v._id)) return String(v._id);
      if (v.$oid && typeof v.$oid === 'string' && mongoose.Types.ObjectId.isValid(v.$oid)) return v.$oid;
      if (typeof v.toHexString === 'function') return v.toHexString();
    }
  } catch (_) {}
  return null;
}

(async () => {
  console.log('[BACKFILL] Connecting to MongoDB...');
  await connectDB();

  const queryMissing = { $or: [ { userId: { $exists: false } }, { userId: null }, { sellerId: { $exists: false } }, { sellerId: null } ] };
  const totalMissing = await MarketItem.countDocuments(queryMissing);
  console.log(`[BACKFILL] Items missing seller userId: ${totalMissing}`);

  if (totalMissing === 0) {
    console.log('[BACKFILL] Nothing to do.');
    await mongoose.connection.close();
    process.exit(0);
  }

  const cursor = MarketItem.find(queryMissing).cursor();
  let resolved = 0;
  let unresolved = 0;
  const failures = [];

  for await (const item of cursor) {
    const candidates = [
      safeId(item.userId),
      safeId(item.ownerId),
      safeId(item.sellerId),
      safeId(item.user),
      safeId(item.createdBy)
    ].filter(Boolean);

    let sellerId = candidates[0] || null;

    if (!sellerId) {
      // Try infer from purchases referencing this item
      try {
        const p = await Purchase.findOne({ itemId: item._id }).sort({ createdAt: 1 }).select('sellerId');
        const inferred = safeId(p?.sellerId);
        if (inferred) sellerId = inferred;
      } catch (e) {}
    }

    if (sellerId) {
      // Validate user exists
      const user = await User.findById(sellerId).select('_id');
      if (!user) {
        console.warn(`[BACKFILL] Seller user not found for item ${item._id}: ${sellerId}`);
        unresolved++;
        failures.push({ itemId: String(item._id), reason: 'seller user not found', sellerId });
        continue;
      }
      item.userId = user._id;
      try { item.sellerId = user._id; } catch (_) {}
      await item.save();
      resolved++;
      console.log(`[BACKFILL] Set seller for item ${item._id} -> ${user._id}`);
    } else {
      unresolved++;
      failures.push({ itemId: String(item._id), reason: 'no candidate seller found' });
      console.warn(`[BACKFILL] No seller candidate for item ${item._id}`);
    }
  }

  console.log('[BACKFILL] Summary:', { totalMissing, resolved, unresolved });
  if (failures.length) {
    console.log('[BACKFILL] Unresolved items:', failures.slice(0, 50));
    if (failures.length > 50) {
      console.log(`[BACKFILL] ...and ${failures.length - 50} more`);
    }
    console.log('Use the admin endpoint to fix unresolved items individually:');
    console.log('PATCH /api/admin/market-items/:itemId/seller  {"sellerUserId":"<userId>"} with header X-Admin-Key');
  }

  await mongoose.connection.close();
  process.exit(0);
})();
