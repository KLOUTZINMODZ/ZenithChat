const axios = require('axios');


const API_BASE = 'http://zenith.enrelyugi.com.br/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTdkODJjOGNkZDQwMTg4ZTA4YTIyNCIsImlhdCI6MTc1NjE3NDExNywiZXhwIjoxNzU2Nzc4OTE3fQ.ePaG5v7D1J4Vz3ml_cnVBYlk517fs96z4I95BUhI0nI';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function checkConversationStatus() {
  console.log('🔍 Verificando Status da Conversa');
  console.log('=====================================\n');

  try {

    console.log('📝 Status da Conversa:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    console.log('Status:', JSON.stringify(statusResponse.data, null, 2));
    
    if (statusResponse.data.isReported) {
      console.log('\n🚨 PROBLEMA ENCONTRADO: Conversa está REPORTADA!');
      console.log('Reportado em:', statusResponse.data.reportedAt);
      console.log('Reportado por:', statusResponse.data.reportedBy);
      console.log('Status do boosting:', statusResponse.data.boostingStatus);
    } else {
      console.log('\n✅ Conversa NÃO está reportada');
    }


    console.log('\n📝 Verificando Propostas:');
    try {
      const proposalResponse = await axios.get(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/proposal`,
        config
      );
      console.log('Proposta encontrada:', proposalResponse.data);
    } catch (error) {
      console.log('❌ Erro ao buscar proposta:', error.response?.status, error.response?.data?.message);
    }


    console.log('\n📝 Testando Envio de Mensagem:');
    try {
      const messageResponse = await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste após nova proposta aceita',
          type: 'text'
        },
        config
      );
      console.log('✅ Mensagem enviada com sucesso');
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('🚫 Chat está BLOQUEADO (HTTP 423)');
        console.log('Motivo:', error.response.data.message);
      } else {
        console.log('❌ Erro ao enviar mensagem:', error.response?.status, error.response?.data?.message);
      }
    }

  } catch (error) {
    console.log('❌ Erro geral:', error.message);
  }
}

async function fixConversation() {
  console.log('\n🔧 Tentando Desbloquear Conversa (se necessário)');
  console.log('===============================================\n');


  console.log('⚠️  Para desbloquear uma conversa reportada:');
  console.log('1. Acesse diretamente o banco MongoDB');
  console.log('2. Execute: db.conversations.updateOne(');
  console.log(`   {_id: ObjectId("${CONVERSATION_ID}")},`);
  console.log('   {$unset: {isReported: "", reportedAt: "", reportedBy: ""}}');
  console.log(')');
  console.log('\n3. Ou use um endpoint admin se disponível');
}

checkConversationStatus()
  .then(() => fixConversation())
  .then(() => console.log('\n🏁 Diagnóstico concluído'))
  .catch(error => console.error('💥 Erro:', error.message));
