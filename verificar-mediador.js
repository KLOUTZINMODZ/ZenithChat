#!/usr/bin/env node
/**
 * Script para verificar se o usuário mediador existe no banco de dados
 * 
 * Uso: node verificar-mediador.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const MONGODB_URI = process.env.MONGODB_URI;
const MEDIATOR_USER_ID = process.env.MEDIATOR_USER_ID;
const MEDIATOR_EMAIL = process.env.MEDIATOR_EMAIL;

async function verificarMediator() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    console.log('📋 Configurações do .env:');
    console.log('  MEDIATOR_USER_ID:', MEDIATOR_USER_ID || '(não configurado)');
    console.log('  MEDIATOR_EMAIL:', MEDIATOR_EMAIL || '(não configurado)');
    console.log('');

    let mediadorEncontrado = null;

    // 1. Tentar buscar por ID
    if (MEDIATOR_USER_ID) {
      console.log('🔍 Buscando mediador por ID...');
      try {
        mediadorEncontrado = await User.findById(MEDIATOR_USER_ID);
        if (mediadorEncontrado) {
          console.log('✅ Mediador encontrado por ID!');
          console.log('  _id:', mediadorEncontrado._id);
          console.log('  email:', mediadorEncontrado.email);
          console.log('  name:', mediadorEncontrado.name);
          console.log('  walletBalance:', mediadorEncontrado.walletBalance);
          console.log('');
        } else {
          console.log('❌ Mediador NÃO encontrado por ID:', MEDIATOR_USER_ID);
          console.log('');
        }
      } catch (err) {
        console.error('❌ Erro ao buscar por ID:', err.message);
        console.log('');
      }
    }

    // 2. Tentar buscar por email
    if (!mediadorEncontrado && MEDIATOR_EMAIL) {
      console.log('🔍 Buscando mediador por email...');
      try {
        mediadorEncontrado = await User.findOne({ email: MEDIATOR_EMAIL });
        if (mediadorEncontrado) {
          console.log('✅ Mediador encontrado por email!');
          console.log('  _id:', mediadorEncontrado._id);
          console.log('  email:', mediadorEncontrado.email);
          console.log('  name:', mediadorEncontrado.name);
          console.log('  walletBalance:', mediadorEncontrado.walletBalance);
          console.log('');
        } else {
          console.log('❌ Mediador NÃO encontrado por email:', MEDIATOR_EMAIL);
          console.log('');
        }
      } catch (err) {
        console.error('❌ Erro ao buscar por email:', err.message);
        console.log('');
      }
    }

    // 3. Resultado final
    if (mediadorEncontrado) {
      console.log('✅ RESULTADO: Mediador CONFIGURADO CORRETAMENTE!');
      console.log('');
      console.log('📊 Dados do Mediador:');
      console.log('  ID:', mediadorEncontrado._id.toString());
      console.log('  Email:', mediadorEncontrado.email);
      console.log('  Nome:', mediadorEncontrado.name);
      console.log('  Saldo Atual:', `R$ ${(mediadorEncontrado.walletBalance || 0).toFixed(2)}`);
      console.log('');
      console.log('✅ O sistema de boosting deve funcionar corretamente!');
      console.log('');
      
      // Sugestão de atualização do .env
      if (MEDIATOR_USER_ID !== mediadorEncontrado._id.toString()) {
        console.log('⚠️ ATENÇÃO: O ID no .env está diferente do banco!');
        console.log('');
        console.log('📝 Atualize o .env para:');
        console.log(`MEDIATOR_USER_ID=${mediadorEncontrado._id.toString()}`);
        console.log(`MEDIATOR_EMAIL=${mediadorEncontrado.email}`);
        console.log('');
      }
    } else {
      console.log('❌ RESULTADO: Mediador NÃO ENCONTRADO!');
      console.log('');
      console.log('🚨 AÇÃO NECESSÁRIA: Criar usuário mediador no banco de dados');
      console.log('');
      console.log('📝 Opções:');
      console.log('');
      console.log('1. Criar via MongoDB Shell:');
      console.log('```javascript');
      console.log('db.users.insertOne({');
      console.log('  email: "mediador@zenith.com",');
      console.log('  name: "Mediador Zenith",');
      console.log('  username: "mediador",');
      console.log('  password: "$2b$10$...",  // Hash bcrypt');
      console.log('  role: "admin",');
      console.log('  walletBalance: 0,');
      console.log('  isActive: true,');
      console.log('  isVerified: true,');
      console.log('  createdAt: new Date(),');
      console.log('  updatedAt: new Date()');
      console.log('});');
      console.log('```');
      console.log('');
      console.log('2. Usar um usuário admin existente:');
      console.log('   - Busque um usuário admin no banco');
      console.log('   - Configure o ID dele no .env como MEDIATOR_USER_ID');
      console.log('');
      console.log('3. Criar via painel administrativo (se disponível)');
      console.log('');
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Desconectado do MongoDB');
  }
}

// Executar
verificarMediator();
