require('dotenv').config();
const mongoose = require('mongoose');
const HeroBanner = require('../src/models/HeroBanner');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
  } catch (error) {
    
    process.exit(1);
  }
};

const seedBanner = async () => {
  try {
    // Limpar banners existentes (opcional)
    // await HeroBanner.deleteMany({});
    // 

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
    
    

  } catch (error) {
    
  } finally {
    await mongoose.connection.close();
    
  }
};

const run = async () => {
  await connectDB();
  await seedBanner();
};

run();
