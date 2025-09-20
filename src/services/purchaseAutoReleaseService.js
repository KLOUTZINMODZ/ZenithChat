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
              source: 'HackloteChatApi',
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

      // Credit mediator fee (5%) on auto-release and log into wallet ledger + mediator collection
      try {
        // Derive fee amount
        let feeAmount = Number(p.feeAmount || 0);
        if (!(feeAmount > 0)) {
          const price = Number(p.price || 0);
          const sellerNet = Number(p.sellerReceives || 0);
          if (price > 0 && sellerNet >= 0) feeAmount = Math.max(0, round2(price - sellerNet));
        }
        if (feeAmount > 0) {
          const opId = `purchase_fee:${p._id.toString()}`;
          // Idempotency: if ledger already exists for this fee, skip
          const existingFeeLedger = await WalletLedger.findOne({ reason: 'purchase_fee', operationId: opId });
          if (!existingFeeLedger) {
            // Find mediator user
            let mediatorUser = null;
            const envId = process.env.MEDIATOR_USER_ID;
            const envEmail = process.env.MEDIATOR_EMAIL;
            if (envId) { try { mediatorUser = await User.findById(envId); } catch (_) {} }
            if (!mediatorUser && envEmail) { try { mediatorUser = await User.findOne({ email: envEmail }); } catch (_) {} }
            if (mediatorUser) {
              const medBefore = round2(mediatorUser.walletBalance || 0);
              const medAfter = round2(medBefore + feeAmount);
              mediatorUser.walletBalance = medAfter;
              await mediatorUser.save();
              const feeLedger = await WalletLedger.create({
                userId: mediatorUser._id,
                txId: null,
                direction: 'credit',
                reason: 'purchase_fee',
                amount: feeAmount,
                operationId: opId,
                balanceBefore: medBefore,
                balanceAfter: medAfter,
                metadata: { source: 'purchase', auto: true, purchaseId: p._id.toString(), itemId: p.itemId, sellerId: p.sellerId, price: Number(p.price), feeAmount, sellerReceives: Number(p.sellerReceives) }
              });

              // Log mediator fee (idempotent via operationId)
              try {
                await Mediator.updateOne(
                  { operationId: opId },
                  {
                    $setOnInsert: {
                      eventType: 'fee',
                      amount: feeAmount,
                      currency: 'BRL',
                      operationId: opId,
                      source: 'HackloteChatApi',
                      occurredAt: new Date(),
                      reference: {
                        purchaseId: p._id,
                        orderId: null,
                        walletLedgerId: feeLedger?._id || null,
                        transactionId: null,
                        asaasTransferId: null
                      },
                      metadata: { auto: true, price: Number(p.price), feeAmount, sellerReceives: Number(p.sellerReceives), sellerId: p.sellerId, itemId: p.itemId },
                      description: 'Taxa de mediação (5%) creditada ao mediador (auto-release)'
                    }
                  },
                  { upsert: true }
                );
              } catch (_) {}

              // Notify mediator wallet update
              await sendBalanceUpdate(app, mediatorUser._id);
            }
          }
        }
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
