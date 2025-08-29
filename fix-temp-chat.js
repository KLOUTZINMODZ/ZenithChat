const mongoose = require('mongoose');
const Conversation = require('./src/models/Conversation');
const User = require('./src/models/User');

async function fixTemporaryChat() {
  try {
    await mongoose.connect('mongodb+srv://safiraapp:VMzGa4PwN3PUIb4w@bankklouts.iihzq.mongodb.net/?retryWrites=true&w=majority&appName=BankKlouts&connectTimeoutMS=10000&socketTimeoutMS=45000&serverSelectionTimeoutMS=10000');
    console.log('✅ Conectado ao MongoDB');
    
    const temporaryChat = await Conversation.findById('68b1143dcccd0ba052da097f');
    
    if (!temporaryChat) {
      console.log('❌ Chat temporário não encontrado');
      return;
    }
    
    console.log('🔍 Chat temporário encontrado:', {
      id: temporaryChat._id,
      participants: temporaryChat.participants,
      isTemporary: temporaryChat.isTemporary,
      status: temporaryChat.status
    });
    
    const [clientUserId, boosterUserId] = temporaryChat.participants;
    
    const clientUser = await User.findById(clientUserId);
    const boosterUser = await User.findById(boosterUserId);
    
    if (!clientUser || !boosterUser) {
      console.log('❌ Usuários não encontrados');
      return;
    }
    
    console.log('👥 Usuários encontrados:', {
      client: { id: clientUser._id, name: clientUser.name },
      booster: { id: boosterUser._id, name: boosterUser.name }
    });
    
    temporaryChat.client = {
      userid: clientUser._id,
      name: clientUser.name,
      email: clientUser.email,
      avatar: clientUser.avatar || null,
      isVerified: clientUser.isVerified || false,
      totalOrders: clientUser.totalOrders || 0,
      rating: clientUser.rating || 0,
      registeredAt: clientUser.createdAt
    };
    
    temporaryChat.booster = {
      userid: boosterUser._id,
      name: boosterUser.name,
      email: boosterUser.email,
      avatar: boosterUser.avatar || null,
      isVerified: boosterUser.isVerified || false,
      rating: boosterUser.rating || 0,
      totalBoosts: boosterUser.totalBoosts || 0,
      completedBoosts: boosterUser.completedBoosts || 0,
      specializations: boosterUser.specializations || [],
      registeredAt: boosterUser.createdAt
    };
    
    await temporaryChat.save();
    
    console.log('✅ Chat temporário atualizado com sucesso!');
    console.log('🔍 Campos adicionados:', {
      hasClient: !!temporaryChat.client,
      hasBooster: !!temporaryChat.booster,
      clientName: temporaryChat.client?.name,
      boosterName: temporaryChat.booster?.name
    });
    
  } catch (error) {
    console.error('❌ Erro ao corrigir chat temporário:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Conexão MongoDB fechada');
  }
}

fixTemporaryChat();
