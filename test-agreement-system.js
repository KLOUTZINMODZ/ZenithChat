const axios = require('axios');


const BASE_URL = 'http://zenith.enrelyugi.com.br/api';
const TEST_JWT = 'your_test_jwt_token_here';

class AgreementSystemTest {
  constructor() {
    this.conversationId = '675b6e7a2e5f8d001f123457';
    this.firstAgreementId = null;
    this.secondAgreementId = null;
    this.clientUserId = '675a1b2c3d4e5f6789abcdef';
    this.boosterUserId = '675a1b2c3d4e5f6789abcde0';
  }

  async setup() {
    console.log('🚀 Iniciando teste do sistema Agreement (múltiplas propostas)...\n');
  }


  async testCreateFirstProposal() {
    console.log('📝 Teste 1: Criar primeira proposta aceita');
    
    try {
      const proposalData = {
        conversationId: this.conversationId,
        proposalId: 'prop_123_first',
        proposalData: {
          game: 'League of Legends',
          category: 'Elo Boost',
          currentRank: 'Gold III',
          desiredRank: 'Platinum I',
          description: 'Boost até Platinum com duo queue',
          price: 150,
          estimatedTime: '3 dias'
        },
        clientData: {
          userid: this.clientUserId,
          name: 'Cliente Teste',
          email: 'cliente@test.com',
          avatar: 'avatar1.jpg',
          isVerified: true,
          totalOrders: 5,
          rating: 4.5
        },
        boosterData: {
          userid: this.boosterUserId,
          name: 'Booster Teste',
          email: 'booster@test.com',
          avatar: 'avatar2.jpg',
          isVerified: true,
          rating: 4.8,
          totalBoosts: 50,
          completedBoosts: 48
        }
      };

      const response = await axios.post(`${BASE_URL}/boosting-chat/proposal/save`, proposalData, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `first_proposal_${Date.now()}`
        }
      });

