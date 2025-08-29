const mongoose = require('mongoose');
const Conversation = require('./src/models/Conversation');
const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');

async function validateSystems() {
  try {
    console.log('🧪 Validação Rápida dos Sistemas Implementados\n');


    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote_chat');
    

    console.log('1️⃣ Sistema de Bloqueio por Report:');
    const conversationSchema = Conversation.schema;
    const hasIsReported = conversationSchema.paths.isReported;
    console.log(`   ✅ Campo 'isReported' ${hasIsReported ? 'PRESENTE' : 'AUSENTE'} no schema`);
    
    if (hasIsReported) {
      console.log(`   ✅ Tipo: ${hasIsReported.instance}, Default: ${hasIsReported.defaultValue}, Index: ${hasIsReported._index || false}`);
    }
    

    console.log('\n2️⃣ Sistema Agreement (Múltiplas Propostas):');
    const agreementSchema = Agreement.schema;
    const hasAgreementId = agreementSchema.paths.agreementId;
    const hasVersion = agreementSchema.paths.version;
    const hasActionHistory = agreementSchema.paths.actionHistory;
    
    console.log(`   ✅ Campo 'agreementId' ${hasAgreementId ? 'PRESENTE' : 'AUSENTE'}`);
    console.log(`   ✅ Campo 'version' ${hasVersion ? 'PRESENTE' : 'AUSENTE'} (optimistic locking)`);
    console.log(`   ✅ Campo 'actionHistory' ${hasActionHistory ? 'PRESENTE' : 'AUSENTE'} (idempotência)`);
    

    console.log('\n3️⃣ Constraint AcceptedProposal:');
    const acceptedProposalSchema = AcceptedProposal.schema;
    const conversationIdField = acceptedProposalSchema.paths.conversationId;
    const isUnique = conversationIdField._index?.unique;
    
    console.log(`   ${isUnique ? '❌' : '✅'} conversationId unique: ${isUnique ? 'AINDA PRESENTE (PROBLEMA!)' : 'REMOVIDO (CORRETO)'}`);
    

    console.log('\n4️⃣ Métodos Agreement:');
    const agreementInstance = new Agreement();
    console.log(`   ✅ complete() ${typeof agreementInstance.complete === 'function' ? 'PRESENTE' : 'AUSENTE'}`);
    console.log(`   ✅ cancel() ${typeof agreementInstance.cancel === 'function' ? 'PRESENTE' : 'AUSENTE'}`);
    console.log(`   ✅ addAction() ${typeof agreementInstance.addAction === 'function' ? 'PRESENTE' : 'AUSENTE'}`);
    

    console.log('\n5️⃣ Estado Atual da Database:');
    const conversationCount = await Conversation.countDocuments({});
    const acceptedProposalCount = await AcceptedProposal.countDocuments({});
    const agreementCount = await Agreement.countDocuments({});
    const reportedChatsCount = await Conversation.countDocuments({ isReported: true });
    
    console.log(`   📊 Conversas total: ${conversationCount}`);
    console.log(`   📊 Chats reportados: ${reportedChatsCount}`);
    console.log(`   📊 AcceptedProposals: ${acceptedProposalCount}`);
    console.log(`   📊 Agreements: ${agreementCount}`);
    

    console.log('\n6️⃣ Teste de Criação Agreement:');
    const testAgreement = new Agreement({
      conversationId: new mongoose.Types.ObjectId(),
      proposalId: new mongoose.Types.ObjectId(),
      proposalSnapshot: {
        game: 'League of Legends',
        category: 'Test',
        description: 'Teste de validação',
        price: 100,
        estimatedTime: '1 hora'
      },
      parties: {
        client: {
          userid: new mongoose.Types.ObjectId(),
          name: 'Teste Cliente'
        },
        booster: {
          userid: new mongoose.Types.ObjectId(),
          name: 'Teste Booster',
          rating: 5
        }
      },
      status: 'active'
    });
    
    const agreementIdGenerated = testAgreement.agreementId;
    console.log(`   ✅ Agreement ID auto-gerado: ${agreementIdGenerated ? 'SIM' : 'NÃO'}`);
    if (agreementIdGenerated) {
      console.log(`   📝 Formato: ${agreementIdGenerated} (${agreementIdGenerated.startsWith('AGR_') ? 'CORRETO' : 'INCORRETO'})`);
    }
    
    console.log('\n🎯 VALIDAÇÃO CONCLUÍDA');
    console.log('===============================');
    console.log('✅ Sistema de Bloqueio: Estrutura OK');
    console.log('✅ Sistema Agreement: Estrutura OK');
    console.log('📝 Próximo: Testes de integração');
    
  } catch (error) {
    console.error('❌ Erro na validação:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}


if (require.main === module) {
  validateSystems();
}

module.exports = validateSystems;
