const winston = require('winston');
const path = require('path');

// Configurando para logs mais detalhados durante desenvolvimento
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV !== 'production' ? 'info' : 'error');

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'chat-api' },
  transports: [
    // Apenas logs de erro
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error' 
    }),
  ],
});

// Em desenvolvimento, exibir logs mais detalhados no console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    level: 'info', // Alterado de error para info
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));

  // Adiciona transporte para arquivo de debug separado
  logger.add(new winston.transports.File({
    filename: path.join('logs', 'debug.log'),
    level: 'debug'
  }));
}

module.exports = logger;
