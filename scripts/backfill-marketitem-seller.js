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
  
  await connectDB();

  const queryMissing = { $or: [ { userId: { $exists: false } }, { userId: null }, { sellerId: { $exists: false } }, { sellerId: null } ] };
  const totalMissing = await MarketItem.countDocuments(queryMissing);
  

  if (totalMissing === 0) {
    
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
        
        unresolved++;
        failures.push({ itemId: String(item._id), reason: 'seller user not found', sellerId });
        continue;
      }
      item.userId = user._id;
      try { item.sellerId = user._id; } catch (_) {}
      await item.save();
      resolved++;
      
    } else {
      unresolved++;
      failures.push({ itemId: String(item._id), reason: 'no candidate seller found' });
      
    }
  }

  
  if (failures.length) {
    );
    if (failures.length > 50) {
      
    }
    
    
  }

  await mongoose.connection.close();
  process.exit(0);
})();