      if (response.data.success) {
        console.log('✅ Primeira proposta criada com sucesso');
        console.log(`📄 AcceptedProposal ID: ${response.data.proposalId}`);
        console.log(`📋 Agreement ID: ${response.data.agreementId}`);
        this.firstAgreementId = response.data.agreementId;
      } else {
        console.log('❌ Falha ao criar primeira proposta:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro ao criar primeira proposta:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testCreateSecondProposal() {
    console.log('📝 Teste 2: Criar segunda proposta do MESMO booster');
    
    try {
      const proposalData = {
        conversationId: this.conversationId,
        proposalId: 'prop_123_second',
        proposalData: {
          game: 'League of Legends',
          category: 'Coaching',
          description: 'Coaching personalizado para melhorar gameplay',
          price: 80,
          estimatedTime: '2 horas'
        },
        clientData: {
          userid: this.clientUserId,
          name: 'Cliente Teste',
          email: 'cliente@test.com'
        },
        boosterData: {
          userid: this.boosterUserId,
          name: 'Booster Teste',
          email: 'booster@test.com'
        }
      };

      const response = await axios.post(`${BASE_URL}/boosting-chat/proposal/save`, proposalData, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `second_proposal_${Date.now()}`
        }
      });

      if (response.data.success) {
        console.log('✅ Segunda proposta criada com sucesso (múltiplas propostas permitidas!)');
        console.log(`📋 Agreement ID: ${response.data.agreementId}`);
        console.log(`🔄 É múltipla: ${response.data.isMultiple ? 'SIM' : 'NÃO'}`);
        this.secondAgreementId = response.data.agreementId;
      } else {
        console.log('❌ Falha ao criar segunda proposta:', response.data.message);
      }
    } catch (error) {
      if (error.response?.status === 409) {
        console.log('❌ PROBLEMA: Sistema ainda está bloqueando múltiplas propostas!');
        console.log('🔧 Mensagem:', error.response.data.message);
      } else {
        console.log('⚠️ Erro ao criar segunda proposta:', error.response?.data?.message || error.message);
      }
    }
    console.log('');
  }


  async testListConversationAgreements() {
    console.log('📋 Teste 3: Listar agreements da conversa');
    
    try {
      const response = await axios.get(`${BASE_URL}/agreements/conversation/${this.conversationId}`, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`
        }
      });

      if (response.data.success) {
        const agreements = response.data.agreements;
        console.log(`✅ Encontrados ${agreements.length} agreement(s):`);
        
        agreements.forEach((agreement, index) => {
          console.log(`  ${index + 1}. Agreement: ${agreement.agreementId}`);
          console.log(`     Status: ${agreement.status}`);
          console.log(`     Preço: R$ ${agreement.proposalSnapshot.price}`);
          console.log(`     Categoria: ${agreement.proposalSnapshot.category}`);
        });
      } else {
        console.log('❌ Falha ao listar agreements:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro ao listar agreements:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testCompleteFirstAgreement() {
    console.log('✅ Teste 4: Completar primeiro agreement');
    
    if (!this.firstAgreementId) {
      console.log('❌ Erro: Primeiro agreement não disponível');
      return;
    }

    try {
      const response = await axios.post(`${BASE_URL}/agreements/${this.firstAgreementId}/complete`, {
        version: 1,
        completionNotes: 'Serviço entregue com sucesso - Elo Boost concluído'
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `complete_first_${Date.now()}`
        }
      });

      if (response.data.success) {
        console.log('✅ Primeiro agreement completado com sucesso');
        console.log(`📅 Completado em: ${response.data.agreement.completedAt}`);
        console.log(`🔢 Nova versão: ${response.data.agreement.version}`);
      } else {
        console.log('❌ Falha ao completar primeiro agreement:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro ao completar primeiro agreement:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testSecondAgreementStillActive() {
    console.log('🔍 Teste 5: Verificar independência do segundo agreement');
    
    if (!this.secondAgreementId) {
      console.log('❌ Erro: Segundo agreement não disponível');
      return;
    }

    try {
      const response = await axios.get(`${BASE_URL}/agreements/${this.secondAgreementId}`, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`
        }
      });

      if (response.data.success) {
        const agreement = response.data.agreement;
        if (agreement.status === 'active') {
          console.log('✅ SUCESSO: Segundo agreement ainda ATIVO (independência confirmada!)');
          console.log(`📊 Status: ${agreement.status}`);
          console.log(`💰 Preço: R$ ${agreement.proposalSnapshot.price}`);
        } else {
          console.log('❌ FALHA: Segundo agreement foi afetado pela finalização do primeiro');
          console.log(`📊 Status incorreto: ${agreement.status}`);
        }
      } else {
        console.log('❌ Falha ao buscar segundo agreement:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro ao buscar segundo agreement:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testIdempotency() {
    console.log('🔄 Teste 6: Testar idempotência em completion');
    
    if (!this.secondAgreementId) {
      console.log('❌ Erro: Segundo agreement não disponível');
      return;
    }

    const idempotencyKey = `idempotency_test_${Date.now()}`;
    

    try {
      const response1 = await axios.post(`${BASE_URL}/agreements/${this.secondAgreementId}/complete`, {
        version: 1,
        completionNotes: 'Coaching finalizado com sucesso'
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        }
      });

      console.log('✅ Primeira tentativa de completion bem-sucedida');
    } catch (error) {
      console.log('⚠️ Erro na primeira tentativa:', error.response?.data?.message || error.message);
      return;
    }


    try {
      const response2 = await axios.post(`${BASE_URL}/agreements/${this.secondAgreementId}/complete`, {
        version: 1,
        completionNotes: 'Tentativa duplicada'
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        }
      });

      if (response2.data.message.includes('idempotência')) {
        console.log('✅ Idempotência funcionando: operação duplicada detectada');
      } else {
        console.log('⚠️ Idempotência pode não estar funcionando');
      }
    } catch (error) {
      console.log('⚠️ Erro na segunda tentativa:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testAutoMigration() {
    console.log('🔄 Teste 7: Testar migração automática');
    
    try {

      const response = await axios.get(`${BASE_URL}/boosting-chat/conversation/${this.conversationId}/proposal`, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`
        }
      });

      if (response.data.success) {
        console.log('✅ Migração automática funcionando');
        console.log(`📄 Proposal (legacy): ${response.data.proposal?._id ? 'Presente' : 'Ausente'}`);
        console.log(`📋 Agreement (novo): ${response.data.agreement?.agreementId ? 'Presente' : 'Ausente'}`);
        
        if (response.data.proposal && response.data.agreement) {
          console.log('✅ Compatibilidade dual funcionando (ambos formatos retornados)');
        }
      } else {
        console.log('❌ Falha na migração automática:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro no teste de migração:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async runAllTests() {
    await this.setup();
    await this.testCreateFirstProposal();
    await this.testCreateSecondProposal();
    await this.testListConversationAgreements();
    await this.testCompleteFirstAgreement();
    await this.testSecondAgreementStillActive();
    await this.testIdempotency();
    await this.testAutoMigration();
    
    console.log('🎯 Teste do sistema Agreement concluído!');
    console.log('\n📊 RESULTADOS ESPERADOS:');
    console.log('✅ Múltiplas propostas do mesmo booster permitidas');
    console.log('✅ Finalização independente de cada agreement');
    console.log('✅ Idempotência funcionando');
    console.log('✅ Migração automática transparente');
  }
}


if (require.main === module) {
  const test = new AgreementSystemTest();
  test.runAllTests().catch(console.error);
}

module.exports = AgreementSystemTest;
