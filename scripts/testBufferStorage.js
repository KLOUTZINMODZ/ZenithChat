require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script para testar salvamento e recuperação de buffers no MongoDB
 * Identifica se o problema é no driver, schema ou configuração
 */

async function testBufferStorage() {
  
  );
  
  try {
    // Conectar
    await mongoose.connect(process.env.MONGODB_URI);
    

    // Criar schema de teste simples
    const TestSchema = new mongoose.Schema({
      testId: String,
      smallBuffer: Buffer,
      mediumBuffer: Buffer,
      largeBuffer: Buffer,
      explicitBuffer: mongoose.Schema.Types.Buffer
    });
    
    const TestModel = mongoose.model('BufferTest', TestSchema);

    // Limpar testes anteriores
    await TestModel.deleteMany({ testId: /^test/ });

    // TESTE 1: Buffer pequeno (1KB)
    ');
    );
    
    const smallBuffer = Buffer.alloc(1024, 'A');
    
    
    const doc1 = await TestModel.create({
      testId: 'test-small',
      smallBuffer: smallBuffer
    });
    
    
    const retrieved1 = await TestModel.findById(doc1._id).lean();
    const isValid1 = retrieved1.smallBuffer && Buffer.isBuffer(retrieved1.smallBuffer) && retrieved1.smallBuffer.length > 0;
    

    // TESTE 2: Buffer médio (100KB - típico de thumbnail)
    ');
    );
    
    const mediumBuffer = Buffer.alloc(100 * 1024, 'B');
    .toFixed(2)} KB`);
    
    const doc2 = await TestModel.create({
      testId: 'test-medium',
      mediumBuffer: mediumBuffer
    });
    
    
    const retrieved2 = await TestModel.findById(doc2._id).lean();
    const isValid2 = retrieved2.mediumBuffer && Buffer.isBuffer(retrieved2.mediumBuffer) && retrieved2.mediumBuffer.length > 0;
    .toFixed(2) + ' KB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 3: Buffer grande (1MB - típico de imagem full)
    ');
    );
    
    const largeBuffer = Buffer.alloc(1024 * 1024, 'C');
    .toFixed(2)} MB`);
    
    const doc3 = await TestModel.create({
      testId: 'test-large',
      largeBuffer: largeBuffer
    });
    
    
    const retrieved3 = await TestModel.findById(doc3._id).lean();
    const isValid3 = retrieved3.largeBuffer && Buffer.isBuffer(retrieved3.largeBuffer) && retrieved3.largeBuffer.length > 0;
    .toFixed(2) + ' MB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 4: Usando Schema.Types.Buffer explícito
    ');
    );
    
    const explicitBuffer = Buffer.alloc(500 * 1024, 'D');
    .toFixed(2)} KB`);
    
    const doc4 = await TestModel.create({
      testId: 'test-explicit',
      explicitBuffer: explicitBuffer
    });
    
    
    const retrieved4 = await TestModel.findById(doc4._id).lean();
    const isValid4 = retrieved4.explicitBuffer && Buffer.isBuffer(retrieved4.explicitBuffer) && retrieved4.explicitBuffer.length > 0;
    .toFixed(2) + ' KB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 5: Múltiplos buffers no mesmo documento (simulando UploadedImage)
    ');
    );
    
    const multiDoc = await TestModel.create({
      testId: 'test-multi',
      smallBuffer: Buffer.alloc(50 * 1024, 'X'),   // 50KB
      mediumBuffer: Buffer.alloc(100 * 1024, 'Y'),  // 100KB
      largeBuffer: Buffer.alloc(200 * 1024, 'Z'),   // 200KB
      explicitBuffer: Buffer.alloc(150 * 1024, 'W') // 150KB
    });
    
    const totalSize = (50 + 100 + 200 + 150) * 1024;
    .toFixed(2)} KB total`);
    
    
    const retrievedMulti = await TestModel.findById(multiDoc._id).lean();
    
    
    const checks = {
      smallBuffer: retrievedMulti.smallBuffer,
      mediumBuffer: retrievedMulti.mediumBuffer,
      largeBuffer: retrievedMulti.largeBuffer,
      explicitBuffer: retrievedMulti.explicitBuffer
    };
    
    for (const [name, buffer] of Object.entries(checks)) {
      const valid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = valid ? (buffer.length / 1024).toFixed(2) : 0;
      
    }

    // VERIFICAR TAMANHO DO DOCUMENTO
    
    );
    
    const docSize = JSON.stringify(retrievedMulti).length;
    const maxSize = 16 * 1024 * 1024; // 16MB limite do MongoDB
    const percentage = ((docSize / maxSize) * 100).toFixed(2);
    
    .toFixed(2)} MB`);
    .toFixed(2)} MB`);
    
    

    // RESUMO
    
    );
    
    const allValid = isValid1 && isValid2 && isValid3 && isValid4;
    
    if (allValid) {
      
      
      
      ');
      
      
    } else {
      
      
      
      
      
      
      ');
    }

    // Limpar testes
    
    const deleted = await TestModel.deleteMany({ testId: /^test/ });
    

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

testBufferStorage();
