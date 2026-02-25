
const mongoose = require('mongoose');
require('dotenv').config();

const promoCodeSchema = new mongoose.Schema({
    code: String,
    users: [{
        userId: mongoose.Schema.Types.ObjectId,
        cpfCnpj: String
    }],
    status: String
});

const PromoCode = mongoose.model('PromoCode', promoCodeSchema, 'promocodes');

async function diag() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote');
        const codes = await PromoCode.find({ status: 'active' });
        console.log('--- DIAGNOSTIC START ---');
        console.log('Total Active Codes:', codes.length);
        codes.forEach(c => {
            console.log(`Code: ${c.code}, Users Count: ${c.users.length}`);
            c.users.forEach(u => {
                console.log(`  - User: ${u.userId}, CPF: ${u.cpfCnpj}`);
            });
        });
        console.log('--- DIAGNOSTIC END ---');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

diag();
