const Purchase = require('../models/Purchase');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const Mediator = require('../models/Mediator');

function round2(v) { return Math.round(Number(v) * 100) / 100; }

async function sendBalanceUpdate(app, userId) {
  try {
    const u = await User.findById(userId);
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {
      notificationService.sendToUser(String(userId), {
        type: 'wallet:balance_updated',
        data: { userId: String(userId), balance: round2(u?.walletBalance || 0), timestamp: new Date().toISOString() }
      });
    }
  } catch (_) {}
}

async function runOnce(app) {
  const now = new Date();
  const candidates = await Purchase.find({ status: 'shipped', autoReleaseAt: { $lte: now } }).limit(50);
  for (const p of candidates) {
    try {
      const seller = await User.findById(p.sellerId);
      if (!seller) continue;
      const before = round2(seller.walletBalance || 0);
      const after = round2(before + Number(p.sellerReceives));
      seller.walletBalance = after;
      await seller.save();
      const release = await WalletLedger.create({
        userId: p.sellerId,
        txId: null,
        direction: 'credit',
        reason: 'purchase_release',
        amount: Number(p.sellerReceives),
        operationId: `purchase_release:${p._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', auto: true, purchaseId: p._id.toString(), itemId: p.itemId }
      });

      // Log platform release into 'mediator' collection (idempotent by operationId)
      try {
        const operationId = `release:${p._id.toString()}`;
        await Mediator.updateOne(
          { operationId },
          {
            $setOnInsert: {
              eventType: 'release',
              amount: Number(p.sellerReceives),
              currency: 'BRL',
              operationId,
              source: 'ZenithChatApi',
              occurredAt: new Date(),
              reference: {
                purchaseId: p._id,
                orderId: null,
                walletLedgerId: release?._id || null,
                transactionId: null,
                asaasTransferId: null
              },
              metadata: { auto: true, itemId: p.itemId },
              description: 'Liberação automática de escrow ao vendedor (background)'
            }
          },
          { upsert: true }
        );
      } catch (_) {}
      p.status = 'completed';
      p.logs.push({ level: 'info', message: 'Auto-release after 7 days from shipped (background)' });
      await p.save();
      await sendBalanceUpdate(app, p.sellerId);
    } catch (e) {
      try { p.logs.push({ level: 'error', message: 'Auto-release failed', data: { err: e?.message } }); await p.save(); } catch (_) {}
    }
  }
}

let timer = null;

module.exports = {
  start(app) {
    const interval = parseInt(process.env.PURCHASE_RELEASE_INTERVAL_MS || '1800000'); // 30m default
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      runOnce(app).catch(() => {});
    }, interval);
    // initial delay run
    setTimeout(() => runOnce(app).catch(() => {}), 10000);
  },
  stop() { if (timer) clearInterval(timer); timer = null; },
  runOnce
};
