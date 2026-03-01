const PromoCode = require('../models/PromoCode');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const WalletTransaction = require('../models/WalletTransaction');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const crypto = require('crypto');

function round2(v) {
    return Math.round(Number(v) * 100) / 100;
}

// Helper for atomic wallet operations
async function runWithTransactionOrFallback(executor) {
    let session;
    try {
        session = await mongoose.startSession();
        session.startTransaction();
        const res = await executor(session);
        await session.commitTransaction();
        session.endSession();
        return res;
    } catch (err) {
        if (session) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
        }
        return executor(null);
    }
}

const promoCodeController = {
    // --- ADMIN METHODS ---

    createCode: async (req, res) => {
        try {
            const {
                code, type, value, validFrom, validUntil, maxUses, description,
                influencerId, isInfluencerCoupon, commissionSplit
            } = req.body;

            const existing = await PromoCode.findOne({ code: code.toUpperCase() });
            if (existing) {
                return res.status(400).json({ success: false, message: 'Código já existe' });
            }

            const newCode = await PromoCode.create({
                code: code.toUpperCase(),
                type,
                value,
                validFrom,
                validUntil,
                maxUses,
                description,
                influencerId: influencerId || null,
                isInfluencerCoupon: !!isInfluencerCoupon,
                commissionSplit: commissionSplit || {
                    buyerDiscount: 0,
                    influencerCommission: 0,
                    mediatorCommission: 5
                }
            });

            return res.status(201).json({ success: true, data: newCode });
        } catch (error) {
            logger.error('Error creating promo code:', error);
            return res.status(500).json({ success: false, message: 'Erro ao criar código', error: error.message });
        }
    },

    listCodes: async (req, res) => {
        try {
            const codes = await PromoCode.find().populate('users.userId', 'name email profileImage').sort('-createdAt');
            return res.json({ success: true, data: codes });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Erro ao listar códigos' });
        }
    },

    updateCode: async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            const updated = await PromoCode.findByIdAndUpdate(id, updates, { new: true });
            return res.json({ success: true, data: updated });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Erro ao atualizar código' });
        }
    },

    // --- USER METHODS ---

    redeemCode: async (req, res) => {
        try {
            let { code, cpfCnpj: cpfInput } = req.body;

            // Decodificar CPF se estiver em Base64 (para maior privacidade no tráfego)
            if (cpfInput && !/^\d+$/.test(cpfInput)) {
                try {
                    cpfInput = Buffer.from(cpfInput, 'base64').toString('utf-8');
                } catch (e) {
                    logger.warn('Failed to decode CPF base64', { cpfInput });
                }
            }
            const userId = req.user._id;

            if (!code) return res.status(400).json({ success: false, message: 'Código é obrigatório' });

            const promo = await PromoCode.findOne({ code: code.toUpperCase(), status: 'active' });
            if (!promo) return res.status(404).json({ success: false, message: 'Código inválido ou inativo' });

            // Block influencer coupons from direct wallet redemption
            if (promo.isInfluencerCoupon) {
                return res.status(400).json({
                    success: false,
                    message: 'Este é um cupom de influenciador e deve ser usado no momento da compra de um item.'
                });
            }

            // Check validity dates (com margem de 2 horas para fuso horário)
            const now = new Date();
            const gracePeriod = 2 * 60 * 60 * 1000; // 2 horas de tolerância
            if (promo.validFrom && (now.getTime() + gracePeriod) < promo.validFrom.getTime()) {
                return res.status(400).json({ success: false, message: 'Código ainda não está ativo' });
            }
            if (promo.validUntil && now > promo.validUntil) {
                return res.status(400).json({ success: false, message: 'Código expirado' });
            }

            // Check max uses
            if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
                return res.status(400).json({ success: false, message: 'Limite de usos atingido' });
            }

            // Check if user already redeemed
            if (promo.users.some(u => u.userId.toString() === userId.toString())) {
                return res.status(400).json({ success: false, message: 'Você já resgatou este código' });
            }

            // Atomic Redemption
            const result = await runWithTransactionOrFallback(async (session) => {
                // Fetch promo and user within session
                const p = session ? await PromoCode.findById(promo._id).session(session) : promo;
                const u = session ? await User.findById(userId).session(session) : await User.findById(userId);

                if (p.maxUses !== null && p.currentUses >= p.maxUses) throw new Error('LIMIT_REACHED');
                if (p.users.some(redemption => redemption.userId.toString() === userId.toString())) throw new Error('ALREADY_REDEEMED');

                // --- ATOMIC CPF VALIDATION ---
                const inputDigits = cpfInput ? String(cpfInput).replace(/\D/g, '') : null;
                const linkedDigits = u.pixKeyNormalized || u.cpfCnpj;
                let finalCpfDigits;

                if (linkedDigits) {
                    if (inputDigits && inputDigits !== linkedDigits) {
                        throw new Error('CPF_MISMATCH');
                    }
                    finalCpfDigits = linkedDigits;
                } else {
                    if (!inputDigits) throw new Error('CPF_REQUIRED');
                    if (inputDigits.length !== 11) throw new Error('CPF_INVALID');

                    const h = crypto.createHash('sha256').update(`CPF:${inputDigits}`).digest('hex');
                    const fp = `sha256:${h}`;

                    const exists = await User.findOne({ pixKeyFingerprint: fp, _id: { $ne: u._id } }).session(session);
                    if (exists) throw new Error('CPF_ALREADY_IN_USE');

                    u.pixKeyType = 'CPF';
                    u.pixKeyNormalized = inputDigits;
                    u.pixKeyFingerprint = fp;
                    u.pixKeyLinkedAt = new Date();
                    u.cpfCnpj = inputDigits;
                    finalCpfDigits = inputDigits;
                    // We'll save 'u' later along with balance
                }

                const balanceBefore = round2(u.walletBalance || 0);

                let creditAmount = 0;
                if (p.type === 'fixed') {
                    creditAmount = p.value;
                } else {
                    // Percentage could be based on something, but here we assume it's a direct gift value
                    // If it's a gift card, usually it's fixed. 
                    creditAmount = p.value;
                }

                u.walletBalance = round2(balanceBefore + creditAmount);
                await u.save({ session });

                // Record usage in PromoCode
                p.currentUses += 1;
                p.users.push({
                    userId,
                    redeemedAt: new Date(),
                    cpfCnpj: digits
                });
                await p.save({ session });

                // Create Transaction Record
                const tx = await WalletTransaction.create([{
                    userId,
                    type: 'deposit',
                    amountGross: creditAmount,
                    amountNet: creditAmount,
                    status: 'credited',
                    description: `Resgate de código: ${p.code}`,
                    metadata: { cupomreward: true, code: p.code },
                    logs: [{ level: 'info', message: 'Promo code redeemed', data: { code: p.code, value: creditAmount } }]
                }], { session });

                // Create Ledger Record
                await WalletLedger.create([{
                    userId,
                    txId: tx[0]._id,
                    direction: 'credit',
                    reason: 'promo_code_redemption',
                    amount: creditAmount,
                    operationId: `promo:${p.code}:${userId}:${Date.now()}`,
                    balanceBefore,
                    balanceAfter: u.walletBalance,
                    metadata: { cupomreward: true, code: p.code }
                }], { session });

                return { success: true, newBalance: u.walletBalance, amount: creditAmount, user: u };
            });

            if (result.success) {
                // Send balance update via WebSocket if available
                const notificationService = req.app.locals.notificationService;
                if (notificationService) {
                    notificationService.sendToUser(String(userId), {
                        type: 'wallet:balance_updated',
                        data: {
                            userId: String(userId),
                            balance: result.newBalance,
                            timestamp: new Date().toISOString()
                        }
                    });
                }

                return res.json({
                    success: true,
                    message: `Código resgatado com sucesso! Você recebeu R$ ${result.amount.toFixed(2)}`,
                    data: {
                        balance: result.newBalance,
                        user: result.user
                    }
                });
            } else {
                throw new Error('Falha no resgate');
            }

        } catch (error) {
            logger.error('Redeem error:', error);
            if (error.message === 'LIMIT_REACHED') return res.status(400).json({ success: false, message: 'Limite de usos atingido' });
            if (error.message === 'ALREADY_REDEEMED') return res.status(400).json({ success: false, message: 'Você já resgatou este código' });
            if (error.message === 'CPF_MISMATCH') return res.status(400).json({ success: false, message: 'O CPF informado não coincide com o CPF vinculado à sua conta.' });
            if (error.message === 'CPF_REQUIRED') return res.status(400).json({ success: false, message: 'CPF é obrigatório para o primeiro resgate por motivos de segurança.' });
            if (error.message === 'CPF_INVALID') return res.status(400).json({ success: false, message: 'CPF inválido. Certifique-se de preencher os 11 dígitos.' });
            if (error.message === 'CPF_ALREADY_IN_USE') return res.status(409).json({ success: false, message: 'Este CPF já está vinculado a outra conta.' });

            return res.status(500).json({ success: false, message: 'Erro ao processar resgate' });
        }
    }
};

module.exports = promoCodeController;
