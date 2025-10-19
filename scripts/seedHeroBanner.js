require('dotenv').config();
const mongoose = require('mongoose');
const HeroBanner = require('../src/models/HeroBanner');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const seedBanner = async () => {
  try {
    // Limpar banners existentes (opcional)
    // await HeroBanner.deleteMany({});
    // console.log('🗑️  Banners existentes removidos');

    // Criar banner de exemplo
    const exampleBanner = new HeroBanner({
      order: 1,
      title: 'O Maior Marketplace',
      highlightText: 'de Games do Brasil',
      description: 'Compre, venda e troque skins, contas e boosts com segurança total. Junte-se a milhares de gamers que confiam em nossa plataforma.',
      backgroundImage: '/images/default-bg.svg', // Usar imagem padrão
      badge: {
        text: 'Novo',
        color: 'purple'
      },
      primaryButton: {
        text: 'Explorar Marketplace',
        link: '/marketplace'
      },
      secondaryButton: {
        text: 'Ver Boostings',
        link: '/boostings'
      },
      isActive: true
    });

    await exampleBanner.save();
    console.log('✅ Banner de exemplo criado com sucesso!');
    console.log(exampleBanner);

  } catch (error) {
    console.error('❌ Erro ao criar banner:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
  }
};

const run = async () => {
  await connectDB();
  await seedBanner();
};

run();
