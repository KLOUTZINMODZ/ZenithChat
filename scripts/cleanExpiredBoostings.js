/**
 * Script para limpar pedidos de boosting expirados
 * 
 * Deleta pedidos de boosting que:
 * - Foram criados há mais de 3 dias
 * - Não possuem nenhuma proposta aceita
 * - Estão com status 'open'
 * 
 * Uso:
 * node scripts/cleanExpiredBoostings.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BoostingRequest = require('../src/models/BoostingRequest');
const AcceptedProposal = require('../src/models/AcceptedProposal');
const axios = require('axios');

const HACKLOTE_API_URL = process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api';
const EXPIRATION_DAYS = 3;

/**
 * Conecta ao MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error.message);
    process.exit(1);
  }
}

/**
 * Verifica e deleta pedidos de boosting expirados
 */
async function cleanExpiredBoostings() {
  try {
    // Data limite: 3 dias atrás
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - EXPIRATION_DAYS);

    console.log(`🔍 Buscando pedidos de boosting criados antes de ${expirationDate.toISOString()}`);

    // Buscar pedidos de boosting expirados com status 'open'
    const expiredBoostings = await BoostingRequest.find({
      createdAt: { $lt: expirationDate },
      status: 'open'
    });

    console.log(`📊 Encontrados ${expiredBoostings.length} pedidos expirados`);

    if (expiredBoostings.length === 0) {
      console.log('✅ Nenhum pedido expirado para limpar');
      return { deleted: 0, checked: 0 };
    }

    let deletedCount = 0;
    let checkedCount = 0;

    // Para cada pedido expirado
    for (const boosting of expiredBoostings) {
      checkedCount++;
      
      try {
        // Verificar se existe proposta aceita para este boosting
        const hasAcceptedProposal = await AcceptedProposal.findOne({
          boostingId: boosting._id.toString(),
          status: { $in: ['pending', 'in_progress', 'completed'] }
        });

        if (hasAcceptedProposal) {
          console.log(`⏭️  Pedido ${boosting._id} possui proposta aceita, mantendo...`);
          continue;
        }

        // Verificar na API principal se há propostas pendentes
        let hasPendingProposals = false;
        try {
          const proposalsResponse = await axios.get(
            `${HACKLOTE_API_URL}/boosting/${boosting._id}/proposals`,
            {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 5000
            }
          );

          if (proposalsResponse.data?.success && proposalsResponse.data?.data?.proposals) {
            const pendingProposals = proposalsResponse.data.data.proposals.filter(
              p => p.status === 'pending' || p.status === 'accepted'
            );
            hasPendingProposals = pendingProposals.length > 0;
          }
        } catch (apiError) {
          console.warn(`⚠️  Erro ao verificar propostas na API para boosting ${boosting._id}:`, apiError.message);
          // Se falhar a verificação na API, não deletar por segurança
          continue;
        }

        if (hasPendingProposals) {
          console.log(`⏭️  Pedido ${boosting._id} possui propostas pendentes na API, mantendo...`);
          continue;
        }

        // Nenhuma proposta encontrada, pode deletar
        console.log(`🗑️  Deletando pedido ${boosting._id} (criado em ${boosting.createdAt})`);
        
        // Deletar da API principal primeiro
        try {
          await axios.delete(
            `${HACKLOTE_API_URL}/boosting/${boosting._id}`,
            {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 5000
            }
          );
          console.log(`  ✅ Deletado da API principal`);
        } catch (apiError) {
          console.warn(`  ⚠️  Erro ao deletar da API principal:`, apiError.message);
          // Continuar mesmo se falhar na API
        }

        // Deletar do MongoDB local
        await BoostingRequest.deleteOne({ _id: boosting._id });
        console.log(`  ✅ Deletado do MongoDB local`);
        
        deletedCount++;

      } catch (error) {
        console.error(`❌ Erro ao processar boosting ${boosting._id}:`, error.message);
      }
    }

    console.log(`\n📊 Resumo:`);
    console.log(`   - Pedidos verificados: ${checkedCount}`);
    console.log(`   - Pedidos deletados: ${deletedCount}`);
    console.log(`   - Pedidos mantidos: ${checkedCount - deletedCount}`);

    return { deleted: deletedCount, checked: checkedCount };

  } catch (error) {
    console.error('❌ Erro ao limpar pedidos expirados:', error.message);
    throw error;
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('🚀 Iniciando limpeza de pedidos de boosting expirados');
    console.log(`⏰ Data limite: ${EXPIRATION_DAYS} dias atrás\n`);

    await connectDB();
    
    const result = await cleanExpiredBoostings();

    console.log('\n✅ Limpeza concluída com sucesso!');
    
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { cleanExpiredBoostings };
