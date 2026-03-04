const mongoose = require('mongoose');
const PromoCode = require('./src/models/PromoCode');

async function reproduce() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test');
        console.log('Connected to DB');

        const userId = new mongoose.Types.ObjectId();
        const discount = 0;
        const commission = 0;
        const mediatorCommission = 10; // This exceeds max: 5 in schema

        const promoCode = new PromoCode({
            code: 'TESTCOUPON' + Date.now(),
            type: 'percentage',
            value: 0,
            status: 'active',
            influencerId: userId,
            isInfluencerCoupon: true,
            commissionSplit: {
                buyerDiscount: Number(discount) || 0,
                influencerCommission: Number(commission) || 0,
                mediatorCommission: Number(mediatorCommission) || 10
            }
        });

        console.log('Attempting to save...');
        await promoCode.save();
        console.log('Saved successfully');
    } catch (error) {
        console.error('Caught error:', error.message);
        if (error.errors) {
            Object.keys(error.errors).forEach(key => {
                console.error(`- Field ${key}: ${error.errors[key].message}`);
            });
        }
    } finally {
        await mongoose.disconnect();
    }
}

reproduce();
